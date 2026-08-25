import uuid
import pytest
from decimal import Decimal
from datetime import datetime, timezone
from src import models

@pytest.fixture
def test_user(db_session):
    user = models.User(
        id=uuid.uuid7(),
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
        id=uuid.uuid7(),
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
        id=uuid.uuid7(),
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

@pytest.fixture
def other_user(db_session):
    user = models.User(
        id=uuid.uuid7(),
        email="other_cashflow@example.com",
        name="Other User",
        salted_hashed_password="fakehash",
        salt="fakesalt",
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user

@pytest.fixture
def other_auth_headers(client, other_user):
    from src.auth import create_access_token
    token = create_access_token(data={"sub": str(other_user.id)})
    return {"Authorization": f"Bearer {token}"}

@pytest.fixture
def other_household(db_session, other_user):
    household = models.Household(
        id=uuid.uuid7(),
        name="Other Household",
        base_currency="USD",
        country_code="US",
        owner_id=other_user.id,
    )
    db_session.add(household)
    db_session.commit()
    db_session.refresh(household)
    return household

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

def test_create_category_unauthorized(client, other_auth_headers, test_household):
    response = client.post(
        "/cashflow/categories",
        headers=other_auth_headers,
        json={
            "household_id": str(test_household.id),
            "name": "Groceries",
            "type": "expense"
        }
    )
    assert response.status_code == 403

def test_get_household_categories(client, auth_headers, test_household, db_session):
    category = models.Category(
        id=uuid.uuid7(),
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

def test_get_household_categories_unauthorized(client, other_auth_headers, test_household):
    response = client.get(
        f"/cashflow/categories/household/{test_household.id}",
        headers=other_auth_headers
    )
    assert response.status_code == 403

def test_update_category(client, auth_headers, test_household, db_session):
    category = models.Category(
        id=uuid.uuid7(),
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

def test_update_category_not_found(client, auth_headers):
    response = client.put(
        f"/cashflow/categories/{uuid.uuid7()}",
        headers=auth_headers,
        json={"name": "New Salary"}
    )
    assert response.status_code == 404

def test_update_category_unauthorized(client, other_auth_headers, test_household, db_session):
    category = models.Category(
        id=uuid.uuid7(),
        household_id=test_household.id,
        name="Old Salary",
        type="income"
    )
    db_session.add(category)
    db_session.commit()

    response = client.put(
        f"/cashflow/categories/{category.id}",
        headers=other_auth_headers,
        json={"name": "New Salary"}
    )
    assert response.status_code == 403

def test_delete_category(client, auth_headers, test_household, db_session):
    category = models.Category(
        id=uuid.uuid7(),
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

def test_delete_category_not_found(client, auth_headers):
    response = client.delete(
        f"/cashflow/categories/{uuid.uuid7()}",
        headers=auth_headers
    )
    assert response.status_code == 404

def test_delete_category_unauthorized(client, other_auth_headers, test_household, db_session):
    category = models.Category(
        id=uuid.uuid7(),
        household_id=test_household.id,
        name="Delete Me",
        type="expense"
    )
    db_session.add(category)
    db_session.commit()

    response = client.delete(
        f"/cashflow/categories/{category.id}",
        headers=other_auth_headers
    )
    assert response.status_code == 403


# --- TRANSACTION TESTS ---

@pytest.fixture
def test_category(db_session, test_household):
    category = models.Category(
        id=uuid.uuid7(),
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

def test_log_transaction_account_not_found(client, auth_headers, test_category):
    response = client.post(
        "/cashflow/transactions",
        headers=auth_headers,
        json={
            "account_id": str(uuid.uuid7()),
            "category_id": str(test_category.id),
            "date": datetime.now(timezone.utc).isoformat(),
            "amount": "150.00",
            "description": "Electric bill"
        }
    )
    assert response.status_code == 404

def test_log_transaction_category_not_found(client, auth_headers, test_account):
    response = client.post(
        "/cashflow/transactions",
        headers=auth_headers,
        json={
            "account_id": str(test_account.id),
            "category_id": str(uuid.uuid7()),
            "date": datetime.now(timezone.utc).isoformat(),
            "amount": "150.00",
            "description": "Electric bill"
        }
    )
    assert response.status_code == 404

def test_log_transaction_unauthorized(client, other_auth_headers, test_account, test_category):
    response = client.post(
        "/cashflow/transactions",
        headers=other_auth_headers,
        json={
            "account_id": str(test_account.id),
            "category_id": str(test_category.id),
            "date": datetime.now(timezone.utc).isoformat(),
            "amount": "150.00",
            "description": "Electric bill"
        }
    )
    assert response.status_code == 403

def test_log_transaction_mismatched_household(client, auth_headers, test_account, other_household, db_session):
    category = models.Category(
        id=uuid.uuid7(),
        household_id=other_household.id,
        name="Other Groceries",
        type="expense"
    )
    db_session.add(category)
    db_session.commit()

    response = client.post(
        "/cashflow/transactions",
        headers=auth_headers,
        json={
            "account_id": str(test_account.id),
            "category_id": str(category.id),
            "date": datetime.now(timezone.utc).isoformat(),
            "amount": "150.00",
            "description": "Electric bill"
        }
    )
    assert response.status_code == 400

def test_get_household_transactions(client, auth_headers, test_household, test_account, test_category, db_session):
    transaction = models.Transaction(
        id=uuid.uuid7(),
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

def test_get_household_transactions_limit_returns_the_newest_rows(
    client, auth_headers, test_household, test_account, test_category, db_session
):
    """`limit` is what keeps the Dashboard from downloading a whole history for five rows."""
    from datetime import timedelta

    base = datetime.now(timezone.utc)
    for day in range(6):
        db_session.add(models.Transaction(
            id=uuid.uuid7(),
            account_id=test_account.id,
            category_id=test_category.id,
            # Oldest first, so "newest N" can't accidentally be satisfied by insertion order.
            date=base - timedelta(days=10 - day),
            amount=Decimal("10.00"),
            description=f"txn-{day}",
            transaction_type=test_category.type,
        ))
    db_session.commit()

    response = client.get(
        f"/cashflow/transactions/household/{test_household.id}?limit=2",
        headers=auth_headers
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2
    assert [txn["description"] for txn in data] == ["txn-5", "txn-4"]


def test_get_household_transactions_without_limit_returns_everything(
    client, auth_headers, test_household, test_account, test_category, db_session
):
    """The unlimited path is what the Transactions screens use; it must stay uncapped."""
    for index in range(4):
        db_session.add(models.Transaction(
            id=uuid.uuid7(),
            account_id=test_account.id,
            category_id=test_category.id,
            date=datetime.now(timezone.utc),
            amount=Decimal("10.00"),
            description=f"all-{index}",
            transaction_type=test_category.type,
        ))
    db_session.commit()

    response = client.get(
        f"/cashflow/transactions/household/{test_household.id}",
        headers=auth_headers
    )
    assert response.status_code == 200
    assert len(response.json()) == 4


def test_get_household_transactions_rejects_a_nonsense_limit(
    client, auth_headers, test_household
):
    response = client.get(
        f"/cashflow/transactions/household/{test_household.id}?limit=0",
        headers=auth_headers
    )
    assert response.status_code == 422


def test_get_household_transactions_unauthorized(client, other_auth_headers, test_household):
    response = client.get(
        f"/cashflow/transactions/household/{test_household.id}",
        headers=other_auth_headers
    )
    assert response.status_code == 403

def test_update_transaction(client, auth_headers, test_account, test_category, db_session):
    transaction = models.Transaction(
        id=uuid.uuid7(),
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

def test_update_transaction_reassign_category(client, auth_headers, test_account, test_category, test_household, db_session):
    """Reassigning a transaction's category by UUID must succeed and flip the derived
    income/expense type. Regression: TransactionUpdate.category_id was typed Optional[int],
    which rejected UUIDs with a 422."""
    income_category = models.Category(
        id=uuid.uuid7(),
        household_id=test_household.id,
        name="Salary",
        type="income",
    )
    db_session.add(income_category)
    db_session.commit()

    transaction = models.Transaction(
        id=uuid.uuid7(),
        account_id=test_account.id,
        category_id=test_category.id,
        date=datetime.now(timezone.utc),
        amount=Decimal("50.00"),
        description="Reassign me",
        transaction_type=test_category.type,
    )
    db_session.add(transaction)
    db_session.commit()

    response = client.put(
        f"/cashflow/transactions/{transaction.id}",
        headers=auth_headers,
        json={"category_id": str(income_category.id)},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["category_id"] == str(income_category.id)
    # Sign is derived from the category, so the type must follow the new category.
    assert data["transaction_type"] == "income"

def test_update_transaction_not_found(client, auth_headers):
    response = client.put(
        f"/cashflow/transactions/{uuid.uuid7()}",
        headers=auth_headers,
        json={
            "description": "New description",
            "amount": "60.00"
        }
    )
    assert response.status_code == 404

def test_update_transaction_unauthorized(client, other_auth_headers, test_account, test_category, db_session):
    transaction = models.Transaction(
        id=uuid.uuid7(),
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
        headers=other_auth_headers,
        json={
            "description": "New description",
            "amount": "60.00"
        }
    )
    assert response.status_code == 403

def test_delete_transaction(client, auth_headers, test_account, test_category, db_session):
    transaction = models.Transaction(
        id=uuid.uuid7(),
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

def test_delete_transaction_not_found(client, auth_headers):
    response = client.delete(
        f"/cashflow/transactions/{uuid.uuid7()}",
        headers=auth_headers
    )
    assert response.status_code == 404

def test_delete_transaction_unauthorized(client, other_auth_headers, test_account, test_category, db_session):
    transaction = models.Transaction(
        id=uuid.uuid7(),
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
        headers=other_auth_headers
    )
    assert response.status_code == 403
