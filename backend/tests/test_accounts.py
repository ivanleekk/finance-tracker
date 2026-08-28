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
        id=uuid.uuid7(),
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
        id=uuid.uuid7(),
        name="Test Household",
        base_currency="USD",
        country_code="US",
        owner_id=test_user.id,
    )
    db_session.add(household)
    db_session.commit()
    db_session.refresh(household)
    return household

@pytest.fixture
def other_user(db_session):
    user = models.User(
        id=uuid.uuid7(),
        email="other_accounts@example.com",
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

def test_create_account_unauthorized(client, other_auth_headers, test_household):
    response = client.post(
        "/accounts/",
        headers=other_auth_headers,
        json={
            "household_id": str(test_household.id),
            "name": "Checking Account",
            "liquidity": "liquid",
            "tax_status": "taxable",
            "currency": "USD"
        }
    )
    assert response.status_code == 403

def test_get_household_accounts(client, auth_headers, test_household, db_session):
    account = models.FinancialAccount(
        id=uuid.uuid7(),
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

def test_get_household_accounts_unauthorized(client, other_auth_headers, test_household):
    response = client.get(
        f"/accounts/household/{test_household.id}",
        headers=other_auth_headers
    )
    assert response.status_code == 403

def test_update_account(client, auth_headers, test_household, db_session):
    account = models.FinancialAccount(
        id=uuid.uuid7(),
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

def test_update_account_not_found(client, auth_headers):
    response = client.put(
        f"/accounts/{uuid.uuid7()}",
        headers=auth_headers,
        json={"name": "New Name"}
    )
    assert response.status_code == 404

def test_update_account_unauthorized(client, other_auth_headers, test_household, db_session):
    account = models.FinancialAccount(
        id=uuid.uuid7(),
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
        headers=other_auth_headers,
        json={"name": "New Name"}
    )
    assert response.status_code == 403

def test_delete_account(client, auth_headers, test_household, db_session):
    account = models.FinancialAccount(
        id=uuid.uuid7(),
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

def test_delete_account_not_found(client, auth_headers):
    response = client.delete(f"/accounts/{uuid.uuid7()}", headers=auth_headers)
    assert response.status_code == 404

def test_delete_account_unauthorized(client, other_auth_headers, test_household, db_session):
    account = models.FinancialAccount(
        id=uuid.uuid7(),
        household_id=test_household.id,
        name="To Delete",
        liquidity="liquid",
        tax_status="taxable",
        currency="USD"
    )
    db_session.add(account)
    db_session.commit()

    response = client.delete(f"/accounts/{account.id}", headers=other_auth_headers)
    assert response.status_code == 403

def test_add_account_balance(client, auth_headers, test_household, db_session):
    account = models.FinancialAccount(
        id=uuid.uuid7(),
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

def test_add_account_balance_account_not_found(client, auth_headers):
    response = client.post(
        "/accounts/balances",
        headers=auth_headers,
        json={
            "account_id": str(uuid.uuid7()),
            "date": "2023-10-01",
            "balance": "1000.50"
        }
    )
    assert response.status_code == 404

def test_add_account_balance_unauthorized(client, other_auth_headers, test_household, db_session):
    account = models.FinancialAccount(
        id=uuid.uuid7(),
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
        headers=other_auth_headers,
        json={
            "account_id": str(account.id),
            "date": "2023-10-01",
            "balance": "1000.50"
        }
    )
    assert response.status_code == 403

def test_get_account_balances(client, auth_headers, test_household, db_session):
    account = models.FinancialAccount(
        id=uuid.uuid7(),
        household_id=test_household.id,
        name="Balance Fetch Account",
        liquidity="liquid",
        tax_status="taxable",
        currency="USD"
    )
    db_session.add(account)
    db_session.commit()

    balance = models.AccountBalance(
        id=uuid.uuid7(),
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

def test_get_account_balances_not_found(client, auth_headers):
    response = client.get(
        f"/accounts/balances/account/{uuid.uuid7()}",
        headers=auth_headers
    )
    assert response.status_code == 404

def test_get_account_balances_unauthorized(client, other_auth_headers, test_household, db_session):
    account = models.FinancialAccount(
        id=uuid.uuid7(),
        household_id=test_household.id,
        name="Balance Fetch Account",
        liquidity="liquid",
        tax_status="taxable",
        currency="USD"
    )
    db_session.add(account)
    db_session.commit()

    response = client.get(
        f"/accounts/balances/account/{account.id}",
        headers=other_auth_headers
    )
    assert response.status_code == 403

def test_update_account_balance(client, auth_headers, test_household, db_session):
    account = models.FinancialAccount(
        id=uuid.uuid7(),
        household_id=test_household.id,
        name="Balance Update Account",
        liquidity="liquid",
        tax_status="taxable",
        currency="USD"
    )
    db_session.add(account)
    db_session.commit()

    balance = models.AccountBalance(
        id=uuid.uuid7(),
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

def test_update_account_balance_not_found(client, auth_headers):
    response = client.put(
        f"/accounts/balances/{uuid.uuid7()}",
        headers=auth_headers,
        json={"balance": "750.25"}
    )
    assert response.status_code == 404

def test_update_account_balance_unauthorized(client, other_auth_headers, test_household, db_session):
    account = models.FinancialAccount(
        id=uuid.uuid7(),
        household_id=test_household.id,
        name="Balance Update Account",
        liquidity="liquid",
        tax_status="taxable",
        currency="USD"
    )
    db_session.add(account)
    db_session.commit()

    balance = models.AccountBalance(
        id=uuid.uuid7(),
        account_id=account.id,
        date=date(2023, 10, 1),
        balance=Decimal("500.00")
    )
    db_session.add(balance)
    db_session.commit()

    response = client.put(
        f"/accounts/balances/{balance.id}",
        headers=other_auth_headers,
        json={
            "balance": "750.25"
        }
    )
    assert response.status_code == 403

def test_delete_account_balance(client, auth_headers, test_household, db_session):
    account = models.FinancialAccount(
        id=uuid.uuid7(),
        household_id=test_household.id,
        name="Balance Delete Account",
        liquidity="liquid",
        tax_status="taxable",
        currency="USD"
    )
    db_session.add(account)
    db_session.commit()

    balance = models.AccountBalance(
        id=uuid.uuid7(),
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

def test_delete_account_balance_not_found(client, auth_headers):
    response = client.delete(
        f"/accounts/balances/{uuid.uuid7()}",
        headers=auth_headers
    )
    assert response.status_code == 404

def test_delete_account_balance_unauthorized(client, other_auth_headers, test_household, db_session):
    account = models.FinancialAccount(
        id=uuid.uuid7(),
        household_id=test_household.id,
        name="Balance Delete Account",
        liquidity="liquid",
        tax_status="taxable",
        currency="USD"
    )
    db_session.add(account)
    db_session.commit()

    balance = models.AccountBalance(
        id=uuid.uuid7(),
        account_id=account.id,
        date=date(2023, 10, 1),
        balance=Decimal("500.00")
    )
    db_session.add(balance)
    db_session.commit()

    response = client.delete(
        f"/accounts/balances/{balance.id}",
        headers=other_auth_headers
    )
    assert response.status_code == 403

def test_get_household_balances(client, auth_headers, test_household, db_session):
    account1 = models.FinancialAccount(
        id=uuid.uuid7(),
        household_id=test_household.id,
        name="Account 1",
        liquidity="liquid",
        tax_status="taxable",
        currency="USD"
    )
    account2 = models.FinancialAccount(
        id=uuid.uuid7(),
        household_id=test_household.id,
        name="Account 2",
        liquidity="liquid",
        tax_status="taxable",
        currency="USD"
    )
    db_session.add(account1)
    db_session.add(account2)
    db_session.commit()

    from datetime import date
    balance1 = models.AccountBalance(
        id=uuid.uuid7(),
        account_id=account1.id,
        date=date.today(),
        balance=100.0
    )
    balance2 = models.AccountBalance(
        id=uuid.uuid7(),
        account_id=account2.id,
        date=date.today(),
        balance=200.0
    )
    db_session.add(balance1)
    db_session.add(balance2)
    db_session.commit()

    response = client.get(f"/accounts/balances/household/{test_household.id}", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2


# --- Archiving ------------------------------------------------------------


def _fresh_account(client, headers, household_id, name="Closeable"):
    return client.post("/accounts", headers=headers, json={
        "household_id": str(household_id), "name": name, "kind": "asset",
        "liquidity": "liquid", "tax_status": "taxable", "currency": "USD",
    }).json()


class TestArchiving:
    """
    An account that has been used cannot be deleted, because every journal entry
    is balanced across two or more accounts — erasing the entries that touch one
    also erases the other side. Receivables reach net worth, so deleting a closed
    bank account could quietly change what the household is worth. Archiving is
    what that case gets instead.
    """

    def test_an_unused_account_is_still_deleted_outright(self, client, auth_headers, test_household):
        # Nothing to preserve and nothing to be surprised by.
        account = _fresh_account(client, auth_headers, test_household.id, "Never used")
        assert client.delete(f"/accounts/{account['id']}", headers=auth_headers).status_code == 204

    def test_an_account_with_history_refuses_and_says_to_archive(
        self, client, auth_headers, test_household
    ):
        account = _fresh_account(client, auth_headers, test_household.id, "Used once")
        # An opening balance alone is enough: it posts a ledger entry.
        client.post("/accounts/balances", headers=auth_headers, json={
            "account_id": account["id"], "date": "2026-08-28", "balance": 100,
        })

        res = client.delete(f"/accounts/{account['id']}", headers=auth_headers)
        assert res.status_code == 409, "used to be a 500 from the journal_lines FK"
        assert "archive" in res.json()["detail"].lower()

    def test_archiving_is_an_ordinary_field_edit_and_reversible(
        self, client, auth_headers, test_household
    ):
        account = _fresh_account(client, auth_headers, test_household.id, "To close")
        assert account["is_archived"] is False

        archived = client.put(
            f"/accounts/{account['id']}", headers=auth_headers, json={"is_archived": True}
        )
        assert archived.status_code == 200
        assert archived.json()["is_archived"] is True

        reopened = client.put(
            f"/accounts/{account['id']}", headers=auth_headers, json={"is_archived": False}
        )
        assert reopened.json()["is_archived"] is False

    def test_renaming_an_archived_account_does_not_reopen_it(
        self, client, auth_headers, test_household
    ):
        # `exclude_unset` again: an omitted key must leave the flag alone.
        account = _fresh_account(client, auth_headers, test_household.id, "Closed")
        client.put(f"/accounts/{account['id']}", headers=auth_headers, json={"is_archived": True})

        renamed = client.put(
            f"/accounts/{account['id']}", headers=auth_headers, json={"name": "Closed (old)"}
        )
        assert renamed.json()["name"] == "Closed (old)"
        assert renamed.json()["is_archived"] is True

    def test_an_archived_account_still_appears_with_its_history(
        self, client, auth_headers, test_household
    ):
        """
        Archiving hides an account from where you *start* work, not from the
        record. It keeps its balances, so totals never move on archiving — a
        closed account has been zeroed and contributes nothing anyway, and one
        that still holds money genuinely should be counted.
        """
        account = _fresh_account(client, auth_headers, test_household.id, "Has money")
        client.post("/accounts/balances", headers=auth_headers, json={
            "account_id": account["id"], "date": "2026-08-28", "balance": 250,
        })
        client.put(f"/accounts/{account['id']}", headers=auth_headers, json={"is_archived": True})

        listed = client.get(
            f"/accounts/household/{test_household.id}", headers=auth_headers
        ).json()
        row = next(a for a in listed if a["id"] == account["id"])
        assert row["is_archived"] is True, "the client decides where to show it"

        balances = client.get(
            f"/accounts/balances/household/{test_household.id}", headers=auth_headers
        ).json()
        assert any(b["account_id"] == account["id"] for b in balances), "history is untouched"
