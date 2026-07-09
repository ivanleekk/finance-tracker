import logging
import uuid
from datetime import date, datetime, time, timezone
from decimal import Decimal

import yfinance as yf
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from src.models import (
    CASH_ASSET_TYPE,
    PRICING_MODE_MANUAL,
    Asset,
    Dividend,
    FinancialAccount,
    Household,
    PortfolioSnapshot,
    ScheduledDividend,
    SubPortfolio,
    Trade,
    TradeType,
)
from src.services.cash_service import get_or_create_cash_asset
from src.services.market_data import fetch_and_cache_exchange_rates
from src.services.snapshot_engine import run_snapshot_range

logger = logging.getLogger(__name__)

# Shares below this are treated as "not held" (floating point noise / fully sold).
QTY_EPSILON = 1e-8


def sync_dividend_cash_credit(db: Session, db_dividend: Dividend) -> Trade:
    """
    Credits a dividend as cash inside its sub-portfolio, mirroring a manual
    cash deposit: creates (or, on re-sync, updates) a buy trade of the cash
    pseudo-asset denominated in the funding account's currency. No real
    household account is touched -- the payout stays inside the portfolio as
    cash until the user invests or withdraws it, same as a brokerage sweep.
    Idempotent via ``Dividend.cash_trade_id`` so re-running never duplicates.
    """
    account = db.query(FinancialAccount).filter(
        FinancialAccount.id == db_dividend.account_id
    ).first()
    acc_curr = (account.currency if account else None) or "USD"

    asset = db.query(Asset).filter(Asset.id == db_dividend.asset_id).first()
    asset_curr = (asset.currency if asset else None) or "USD"
    ticker = asset.ticker if asset else "Unknown"

    trans_date = db_dividend.date.date()
    amount = db_dividend.amount  # Total payout in asset currency (Decimal)

    rate_to_acc = fetch_and_cache_exchange_rates(db, asset_curr, acc_curr, trans_date)
    amount_in_acc = float(amount * Decimal(str(rate_to_acc)))

    cash_asset = get_or_create_cash_asset(db, acc_curr)
    description = f"Dividend: {ticker}"

    cash_trade = None
    if db_dividend.cash_trade_id:
        cash_trade = db.query(Trade).filter(Trade.id == db_dividend.cash_trade_id).first()

    if cash_trade:
        cash_trade.date = db_dividend.date
        cash_trade.quantity = amount_in_acc
        cash_trade.currency = acc_curr
        cash_trade.account_id = db_dividend.account_id
        cash_trade.asset_id = cash_asset.id
        cash_trade.description = description
        return cash_trade

    cash_trade = Trade(
        id=uuid.uuid7(),
        household_id=db_dividend.household_id,
        sub_portfolio_id=db_dividend.sub_portfolio_id,
        asset_id=cash_asset.id,
        account_id=db_dividend.account_id,
        trade_type=TradeType.buy,
        date=db_dividend.date,
        quantity=amount_in_acc,
        price=Decimal("1"),
        currency=acc_curr,
        exchange_rate=1.0,
        description=description,
    )
    db.add(cash_trade)
    db.flush()
    db_dividend.cash_trade_id = cash_trade.id
    return cash_trade


def _shares_held_on(db: Session, sub_portfolio_id: uuid.UUID, asset_id: uuid.UUID, ex_date: date) -> float:
    """
    Shares held in a sub-portfolio on a given ex-dividend date, read from the
    materialized ``PortfolioSnapshot`` rows. The snapshot engine writes a row for
    every calendar day a position is open (qty > 0), so an exact-date match is
    correct: no row on ``ex_date`` means the position was not held that day.
    """
    qty = db.execute(
        select(PortfolioSnapshot.quantity)
        .where(PortfolioSnapshot.sub_portfolio_id == sub_portfolio_id)
        .where(PortfolioSnapshot.asset_id == asset_id)
        .where(PortfolioSnapshot.date == ex_date)
    ).scalar()
    return float(qty) if qty is not None else 0.0


def _resolve_account_id(db: Session, household: Household, sub_portfolio_id: uuid.UUID,
                        asset_id: uuid.UUID, ex_date: date):
    """
    Attribute a dividend to the account the asset was bought through in this
    sub-portfolio (most recent buy on/before the ex-date), falling back to the
    household's default funding account.
    """
    account_id = db.execute(
        select(Trade.account_id)
        .where(Trade.sub_portfolio_id == sub_portfolio_id)
        .where(Trade.asset_id == asset_id)
        .where(Trade.trade_type == TradeType.buy)
        .where(func.date(Trade.date) <= ex_date)
        .order_by(Trade.date.desc())
        .limit(1)
    ).scalar()

    if account_id:
        return account_id

    return household.default_funding_account_id


def sync_dividends_range(db: Session, household_id: uuid.UUID, start_date: date, end_date: date) -> int:
    """
    Automatically records dividends for every asset held by the household whose
    ex-dividend date falls within ``[start_date, end_date]``.

    For each ex-date it multiplies the per-share dividend (from yfinance) by the
    shares held in each sub-portfolio on that day, credits it as cash inside
    that sub-portfolio, and upserts an idempotent auto-tracked ``Dividend``
    row. Manual dividends at the same (sub_portfolio, asset, date) key are
    always preserved.

    Requires snapshots to already be materialized for the range; callers run
    ``run_snapshot_range`` first. Returns the number of dividend rows written.
    """
    household = db.get(Household, household_id)
    if not household:
        return 0

    # Assets the household has ever traded.
    asset_ids = db.execute(
        select(Trade.asset_id).where(Trade.household_id == household_id).distinct()
    ).scalars().all()
    if not asset_ids:
        return 0

    assets = {a.id: a for a in db.execute(select(Asset).where(Asset.id.in_(asset_ids))).scalars().all()}

    sub_portfolio_ids = db.execute(
        select(SubPortfolio.id).where(SubPortfolio.household_id == household_id)
    ).scalars().all()

    written = 0

    for asset_id, asset in assets.items():
        # Cash pseudo-assets have no market ticker and never pay dividends.
        # Manual-priced assets (unlisted bonds, SSBs) have no yfinance dividend
        # feed either — their coupons are entered as manual dividends.
        if not asset.ticker or asset.type == CASH_ASSET_TYPE or asset.pricing_mode == PRICING_MODE_MANUAL:
            continue

        # 1. Pull per-share dividend history from yfinance.
        try:
            series = yf.Ticker(asset.ticker).dividends
        except Exception as e:  # noqa: BLE001 - never let market data break the sync
            logger.warning(f"Failed to fetch dividends for {asset.ticker}: {e}")
            continue

        if series is None or len(series) == 0:
            continue

        # 2. Ex-dates within the requested window.
        ex_events = []
        for ts, per_share in series.items():
            ex_date = ts.date() if hasattr(ts, "date") else ts
            if start_date <= ex_date <= end_date:
                ex_events.append((ex_date, Decimal(str(float(per_share)))))

        if not ex_events:
            continue

        for ex_date, per_share in ex_events:
            if per_share <= 0:
                continue

            ex_datetime = datetime.combine(ex_date, time.min, tzinfo=timezone.utc)

            for sp_id in sub_portfolio_ids:
                qty = _shares_held_on(db, sp_id, asset_id, ex_date)
                if qty <= QTY_EPSILON:
                    continue

                account_id = _resolve_account_id(db, household, sp_id, asset_id, ex_date)
                if not account_id:
                    logger.warning(
                        f"No account to attribute dividend for {asset.ticker} in "
                        f"sub-portfolio {sp_id} on {ex_date}; skipping."
                    )
                    continue

                amount = per_share * Decimal(str(qty))
                rate_to_home = fetch_and_cache_exchange_rates(
                    db, asset.currency or "USD", household.base_currency or "USD", ex_date
                )
                amount_home = amount * Decimal(str(rate_to_home))

                existing = db.query(Dividend).filter(
                    Dividend.sub_portfolio_id == sp_id,
                    Dividend.asset_id == asset_id,
                    Dividend.date == ex_datetime,
                ).first()

                # Preserve any manually entered dividend at this key.
                if existing and existing.is_manual:
                    continue

                if existing:
                    existing.account_id = account_id
                    existing.amount = amount
                    existing.amount_home_currency = amount_home
                    existing.per_share_amount = per_share
                    existing.quantity = qty
                    existing.exchange_rate = rate_to_home
                    db_dividend = existing
                else:
                    db_dividend = Dividend(
                        id=uuid.uuid7(),
                        household_id=household_id,
                        sub_portfolio_id=sp_id,
                        asset_id=asset_id,
                        account_id=account_id,
                        date=ex_datetime,
                        amount=amount,
                        amount_home_currency=amount_home,
                        per_share_amount=per_share,
                        quantity=qty,
                        exchange_rate=rate_to_home,
                        is_manual=False,
                    )
                    db.add(db_dividend)
                    db.flush()

                # Credit sub-portfolio cash (idempotent on re-run).
                sync_dividend_cash_credit(db, db_dividend)
                written += 1

    db.commit()

    if written:
        # Dividend payouts just landed as new cash trades; replay them into
        # PortfolioSnapshot so equity curves/holdings reflect the cash immediately.
        run_snapshot_range(db, household_id, start_date, end_date)

    return written


def materialize_scheduled_dividends(db: Session, household_id: uuid.UUID, as_of: date | None = None) -> int:
    """
    Turn due ScheduledDividend rows (payment date reached, not yet materialized)
    into real manual Dividend rows, credit each payout as sub-portfolio cash, and
    refresh snapshots so valuations reflect the coupons immediately. Idempotent:
    ``materialized_at`` marks a row as done, so re-running (or deleting the
    resulting dividend) never duplicates or resurrects a payment. Returns the
    number of dividends written.
    """
    as_of = as_of or date.today()
    household = db.get(Household, household_id)
    if not household:
        return 0

    due = db.query(ScheduledDividend).filter(
        ScheduledDividend.household_id == household_id,
        ScheduledDividend.materialized_at.is_(None),
        ScheduledDividend.date <= as_of,
    ).order_by(ScheduledDividend.date.asc()).all()
    if not due:
        return 0

    now = datetime.now(timezone.utc)
    earliest = min(sd.date for sd in due)
    written = 0

    for sd in due:
        asset = db.get(Asset, sd.asset_id)
        pay_datetime = datetime.combine(sd.date, time.min, tzinfo=timezone.utc)

        # Dividends are unique on (sub_portfolio, asset, date); if something already
        # occupies this slot (e.g. the user logged the coupon by hand), link to it
        # instead of failing so the schedule row still retires cleanly.
        existing = db.query(Dividend).filter(
            Dividend.sub_portfolio_id == sd.sub_portfolio_id,
            Dividend.asset_id == sd.asset_id,
            Dividend.date == pay_datetime,
        ).first()
        if existing:
            sd.dividend_id = existing.id
            sd.materialized_at = now
            continue

        rate_to_home = fetch_and_cache_exchange_rates(
            db, (asset.currency if asset else None) or "USD", household.base_currency or "USD", sd.date
        )
        db_dividend = Dividend(
            id=uuid.uuid7(),
            household_id=household_id,
            sub_portfolio_id=sd.sub_portfolio_id,
            asset_id=sd.asset_id,
            account_id=sd.account_id,
            date=pay_datetime,
            amount=sd.amount,
            amount_home_currency=sd.amount * Decimal(str(rate_to_home)),
            exchange_rate=rate_to_home,
            is_manual=True,
        )
        db.add(db_dividend)
        db.flush()

        # Same brokerage-sweep behavior as auto-tracked dividends.
        sync_dividend_cash_credit(db, db_dividend)
        sd.dividend_id = db_dividend.id
        sd.materialized_at = now
        written += 1

    db.commit()

    if written:
        run_snapshot_range(db, household_id, earliest, as_of)

    return written
