import logging
import uuid
from datetime import date, datetime, time, timezone
from decimal import Decimal

import yfinance as yf
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from src.models import (
    Asset,
    Category,
    Dividend,
    FinancialAccount,
    Household,
    PortfolioSnapshot,
    SubPortfolio,
    Trade,
    Transaction,
    TradeType,
    TransactionType,
)
from src.services.account_service import sync_transaction_to_balances
from src.services.market_data import fetch_and_cache_exchange_rates

logger = logging.getLogger(__name__)

# Shares below this are treated as "not held" (floating point noise / fully sold).
QTY_EPSILON = 1e-8


def _get_or_create_dividend_category(db: Session, household_id: uuid.UUID) -> Category:
    """Find or create the household's "Dividend Income" income category."""
    category = db.query(Category).filter(
        Category.household_id == household_id,
        Category.name == "Dividend Income",
    ).first()

    if not category:
        category = Category(
            id=uuid.uuid7(),
            household_id=household_id,
            name="Dividend Income",
            type=TransactionType.income.value,
        )
        db.add(category)
        db.flush()

    return category


def sync_dividend_transaction(db: Session, db_dividend: Dividend) -> Transaction:
    """
    Creates or updates the income Transaction that credits a dividend to its
    cash account, and syncs the account balance. Mirrors ``sync_trade_transaction``
    so that re-running the dividend sync never double-credits balances.
    """
    category = _get_or_create_dividend_category(db, db_dividend.household_id)

    account = db.query(FinancialAccount).filter(
        FinancialAccount.id == db_dividend.account_id
    ).first()
    acc_curr = (account.currency if account else None) or "USD"
    home_curr = (account.household.base_currency if account and account.household else None) or "USD"

    asset = db.query(Asset).filter(Asset.id == db_dividend.asset_id).first()
    asset_curr = (asset.currency if asset else None) or "USD"
    ticker = asset.ticker if asset else "Unknown"

    trans_date = db_dividend.date.date()
    amount = db_dividend.amount  # Total payout in asset currency (Decimal)

    # Convert the payout into the cash account's currency to update its balance.
    rate_to_acc = fetch_and_cache_exchange_rates(db, asset_curr, acc_curr, trans_date)
    amount_in_acc = amount * Decimal(str(rate_to_acc))

    rate_to_home = fetch_and_cache_exchange_rates(db, asset_curr, home_curr, trans_date)
    amount_home = amount * Decimal(str(rate_to_home))

    description = f"Dividend: {ticker}"

    # --- Update path: a transaction already exists for this dividend ---
    if db_dividend.transaction_id:
        db_transaction = db.query(Transaction).filter(
            Transaction.id == db_dividend.transaction_id
        ).first()
        if db_transaction:
            # Reverse the previous impact (dividends are always income => +).
            old_rate = db_transaction.exchange_rate if db_transaction.exchange_rate else 1.0
            old_impact = db_transaction.amount * Decimal(str(old_rate))
            old_date = db_transaction.date.date()
            old_account_id = db_transaction.account_id

            db_transaction.account_id = db_dividend.account_id
            db_transaction.category_id = category.id
            db_transaction.date = db_dividend.date
            db_transaction.amount = amount
            db_transaction.amount_home_currency = amount_home
            db_transaction.description = description
            db_transaction.transaction_type = TransactionType.income
            db_transaction.currency = asset_curr
            db_transaction.exchange_rate = rate_to_acc

            new_impact = amount_in_acc
            new_date = trans_date

            if old_account_id == db_dividend.account_id and old_date == new_date:
                sync_transaction_to_balances(db, db_dividend.account_id, new_date, new_impact - old_impact)
            else:
                sync_transaction_to_balances(db, old_account_id, old_date, -old_impact)
                sync_transaction_to_balances(db, db_dividend.account_id, new_date, new_impact)

            return db_transaction

    # --- Create path: brand new dividend transaction ---
    db_transaction = Transaction(
        id=uuid.uuid7(),
        account_id=db_dividend.account_id,
        category_id=category.id,
        date=db_dividend.date,
        amount=amount,
        amount_home_currency=amount_home,
        currency=asset_curr,
        exchange_rate=rate_to_acc,
        description=description,
        transaction_type=TransactionType.income,
    )
    db.add(db_transaction)
    db.flush()
    db_dividend.transaction_id = db_transaction.id

    sync_transaction_to_balances(db, db_dividend.account_id, trans_date, amount_in_acc)

    return db_transaction


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
    shares held in each sub-portfolio on that day, credits the cash account, and
    upserts an idempotent auto-tracked ``Dividend`` row. Manual dividends at the
    same (sub_portfolio, asset, date) key are always preserved.

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
        if not asset.ticker:
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

                # Credit the cash account (idempotent on re-run).
                sync_dividend_transaction(db, db_dividend)
                written += 1

    db.commit()
    return written
