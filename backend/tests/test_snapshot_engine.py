import uuid
from datetime import date, datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from src.models import PortfolioSnapshot
from src.services.snapshot_engine import run_snapshot_range, run_daily_snapshot_targeted


@pytest.fixture
def mock_market_data():
    """Prevent real yfinance network calls: prices come only from the market_prices
    table seeded by each test, and FX defaults to 1.0 (empty rate lookup)."""
    with patch("src.services.snapshot_engine.fetch_and_cache_market_prices_range") as mock_prices, \
         patch("src.services.snapshot_engine.fetch_and_cache_exchange_rates_range", return_value={}) as mock_rates:
        yield mock_prices, mock_rates


def _seed_portfolio(db: Session, *, base_currency="USD", asset_currency="USD", ticker="AAPL"):
    """Creates user/household/subportfolio/account/asset and returns their ids."""
    user_id = uuid.uuid7()
    db.execute(
        text("INSERT INTO finance_tracker.users (id, email, preferred_timezone, salted_hashed_password, name, salt) "
             "VALUES (:id, :email, 'UTC', 'x', 'Snapshot User', 'x')"),
        {"id": user_id, "email": f"snap-{user_id}@example.com"},
    )
    household_id = uuid.uuid7()
    db.execute(
        text("INSERT INTO finance_tracker.households (id, name, base_currency, country_code, owner_id) "
             "VALUES (:id, 'Snapshot Household', :cur, 'US', :owner_id)"),
        {"id": household_id, "owner_id": user_id, "cur": base_currency},
    )
    sp_id = uuid.uuid7()
    db.execute(
        text("INSERT INTO finance_tracker.sub_portfolios (id, household_id, name, risk_profile) "
             "VALUES (:id, :household_id, 'Snapshot SP', 'Moderate')"),
        {"id": sp_id, "household_id": household_id},
    )
    account_id = uuid.uuid7()
    db.execute(
        text("INSERT INTO finance_tracker.financial_accounts (id, household_id, name, liquidity, tax_status, currency) "
             "VALUES (:id, :household_id, 'Brokerage', 'market_liquid', 'taxable', :cur)"),
        {"id": account_id, "household_id": household_id, "cur": base_currency},
    )
    asset_id = uuid.uuid7()
    db.execute(
        text("INSERT INTO finance_tracker.assets (id, ticker, name, type, currency) "
             "VALUES (:id, :ticker, :ticker, 'Stock', :cur)"),
        {"id": asset_id, "ticker": ticker, "cur": asset_currency},
    )
    return user_id, household_id, sp_id, account_id, asset_id


def _insert_price(db: Session, ticker: str, d: date, price: float, currency="USD"):
    db.execute(
        text("INSERT INTO finance_tracker.market_prices (id, ticker, date, close_price, currency) "
             "VALUES (:id, :ticker, :d, :p, :cur)"),
        {"id": uuid.uuid7(), "ticker": ticker, "d": d, "p": price, "cur": currency},
    )


def _insert_trade(db: Session, *, household_id, sp_id, asset_id, account_id,
                  trade_type: str, dt: datetime, quantity: float, price: float, rate=1.0):
    db.execute(
        text("INSERT INTO finance_tracker.trades (id, household_id, sub_portfolio_id, asset_id, account_id, "
             "trade_type, date, quantity, price, exchange_rate) "
             "VALUES (:id, :hid, :spid, :aid, :accid, :tt, :dt, :q, :p, :r)"),
        {"id": uuid.uuid7(), "hid": household_id, "spid": sp_id, "aid": asset_id,
         "accid": account_id, "tt": trade_type, "dt": dt, "q": quantity, "p": price, "r": rate},
    )


def test_targeted_snapshot_replays_trades_and_prices(db_session: Session, mock_market_data):
    _, household_id, sp_id, account_id, asset_id = _seed_portfolio(db_session)

    target = date(2023, 10, 1)
    _insert_price(db_session, "AAPL", target - timedelta(days=1), 145.0)
    _insert_price(db_session, "AAPL", target, 150.0)

    _insert_trade(db_session, household_id=household_id, sp_id=sp_id, asset_id=asset_id,
                  account_id=account_id, trade_type="buy",
                  dt=datetime(2023, 9, 29, tzinfo=timezone.utc), quantity=10, price=100.0)
    _insert_trade(db_session, household_id=household_id, sp_id=sp_id, asset_id=asset_id,
                  account_id=account_id, trade_type="buy",
                  dt=datetime(2023, 9, 30, tzinfo=timezone.utc), quantity=10, price=120.0)
    _insert_trade(db_session, household_id=household_id, sp_id=sp_id, asset_id=asset_id,
                  account_id=account_id, trade_type="sell",
                  dt=datetime(2023, 10, 1, tzinfo=timezone.utc), quantity=5, price=130.0)
    db_session.commit()

    run_daily_snapshot_targeted(db_session, household_id, target)

    snapshot = db_session.query(PortfolioSnapshot).filter_by(
        sub_portfolio_id=sp_id, asset_id=asset_id, date=target
    ).one_or_none()
    assert snapshot is not None
    assert snapshot.quantity == 15.0
    # avg cost: (10*100 + 10*120) / 20 = 110, unchanged by the sell
    assert float(snapshot.average_cost_basis) == pytest.approx(110.0)
    assert float(snapshot.current_price) == pytest.approx(150.0)
    assert float(snapshot.current_value_home_currency) == pytest.approx(15 * 150.0)


def test_snapshot_rerun_is_idempotent(db_session: Session, mock_market_data):
    _, household_id, sp_id, account_id, asset_id = _seed_portfolio(db_session)
    target = date(2023, 10, 1)
    _insert_price(db_session, "AAPL", target, 150.0)
    _insert_trade(db_session, household_id=household_id, sp_id=sp_id, asset_id=asset_id,
                  account_id=account_id, trade_type="buy",
                  dt=datetime(2023, 10, 1, tzinfo=timezone.utc), quantity=10, price=100.0)
    db_session.commit()

    run_daily_snapshot_targeted(db_session, household_id, target)
    run_daily_snapshot_targeted(db_session, household_id, target)

    snapshots = db_session.query(PortfolioSnapshot).filter_by(
        sub_portfolio_id=sp_id, asset_id=asset_id, date=target
    ).all()
    assert len(snapshots) == 1


def test_snapshot_range_fills_price_gaps_with_last_known(db_session: Session, mock_market_data):
    """A weekend/holiday day without a market price should reuse the last close."""
    _, household_id, sp_id, account_id, asset_id = _seed_portfolio(db_session)
    start = date(2023, 10, 2)
    end = date(2023, 10, 4)
    _insert_price(db_session, "AAPL", start, 150.0)
    # No prices on Oct 3rd / 4th
    _insert_trade(db_session, household_id=household_id, sp_id=sp_id, asset_id=asset_id,
                  account_id=account_id, trade_type="buy",
                  dt=datetime(2023, 10, 2, tzinfo=timezone.utc), quantity=10, price=100.0)
    db_session.commit()

    run_snapshot_range(db_session, household_id, start, end)

    snaps = {s.date: s for s in db_session.query(PortfolioSnapshot).filter_by(
        sub_portfolio_id=sp_id, asset_id=asset_id).all()}
    assert set(snaps) == {date(2023, 10, 2), date(2023, 10, 3), date(2023, 10, 4)}
    for s in snaps.values():
        assert float(s.current_price) == pytest.approx(150.0)


def test_snapshot_skips_positions_sold_to_zero(db_session: Session, mock_market_data):
    _, household_id, sp_id, account_id, asset_id = _seed_portfolio(db_session)
    start = date(2023, 10, 2)
    end = date(2023, 10, 3)
    _insert_price(db_session, "AAPL", start, 150.0)
    _insert_trade(db_session, household_id=household_id, sp_id=sp_id, asset_id=asset_id,
                  account_id=account_id, trade_type="buy",
                  dt=datetime(2023, 10, 2, tzinfo=timezone.utc), quantity=10, price=100.0)
    _insert_trade(db_session, household_id=household_id, sp_id=sp_id, asset_id=asset_id,
                  account_id=account_id, trade_type="sell",
                  dt=datetime(2023, 10, 3, tzinfo=timezone.utc), quantity=10, price=150.0)
    db_session.commit()

    run_snapshot_range(db_session, household_id, start, end)

    snaps = db_session.query(PortfolioSnapshot).filter_by(
        sub_portfolio_id=sp_id, asset_id=asset_id).all()
    dates = {s.date for s in snaps}
    assert date(2023, 10, 2) in dates
    assert date(2023, 10, 3) not in dates  # fully sold → no snapshot row


def test_snapshot_cash_asset_priced_at_one(db_session: Session, mock_market_data):
    """Cash pseudo-assets are always worth 1.0 in their own currency and are
    excluded from market price fetches."""
    _, household_id, sp_id, account_id, _ = _seed_portfolio(db_session)
    cash_asset_id = uuid.uuid7()
    db_session.execute(
        text("INSERT INTO finance_tracker.assets (id, ticker, name, type, currency) "
             "VALUES (:id, 'CASH.USD', 'Cash USD', 'cash', 'USD')"),
        {"id": cash_asset_id},
    )
    target = date(2023, 10, 2)
    _insert_trade(db_session, household_id=household_id, sp_id=sp_id, asset_id=cash_asset_id,
                  account_id=account_id, trade_type="buy",
                  dt=datetime(2023, 10, 2, tzinfo=timezone.utc), quantity=500, price=1.0)
    db_session.commit()

    run_daily_snapshot_targeted(db_session, household_id, target)

    snapshot = db_session.query(PortfolioSnapshot).filter_by(
        sub_portfolio_id=sp_id, asset_id=cash_asset_id, date=target
    ).one_or_none()
    assert snapshot is not None
    assert float(snapshot.current_price) == pytest.approx(1.0)
    assert float(snapshot.current_value_home_currency) == pytest.approx(500.0)

    # The cash ticker must not be part of the yfinance price fetch
    mock_prices, _ = mock_market_data
    fetched_tickers = mock_prices.call_args[0][1]
    assert "CASH.USD" not in fetched_tickers


def test_snapshot_range_clears_stale_rows(db_session: Session, mock_market_data):
    """Rows previously snapshotted inside the range are replaced, not duplicated,
    even when holdings changed (ghost holdings are removed)."""
    _, household_id, sp_id, account_id, asset_id = _seed_portfolio(db_session)
    target = date(2023, 10, 2)
    _insert_price(db_session, "AAPL", target, 150.0)

    # Stale snapshot row for an asset that has no trades at all
    db_session.execute(
        text("INSERT INTO finance_tracker.portfolio_snapshots "
             "(id, household_id, sub_portfolio_id, asset_id, date, quantity, current_price, exchange_rate_used) "
             "VALUES (:id, :hid, :spid, :aid, :d, 999, 1.0, 1.0)"),
        {"id": uuid.uuid7(), "hid": household_id, "spid": sp_id, "aid": asset_id, "d": target},
    )
    db_session.commit()

    run_daily_snapshot_targeted(db_session, household_id, target)

    snaps = db_session.query(PortfolioSnapshot).filter_by(
        household_id=household_id, date=target).all()
    assert snaps == []  # stale row removed; no trades → no new rows
