import uuid
import pytest
from decimal import Decimal
from datetime import date
from src import models

@pytest.fixture
def test_user(db_session):
    user = models.User(
        id=uuid.uuid7(),
        email="balance_sync@example.com",
        name="Balance User",
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
        name="Balance Household",
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
        name="Test Account",
        liquidity="liquid",
        tax_status="taxable",
        currency="USD"
    )
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)
    return account

@pytest.fixture
def test_category(db_session, test_household):
    category = models.Category(
        id=uuid.uuid7(),
        household_id=test_household.id,
        name="Income Category",
        type="income"
    )
    db_session.add(category)
    db_session.commit()
    db_session.refresh(category)
    return category

def test_transaction_syncs_to_balance(client, auth_headers, test_account, test_category, db_session):
    # 1. Add initial manual balance
    client.post("/accounts/balances", headers=auth_headers, json={
        "account_id": str(test_account.id),
        "date": "2023-10-01",
        "balance": "1000.00"
    })
    
    # 2. Add transaction on Oct 5
    client.post("/cashflow/transactions", headers=auth_headers, json={
        "account_id": str(test_account.id),
        "category_id": str(test_category.id),
        "date": "2023-10-05T12:00:00Z",
        "amount": "50.00",
        "description": "Test Income"
    })
    
    # 3. Verify balance record created for Oct 5
    bal = db_session.query(models.AccountBalance).filter(
        models.AccountBalance.account_id == test_account.id,
        models.AccountBalance.date == date(2023, 10, 5)
    ).first()
    assert bal is not None
    assert bal.balance == Decimal("1050.00")
    assert bal.is_manual is False

def test_propagation_stops_at_manual(client, auth_headers, test_account, test_category, db_session):
    # 1. Manual balance on Oct 1
    client.post("/accounts/balances", headers=auth_headers, json={
        "account_id": str(test_account.id),
        "date": "2023-10-01",
        "balance": "100.00"
    })
    
    # 2. Manual balance on Oct 10
    client.post("/accounts/balances", headers=auth_headers, json={
        "account_id": str(test_account.id),
        "date": "2023-10-10",
        "balance": "1000.00"
    })
    
    # 3. Transaction on Oct 5 (+50)
    client.post("/cashflow/transactions", headers=auth_headers, json={
        "account_id": str(test_account.id),
        "category_id": str(test_category.id),
        "date": "2023-10-05T12:00:00Z",
        "amount": "50.00",
        "description": "Test"
    })
    
    # 4. Oct 5 should be 150
    bal_oct5 = db_session.query(models.AccountBalance).filter_by(date=date(2023, 10, 5)).first()
    assert bal_oct5.balance == Decimal("150.00")
    
    # 5. Oct 10 should STILL be 1000
    bal_oct10 = db_session.query(models.AccountBalance).filter_by(date=date(2023, 10, 10)).first()
    assert bal_oct10.balance == Decimal("1000.00")

def test_propagation_through_auto_records(client, auth_headers, test_account, test_category, db_session):
    # 1. Oct 1 Manual 100
    client.post("/accounts/balances", headers=auth_headers, json={"account_id": str(test_account.id), "date": "2023-10-01", "balance": "100.00"})
    
    # 2. Oct 5 Transaction +50 (Auto Oct 5: 150)
    client.post("/cashflow/transactions", headers=auth_headers, json={"account_id": str(test_account.id), "category_id": str(test_category.id), "date": "2023-10-05T12:00:00Z", "amount": "50.00", "description": "T1"})
    
    # 3. Oct 7 Transaction +20 (Auto Oct 7: 170)
    client.post("/cashflow/transactions", headers=auth_headers, json={"account_id": str(test_account.id), "category_id": str(test_category.id), "date": "2023-10-07T12:00:00Z", "amount": "20.00", "description": "T2"})
    
    # 4. Add transaction on Oct 3 (+10)
    client.post("/cashflow/transactions", headers=auth_headers, json={"account_id": str(test_account.id), "category_id": str(test_category.id), "date": "2023-10-03T12:00:00Z", "amount": "10.00", "description": "T3"})
    
    # Oct 3: 110
    # Oct 5: 150 + 10 = 160
    # Oct 7: 170 + 10 = 180
    assert db_session.query(models.AccountBalance).filter_by(date=date(2023, 10, 3)).first().balance == Decimal("110.00")
    assert db_session.query(models.AccountBalance).filter_by(date=date(2023, 10, 5)).first().balance == Decimal("160.00")
    assert db_session.query(models.AccountBalance).filter_by(date=date(2023, 10, 7)).first().balance == Decimal("180.00")
