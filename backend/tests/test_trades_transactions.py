import uuid
import pytest
from decimal import Decimal
from datetime import datetime, timezone
from src import models

@pytest.fixture
def test_user(db_session):
    user = models.User(
        id=uuid.uuid7(),
        email="trade_sync@example.com",
        name="Sync User",
        salted_hashed_password="fakehash",
        salt="fakesalt",
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user

@pytest.fixture
def auth_headers(client, test_user):
    from src.auth import create_access_token
    token = create_access_token(data={"sub": str(test_user.id)})
    return {"Authorization": f"Bearer {token}"}

@pytest.fixture
def test_household(db_session, test_user):
    household = models.Household(
        id=uuid.uuid7(),
        name="Sync Household",
        base_currency="USD",
        country_code="US",
        owner_id=test_user.id,
    )
    db_session.add(household)
    db_session.commit()
    db_session.refresh(household)
    return household

@pytest.fixture
def test_account(db_session, test_household):
    account = models.FinancialAccount(
        id=uuid.uuid7(),
        household_id=test_household.id,
        name="Sync Brokerage",
        liquidity="liquid",
        tax_status="taxable",
        currency="USD"
    )
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)
    return account

@pytest.fixture
def test_subportfolio(db_session, test_household):
    sub = models.SubPortfolio(
        id=uuid.uuid7(),
        household_id=test_household.id,
        name="Sync Subportfolio",
        risk_profile="high"
    )
    db_session.add(sub)
    db_session.commit()
    db_session.refresh(sub)
    return sub

@pytest.fixture
def test_asset(db_session):
    asset = models.Asset(
        id=uuid.uuid7(),
        ticker="SYNC",
        name="Sync Asset",
        type="stock",
        currency="USD"
    )
    db_session.add(asset)
    db_session.commit()
    db_session.refresh(asset)
    return asset

def test_trade_creation_creates_transaction(client, auth_headers, test_household, test_subportfolio, test_asset, test_account, db_session):
    # 1. Execute a buy trade
    response = client.post(
        "/portfolio/trades",
        headers=auth_headers,
        json={
            "household_id": str(test_household.id),
            "sub_portfolio_id": str(test_subportfolio.id),
            "asset_id": str(test_asset.id),
            "account_id": str(test_account.id),
            "type": "buy",
            "date": datetime.now(timezone.utc).isoformat(),
            "quantity": 10.0,
            "price": "100.00",
            "exchange_rate": 1.0
        }
    )
    assert response.status_code == 201
    trade_id = response.json()["id"]
    
    # 2. Verify trade has a transaction_id
    db_trade = db_session.query(models.Trade).filter(models.Trade.id == trade_id).first()
    assert db_trade.transaction_id is not None
    
    # 3. Verify transaction details
    db_transaction = db_session.query(models.Transaction).filter(models.Transaction.id == db_trade.transaction_id).first()
    assert db_transaction is not None
    assert db_transaction.account_id == test_account.id
    assert db_transaction.amount == Decimal("1000.00")
    assert db_transaction.transaction_type == models.TransactionType.expense
    assert "Trade: Buy" in db_transaction.description
    
    # 4. Verify category is "Investment"
    category = db_session.query(models.Category).filter(models.Category.id == db_transaction.category_id).first()
    assert category.name == "Investment"

def test_trade_update_updates_transaction(client, auth_headers, test_household, test_subportfolio, test_asset, test_account, db_session):
    # 1. Execute a trade
    response = client.post(
        "/portfolio/trades",
        headers=auth_headers,
        json={
            "household_id": str(test_household.id),
            "sub_portfolio_id": str(test_subportfolio.id),
            "asset_id": str(test_asset.id),
            "account_id": str(test_account.id),
            "type": "buy",
            "date": datetime.now(timezone.utc).isoformat(),
            "quantity": 10.0,
            "price": "100.00",
            "exchange_rate": 1.0
        }
    )
    trade_id = response.json()["id"]
    db_trade = db_session.query(models.Trade).filter(models.Trade.id == trade_id).first()
    trans_id = db_trade.transaction_id
    
    # 2. Update trade quantity
    response = client.put(
        f"/portfolio/trades/{trade_id}",
        headers=auth_headers,
        json={"quantity": 20.0}
    )
    assert response.status_code == 200
    
    # 3. Verify transaction updated
    db_transaction = db_session.query(models.Transaction).filter(models.Transaction.id == trans_id).first()
    assert db_transaction.amount == Decimal("2000.00")
    assert "20" in db_transaction.description

def test_trade_deletion_deletes_transaction(client, auth_headers, test_household, test_subportfolio, test_asset, test_account, db_session):
    # 1. Execute a trade
    response = client.post(
        "/portfolio/trades",
        headers=auth_headers,
        json={
            "household_id": str(test_household.id),
            "sub_portfolio_id": str(test_subportfolio.id),
            "asset_id": str(test_asset.id),
            "account_id": str(test_account.id),
            "type": "buy",
            "date": datetime.now(timezone.utc).isoformat(),
            "quantity": 10.0,
            "price": "100.00",
            "exchange_rate": 1.0
        }
    )
    trade_id = response.json()["id"]
    db_trade = db_session.query(models.Trade).filter(models.Trade.id == trade_id).first()
    trans_id = db_trade.transaction_id
    
    # 2. Delete trade
    response = client.delete(f"/portfolio/trades/{trade_id}", headers=auth_headers)
    assert response.status_code == 204
    
    # 3. Verify both deleted
    assert db_session.query(models.Trade).filter(models.Trade.id == trade_id).first() is None
    assert db_session.query(models.Transaction).filter(models.Transaction.id == trans_id).first() is None
