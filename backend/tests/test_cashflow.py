import uuid
import pytest
from decimal import Decimal
from datetime import datetime, timezone
from src import models

@pytest.fixture
def test_user(db_session):
    user = models.User(
        id=uuid.uuid4(),
        email="test_cashflow@example.com",
        name="Cashflow User",
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
        id=uuid.uuid4(),
        name="Cashflow Household",
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
        id=uuid.uuid4(),
        household_id=test_household.id,
        name="Checking",
        liquidity="liquid",
        tax_status="taxable",
        currency="USD"
    )
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)
    return account

# --- CATEGORY TESTS ---

def test_create_category(client, auth_headers, test_household):
    response = client.post(
        "/cashflow/categories",
        headers=auth_headers,
        json={
            "household_id": str(test_household.id),
            "name": "Groceries",
            "type": "expense"
        }
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Groceries"
    assert data["type"] == "expense"

def test_get_household_categories(client, auth_headers, test_household, db_session):
    category = models.Category(
        id=uuid.uuid4(),
        household_id=test_household.id,
        name="Salary",
        type="income"
    )
    db_session.add(category)
    db_session.commit()

    response = client.get(
        f"/cashflow/categories/household/{test_household.id}",
        headers=auth_headers
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 1
    assert any(cat["name"] == "Salary" for cat in data)

def test_update_category(client, auth_headers, test_household, db_session):
    category = models.Category(
        id=uuid.uuid4(),
        household_id=test_household.id,
        name="Old Salary",
        type="income"
    )
    db_session.add(category)
    db_session.commit()

    response = client.put(
        f"/cashflow/categories/{category.id}",
        headers=auth_headers,
        json={"name": "New Salary"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "New Salary"

def test_delete_category(client, auth_headers, test_household, db_session):
    category = models.Category(
        id=uuid.uuid4(),
        household_id=test_household.id,
        name="Delete Me",
        type="expense"
    )
    db_session.add(category)
    db_session.commit()

    response = client.delete(
        f"/cashflow/categories/{category.id}",
        headers=auth_headers
    )
    assert response.status_code == 204
    assert db_session.query(models.Category).filter_by(id=category.id).first() is None


# --- TRANSACTION TESTS ---

@pytest.fixture
def test_category(db_session, test_household):
    category = models.Category(
        id=uuid.uuid4(),
        household_id=test_household.id,
        name="Utilities",
        type="expense"
    )
    db_session.add(category)
    db_session.commit()
    db_session.refresh(category)
    return category

def test_log_transaction(client, auth_headers, test_account, test_category):
    response = client.post(
        "/cashflow/transactions",
        headers=auth_headers,
        json={
            "account_id": str(test_account.id),
            "category_id": str(test_category.id),
            "date": datetime.now(timezone.utc).isoformat(),
            "amount": "150.00",
            "description": "Electric bill"
        }
    )
    assert response.status_code == 201
    data = response.json()
    assert data["amount"] == "150.00"
    assert data["description"] == "Electric bill"

def test_get_household_transactions(client, auth_headers, test_household, test_account, test_category, db_session):
    transaction = models.Transaction(
        id=uuid.uuid4(),
        account_id=test_account.id,
        category_id=test_category.id,
        date=datetime.now(timezone.utc),
        amount=Decimal("50.00"),
        description="Water bill",
        transaction_type=test_category.type
    )
    db_session.add(transaction)
    db_session.commit()

    response = client.get(
        f"/cashflow/transactions/household/{test_household.id}",
        headers=auth_headers
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 1
    assert any(txn["description"] == "Water bill" for txn in data)

def test_update_transaction(client, auth_headers, test_account, test_category, db_session):
    transaction = models.Transaction(
        id=uuid.uuid4(),
        account_id=test_account.id,
        category_id=test_category.id,
        date=datetime.now(timezone.utc),
        amount=Decimal("50.00"),
        description="Old description",
        transaction_type=test_category.type
    )
    db_session.add(transaction)
    db_session.commit()

    response = client.put(
        f"/cashflow/transactions/{transaction.id}",
        headers=auth_headers,
        json={
            "description": "New description",
            "amount": "60.00"
        }
    )
    assert response.status_code == 200
    data = response.json()
    assert data["description"] == "New description"
    assert data["amount"] == "60.00"

def test_delete_transaction(client, auth_headers, test_account, test_category, db_session):
    transaction = models.Transaction(
        id=uuid.uuid4(),
        account_id=test_account.id,
        category_id=test_category.id,
        date=datetime.now(timezone.utc),
        amount=Decimal("50.00"),
        description="Delete me",
        transaction_type=test_category.type
    )
    db_session.add(transaction)
    db_session.commit()

    response = client.delete(
        f"/cashflow/transactions/{transaction.id}",
        headers=auth_headers
    )
    assert response.status_code == 204
    assert db_session.query(models.Transaction).filter_by(id=transaction.id).first() is None
