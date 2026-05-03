import pytest
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import uuid
from unittest.mock import patch

from sqlalchemy.orm import Session
from sqlalchemy import text

from src.models import (
    User, Household, FinancialAccount, SubPortfolio, Asset, Trade,
    PortfolioSnapshot, MarketPrice, LiquidityStatus, TaxTreatment,
    TradeType, HouseholdRoleType
)
from src.services.snapshot_engine import run_daily_snapshot

@pytest.fixture
def mock_market_prices():
    # Patch the fetch function to do nothing, preventing real yfinance network calls
    with patch("src.services.snapshot_engine.fetch_and_cache_market_prices") as mock_fetch:
        yield mock_fetch

def test_daily_snapshot_engine_calculation(db_session: Session, mock_market_prices):
    # 1. Setup test data
    user_id = uuid.uuid7()
    db_session.execute(
        text("INSERT INTO finance_tracker.users (id, email, preferred_timezone, salted_hashed_password, name, salt) VALUES (:id, 'test@snapshot.com', 'UTC', 'x', 'Test User', 'x')"),
        {"id": user_id}
    )
    
    household_id = uuid.uuid7()
    db_session.execute(
        text("INSERT INTO finance_tracker.households (id, name, base_currency, country_code, owner_id) VALUES (:id, 'Test Household', 'USD', 'US', :owner_id)"),
        {"id": household_id, "owner_id": user_id}
    )
    
    sp_id = uuid.uuid7()
    db_session.execute(
        text("INSERT INTO finance_tracker.sub_portfolios (id, household_id, name, risk_profile) VALUES (:id, :household_id, 'Test SubPortfolio', 'Moderate')"),
        {"id": sp_id, "household_id": household_id}
    )
    
    account_id = uuid.uuid7()
    db_session.execute(
        text("INSERT INTO finance_tracker.financial_accounts (id, household_id, name, liquidity, tax_status, currency) VALUES (:id, :household_id, 'Brokerage', 'market_liquid', 'taxable', 'USD')"),
        {"id": account_id, "household_id": household_id}
    )
    
    asset_id = uuid.uuid7()
    db_session.execute(
        text("INSERT INTO finance_tracker.assets (id, ticker, name, type, currency) VALUES (:id, 'AAPL', 'Apple', 'Stock', 'USD')"),
        {"id": asset_id}
    )
    
    target_date = date(2023, 10, 1)
    db_session.execute(
        text("INSERT INTO finance_tracker.market_prices (id, ticker, date, close_price, currency) VALUES (:id1, 'AAPL', :d1, 150.0, 'USD'), (:id2, 'AAPL', :d2, 145.0, 'USD')"),
        {"id1": uuid.uuid7(), "d1": target_date, "id2": uuid.uuid7(), "d2": target_date - timedelta(days=1)}
    )
    
    db_session.execute(
        text("INSERT INTO finance_tracker.trades (id, household_id, sub_portfolio_id, asset_id, account_id, trade_type, date, quantity, price, exchange_rate) VALUES "
             "(:id1, :hid, :spid, :aid, :accid, 'buy', :d1, 10.0, 100.0, 1.0), "
             "(:id2, :hid, :spid, :aid, :accid, 'buy', :d2, 10.0, 120.0, 1.0), "
             "(:id3, :hid, :spid, :aid, :accid, 'sell', :d3, 5.0, 130.0, 1.0)"),
        {
            "id1": uuid.uuid7(), "d1": datetime(2023, 9, 29, tzinfo=timezone.utc),
            "id2": uuid.uuid7(), "d2": datetime(2023, 9, 30, tzinfo=timezone.utc),
            "id3": uuid.uuid7(), "d3": datetime(2023, 10, 1, tzinfo=timezone.utc),
            "hid": household_id, "spid": sp_id, "aid": asset_id, "accid": account_id
        }
    )
    db_session.commit()
    
    # 4. Run snapshot for Oct 1
    run_daily_snapshot(db_session, target_date)
    
    # 5. Verify snapshot results
    snapshot = db_session.query(PortfolioSnapshot).filter_by(sub_portfolio_id=sp_id, asset_id=asset_id, date=target_date).first()
    
    assert snapshot is not None
    assert snapshot.quantity == 15.0
    assert float(snapshot.average_cost_basis) == 110.0
    assert float(snapshot.current_price) == 150.0
    assert float(snapshot.current_value_home_currency) == 2250.0
    
    run_daily_snapshot(db_session, target_date)
    snapshots = db_session.query(PortfolioSnapshot).filter_by(sub_portfolio_id=sp_id, asset_id=asset_id, date=target_date).all()
    assert len(snapshots) == 1

def test_daily_snapshot_engine_transaction_rollback(db_session: Session, mock_market_prices):
    # This test verifies that if one sub-portfolio fails, others still succeed
    user_id = uuid.uuid7()
    db_session.execute(
        text("INSERT INTO finance_tracker.users (id, email, preferred_timezone, salted_hashed_password, name, salt) VALUES (:id, 'fail_test@snapshot.com', 'UTC', 'x', 'Test User', 'x')"),
        {"id": user_id}
    )
    
    household_id = uuid.uuid7()
    db_session.execute(
        text("INSERT INTO finance_tracker.households (id, name, base_currency, country_code, owner_id) VALUES (:id, 'Test Household 2', 'USD', 'US', :owner_id)"),
        {"id": household_id, "owner_id": user_id}
    )
    
    sp_success_id = uuid.uuid7()
    sp_fail_id = uuid.uuid7()
    db_session.execute(
        text("INSERT INTO finance_tracker.sub_portfolios (id, household_id, name, risk_profile) VALUES (:id1, :hid, 'Success SP', 'Moderate'), (:id2, :hid, 'Fail SP', 'Moderate')"),
        {"id1": sp_success_id, "id2": sp_fail_id, "hid": household_id}
    )
    
    acc_id = uuid.uuid7()
    db_session.execute(
        text("INSERT INTO finance_tracker.financial_accounts (id, household_id, name, liquidity, tax_status, currency) VALUES (:id, :hid, 'Brokerage 2', 'market_liquid', 'taxable', 'USD')"),
        {"id": acc_id, "hid": household_id}
    )
    
    asset_id = uuid.uuid7()
    db_session.execute(
        text("INSERT INTO finance_tracker.assets (id, ticker, name, type, currency) VALUES (:id, 'MSFT', 'Microsoft', 'Stock', 'USD')"),
        {"id": asset_id}
    )
    
    target_date = date(2023, 10, 2)
    db_session.execute(
        text("INSERT INTO finance_tracker.market_prices (id, ticker, date, close_price, currency) VALUES (:id, 'MSFT', :d, 300.0, 'USD')"),
        {"id": uuid.uuid7(), "d": target_date}
    )
    
    db_session.execute(
        text("INSERT INTO finance_tracker.trades (id, household_id, sub_portfolio_id, asset_id, account_id, trade_type, date, quantity, price, exchange_rate) VALUES "
             "(:id1, :hid, :sp_s_id, :aid, :accid, 'buy', :d1, 10.0, 300.0, 1.0), "
             "(:id2, :hid, :sp_f_id, :aid, :accid, 'buy', :d2, 5.0, 300.0, 1.0)"),
        {
            "id1": uuid.uuid7(), "d1": datetime(2023, 10, 2, tzinfo=timezone.utc),
            "id2": uuid.uuid7(), "d2": datetime(2023, 10, 2, tzinfo=timezone.utc),
            "hid": household_id, "sp_s_id": sp_success_id, "sp_f_id": sp_fail_id, "aid": asset_id, "accid": acc_id
        }
    )
    db_session.commit()
    
    original_float = float
    def mocked_float(val):
        pass

    with patch("src.services.snapshot_engine.float") as mock_float:
        def side_effect(val):
            if val == 5.0:
                raise ValueError("Simulated failure for sp_fail")
            return original_float(val)
            
        mock_float.side_effect = side_effect
        
        # Run engine
        run_daily_snapshot(db_session, target_date)
        
    # Verify sp_success worked
    snapshot_success = db_session.query(PortfolioSnapshot).filter_by(sub_portfolio_id=sp_success_id, date=target_date).first()
    assert snapshot_success is not None
    assert snapshot_success.quantity == 10.0
    
    # Verify sp_fail rolled back and has no snapshot
    snapshot_fail = db_session.query(PortfolioSnapshot).filter_by(sub_portfolio_id=sp_fail_id, date=target_date).first()
    assert snapshot_fail is None
