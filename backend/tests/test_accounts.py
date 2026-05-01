import uuid
import pytest
from httpx import AsyncClient
from decimal import Decimal
from datetime import date
from src.main import app
from src import models

@pytest.fixture
def test_user(db_session):
    user = models.User(
        id=uuid.uuid4(),
        email="test_accounts@example.com",
        name="Test User",
        salted_hashed_password="fakehash",
        salt="fakesalt",
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user

@pytest.fixture
def auth_headers(client, test_user, db_session):
    from src.auth import create_access_token
    token = create_access_token(data={"sub": str(test_user.id)})
    return {"Authorization": f"Bearer {token}"}

@pytest.fixture
def test_household(db_session, test_user):
    household = models.Household(
        id=uuid.uuid4(),
        name="Test Household",
        base_currency="USD",
        country_code="US",
        owner_id=test_user.id,
    )
    db_session.add(household)
    db_session.commit()
    db_session.refresh(household)
    return household

def test_create_account(client, auth_headers, test_household):
    response = client.post(
        "/accounts/",
        headers=auth_headers,
        json={
            "household_id": str(test_household.id),
            "name": "Checking Account",
            "liquidity": "liquid",
            "tax_status": "taxable",
            "currency": "USD"
        }
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Checking Account"
    assert "id" in data

def test_get_household_accounts(client, auth_headers, test_household, db_session):
    account = models.FinancialAccount(
        id=uuid.uuid4(),
        household_id=test_household.id,
        name="Savings Account",
        liquidity="liquid",
        tax_status="taxable",
        currency="USD"
    )
    db_session.add(account)
    db_session.commit()

    response = client.get(
        f"/accounts/household/{test_household.id}",
        headers=auth_headers
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 1
    assert any(acc["name"] == "Savings Account" for acc in data)

def test_update_account(client, auth_headers, test_household, db_session):
    account = models.FinancialAccount(
        id=uuid.uuid4(),
        household_id=test_household.id,
        name="Old Name",
        liquidity="liquid",
        tax_status="taxable",
        currency="USD"
    )
    db_session.add(account)
    db_session.commit()

    response = client.put(
        f"/accounts/{account.id}",
        headers=auth_headers,
        json={"name": "New Name"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "New Name"

def test_delete_account(client, auth_headers, test_household, db_session):
    account = models.FinancialAccount(
        id=uuid.uuid4(),
        household_id=test_household.id,
        name="To Delete",
        liquidity="liquid",
        tax_status="taxable",
        currency="USD"
    )
    db_session.add(account)
    db_session.commit()

    response = client.delete(f"/accounts/{account.id}", headers=auth_headers)
    assert response.status_code == 204

    # Verify it's gone
    assert db_session.query(models.FinancialAccount).filter_by(id=account.id).first() is None

def test_add_account_balance(client, auth_headers, test_household, db_session):
    account = models.FinancialAccount(
        id=uuid.uuid4(),
        household_id=test_household.id,
        name="Balance Account",
        liquidity="liquid",
        tax_status="taxable",
        currency="USD"
    )
    db_session.add(account)
    db_session.commit()

    response = client.post(
        "/accounts/balances",
        headers=auth_headers,
        json={
            "account_id": str(account.id),
            "date": "2023-10-01",
            "balance": "1000.50"
        }
    )
    assert response.status_code == 201
    data = response.json()
    assert data["balance"] == "1000.50"

def test_get_account_balances(client, auth_headers, test_household, db_session):
    account = models.FinancialAccount(
        id=uuid.uuid4(),
        household_id=test_household.id,
        name="Balance Fetch Account",
        liquidity="liquid",
        tax_status="taxable",
        currency="USD"
    )
    db_session.add(account)
    db_session.commit()

    balance = models.AccountBalance(
        id=uuid.uuid4(),
        account_id=account.id,
        date=date(2023, 10, 1),
        balance=Decimal("500.00")
    )
    db_session.add(balance)
    db_session.commit()

    response = client.get(
        f"/accounts/balances/account/{account.id}",
        headers=auth_headers
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["balance"] == "500.00"

def test_update_account_balance(client, auth_headers, test_household, db_session):
    account = models.FinancialAccount(
        id=uuid.uuid4(),
        household_id=test_household.id,
        name="Balance Update Account",
        liquidity="liquid",
        tax_status="taxable",
        currency="USD"
    )
    db_session.add(account)
    db_session.commit()

    balance = models.AccountBalance(
        id=uuid.uuid4(),
        account_id=account.id,
        date=date(2023, 10, 1),
        balance=Decimal("500.00")
    )
    db_session.add(balance)
    db_session.commit()

    response = client.put(
        f"/accounts/balances/{balance.id}",
        headers=auth_headers,
        json={
            "balance": "750.25"
        }
    )
    assert response.status_code == 200
    data = response.json()
    assert data["balance"] == "750.25"

def test_delete_account_balance(client, auth_headers, test_household, db_session):
    account = models.FinancialAccount(
        id=uuid.uuid4(),
        household_id=test_household.id,
        name="Balance Delete Account",
        liquidity="liquid",
        tax_status="taxable",
        currency="USD"
    )
    db_session.add(account)
    db_session.commit()

    balance = models.AccountBalance(
        id=uuid.uuid4(),
        account_id=account.id,
        date=date(2023, 10, 1),
        balance=Decimal("500.00")
    )
    db_session.add(balance)
    db_session.commit()

    response = client.delete(
        f"/accounts/balances/{balance.id}",
        headers=auth_headers
    )
    assert response.status_code == 204

    assert db_session.query(models.AccountBalance).filter_by(id=balance.id).first() is None
