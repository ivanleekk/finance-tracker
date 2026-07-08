import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from unittest.mock import patch, MagicMock

import pandas as pd
import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from src.models import Dividend, AccountBalance, Trade, PortfolioSnapshot
from src.services.dividend_engine import sync_dividends_range


# --- Fixtures / helpers ---------------------------------------------------

EX_DATE = date(2024, 2, 15)
EX_DATETIME = datetime.combine(EX_DATE, datetime.min.time(), tzinfo=timezone.utc)


@pytest.fixture
def no_network():
    """Neutralize all yfinance exchange-rate lookups (return 1.0 / empty)."""
    with patch("src.services.dividend_engine.fetch_and_cache_exchange_rates", return_value=1.0), \
         patch("src.services.account_service.fetch_and_cache_exchange_rates", return_value=1.0), \
         patch("src.services.account_service.fetch_and_cache_exchange_rates_range", return_value={}):
        yield


@pytest.fixture
def dividend_series():
    """Patch yf.Ticker(...).dividends to a single $0.24 payout on the ex-date."""
    series = pd.Series([0.24], index=pd.to_datetime([EX_DATE]))
    mock_ticker = MagicMock()
    mock_ticker.dividends = series
    with patch("src.services.dividend_engine.yf.Ticker", return_value=mock_ticker) as m:
        yield m


def _seed_household(db: Session):
    """Creates a household holding 10 shares of AAPL (USD) in one sub-portfolio."""
    ids = {
        "user": uuid.uuid7(),
        "household": uuid.uuid7(),
        "sp": uuid.uuid7(),
        "account": uuid.uuid7(),
        "asset": uuid.uuid7(),
    }
    db.execute(text(
        "INSERT INTO finance_tracker.users (id, email, preferred_timezone, salted_hashed_password, name, salt) "
        "VALUES (:id, 'div@test.com', 'UTC', 'x', 'Div User', 'x')"
    ), {"id": ids["user"]})
    db.execute(text(
        "INSERT INTO finance_tracker.households (id, name, base_currency, country_code, owner_id) "
        "VALUES (:id, 'Div HH', 'USD', 'US', :owner)"
    ), {"id": ids["household"], "owner": ids["user"]})
    db.execute(text(
        "INSERT INTO finance_tracker.sub_portfolios (id, household_id, name, risk_profile) "
        "VALUES (:id, :hh, 'Growth', 'Moderate')"
    ), {"id": ids["sp"], "hh": ids["household"]})
    db.execute(text(
        "INSERT INTO finance_tracker.financial_accounts (id, household_id, name, liquidity, tax_status, currency) "
        "VALUES (:id, :hh, 'Brokerage', 'market_liquid', 'taxable', 'USD')"
    ), {"id": ids["account"], "hh": ids["household"]})
    db.execute(text(
        "INSERT INTO finance_tracker.assets (id, ticker, name, type, currency) "
        "VALUES (:id, 'AAPL', 'Apple Inc', 'stock', 'USD')"
    ), {"id": ids["asset"]})
    # A buy trade before the ex-date so the dividend can be attributed to the account.
    db.execute(text(
        "INSERT INTO finance_tracker.trades "
        "(id, household_id, sub_portfolio_id, asset_id, account_id, trade_type, date, quantity, price, exchange_rate) "
        "VALUES (:id, :hh, :sp, :asset, :acct, 'buy', '2024-01-01T00:00:00+00', 10, 150, 1.0)"
    ), {"id": uuid.uuid7(), "hh": ids["household"], "sp": ids["sp"], "asset": ids["asset"], "acct": ids["account"]})
    # A materialized snapshot on the ex-date: 10 shares held.
    db.execute(text(
        "INSERT INTO finance_tracker.portfolio_snapshots "
        "(id, household_id, sub_portfolio_id, asset_id, date, quantity, current_price, exchange_rate_used) "
        "VALUES (:id, :hh, :sp, :asset, :d, 10, 150, 1.0)"
    ), {"id": uuid.uuid7(), "hh": ids["household"], "sp": ids["sp"], "asset": ids["asset"], "d": EX_DATE})
    db.flush()
    return ids


# --- Tests ----------------------------------------------------------------

def test_auto_dividend_recorded_from_holdings(db_session: Session, no_network, dividend_series):
    ids = _seed_household(db_session)

    count = sync_dividends_range(db_session, ids["household"], date(2024, 2, 1), date(2024, 3, 1))

    assert count == 1
    dividends = db_session.query(Dividend).filter(Dividend.household_id == ids["household"]).all()
    assert len(dividends) == 1
    div = dividends[0]
    # amount = per_share (0.24) * shares held (10)
    assert div.amount == Decimal("2.4")
    assert div.per_share_amount == Decimal("0.24")
    assert div.quantity == 10
    assert div.is_manual is False
    assert div.cash_trade_id is not None

    # Credited as cash inside the sub-portfolio, not the real bank account.
    cash_trade = db_session.query(Trade).filter(Trade.id == div.cash_trade_id).first()
    assert cash_trade is not None
    assert cash_trade.sub_portfolio_id == ids["sp"]
    assert cash_trade.quantity == 2.4
    assert cash_trade.trade_type.value == "buy"

    balance = db_session.query(AccountBalance).filter(
        AccountBalance.account_id == ids["account"], AccountBalance.date == EX_DATE
    ).first()
    assert balance is None  # real bank account is untouched

    # The cash immediately shows up in the sub-portfolio's equity curve.
    cash_snapshot = db_session.query(PortfolioSnapshot).filter(
        PortfolioSnapshot.sub_portfolio_id == ids["sp"],
        PortfolioSnapshot.asset_id == cash_trade.asset_id,
        PortfolioSnapshot.date == EX_DATE,
    ).first()
    assert cash_snapshot is not None
    assert cash_snapshot.quantity == 2.4


def test_dividend_sync_is_idempotent(db_session: Session, no_network, dividend_series):
    ids = _seed_household(db_session)

    sync_dividends_range(db_session, ids["household"], date(2024, 2, 1), date(2024, 3, 1))
    # Run again over the same range.
    sync_dividends_range(db_session, ids["household"], date(2024, 2, 1), date(2024, 3, 1))

    dividends = db_session.query(Dividend).filter(Dividend.household_id == ids["household"]).all()
    assert len(dividends) == 1  # no duplicate

    div = dividends[0]
    cash_trades = db_session.query(Trade).filter(Trade.id == div.cash_trade_id).all()
    assert len(cash_trades) == 1  # no duplicate cash trade
    assert cash_trades[0].quantity == 2.4  # not double-credited


def test_manual_dividend_is_preserved(db_session: Session, no_network, dividend_series):
    ids = _seed_household(db_session)

    # Pre-existing manual dividend at the same (sub_portfolio, asset, date) key.
    manual_id = uuid.uuid7()
    db_session.execute(text(
        "INSERT INTO finance_tracker.dividends "
        "(id, household_id, sub_portfolio_id, asset_id, account_id, date, amount, exchange_rate, is_manual) "
        "VALUES (:id, :hh, :sp, :asset, :acct, :d, 99.99, 1.0, true)"
    ), {
        "id": manual_id, "hh": ids["household"], "sp": ids["sp"], "asset": ids["asset"],
        "acct": ids["account"], "d": EX_DATETIME,
    })
    db_session.flush()

    sync_dividends_range(db_session, ids["household"], date(2024, 2, 1), date(2024, 3, 1))

    dividends = db_session.query(Dividend).filter(Dividend.household_id == ids["household"]).all()
    assert len(dividends) == 1  # manual row kept, no auto row added
    div = dividends[0]
    assert div.id == manual_id
    assert div.amount == Decimal("99.99")  # untouched
    assert div.is_manual is True
