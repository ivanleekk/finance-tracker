import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import select, func, case
from sqlalchemy.orm import Session

from src.models import Asset, FinancialAccount, Trade, TradeType, CASH_ASSET_TYPE, cash_ticker


def get_or_create_cash_asset(db: Session, currency: str) -> Asset:
    """Find or create the cash pseudo-asset for a currency (ticker CASH.<CUR>)."""
    currency = currency.upper()
    ticker = cash_ticker(currency)
    asset = db.query(Asset).filter(Asset.ticker == ticker).first()
    if not asset:
        asset = Asset(
            id=uuid.uuid7(),
            ticker=ticker,
            name=f"Cash ({currency})",
            type=CASH_ASSET_TYPE,
            currency=currency,
        )
        db.add(asset)
        db.flush()
    return asset


def get_subportfolio_cash_balance(
    db: Session, subportfolio_id: uuid.UUID, asset_id: uuid.UUID, as_of: date
) -> float:
    """Cash units of one cash asset held in a sub-portfolio as of a date (inclusive)."""
    balance = db.execute(
        select(
            func.coalesce(
                func.sum(
                    Trade.quantity
                    * case((Trade.trade_type == TradeType.buy, 1), else_=-1)
                ),
                0.0,
            )
        )
        .where(Trade.sub_portfolio_id == subportfolio_id)
        .where(Trade.asset_id == asset_id)
        .where(func.date(Trade.date) <= as_of)
    ).scalar()
    return float(balance or 0.0)


def settle_trade_from_cash(db: Session, db_trade: Trade) -> Trade:
    """
    Settles a stock trade against the sub-portfolio's own cash instead of a
    funding-account transaction: creates (or, on edits, updates) a companion
    trade of the cash pseudo-asset that moves the opposite direction, linked
    via ``settlement_trade_id``. Neither leg gets a Transaction, since no real
    money crosses in or out of a household account -- see
    ``sync_trade_transaction`` in routers/portfolio.py for the path that does.

    Callers must verify sufficient cash before creating a new cash-settled
    buy (see execute_trade); this function does not re-validate on edits, so
    editing a cash-settled trade can leave the sub-portfolio's cash negative,
    same as editing a stock trade can already leave a negative share count.
    """
    account = db.query(FinancialAccount).filter(FinancialAccount.id == db_trade.account_id).first()
    acc_curr = (account.currency if account else None) or "USD"

    amount_in_acc = float(Decimal(str(db_trade.quantity)) * db_trade.price * Decimal(str(db_trade.exchange_rate)))
    cash_asset = get_or_create_cash_asset(db, acc_curr)
    # Buying the traded asset consumes cash (sell of cash); selling it credits cash (buy of cash).
    # trade_type may still be a raw string ("buy"/"sell") rather than the enum
    # right after construction, before the ORM round-trips it through a flush.
    is_buy = db_trade.trade_type == TradeType.buy or db_trade.trade_type == "buy"
    cash_trade_type = TradeType.sell if is_buy else TradeType.buy

    cash_trade = None
    if db_trade.settlement_trade_id:
        cash_trade = db.query(Trade).filter(Trade.id == db_trade.settlement_trade_id).first()

    if cash_trade:
        cash_trade.trade_type = cash_trade_type
        cash_trade.date = db_trade.date
        cash_trade.quantity = amount_in_acc
        cash_trade.price = Decimal("1")
        cash_trade.currency = acc_curr
        cash_trade.exchange_rate = 1.0
        cash_trade.asset_id = cash_asset.id
        cash_trade.account_id = db_trade.account_id
        cash_trade.description = db_trade.description
    else:
        cash_trade = Trade(
            id=uuid.uuid7(),
            household_id=db_trade.household_id,
            sub_portfolio_id=db_trade.sub_portfolio_id,
            asset_id=cash_asset.id,
            account_id=db_trade.account_id,
            trade_type=cash_trade_type,
            date=db_trade.date,
            quantity=amount_in_acc,
            price=Decimal("1"),
            currency=acc_curr,
            exchange_rate=1.0,
            description=db_trade.description,
        )
        db.add(cash_trade)
        db.flush()
        db_trade.settlement_trade_id = cash_trade.id
        cash_trade.settlement_trade_id = db_trade.id

    return cash_trade
