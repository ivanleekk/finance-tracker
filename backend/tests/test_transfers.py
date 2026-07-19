"""Tests for /cashflow/transfers: paired transactions, balances, currency conversion, authz."""
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import patch

import pytest

from src import models
from src.auth import create_access_token


@pytest.fixture
def owner(db_session):
    user = models.User(
        id=uuid.uuid7(), email="transfer_owner@example.com", name="Owner",
        salted_hashed_password="x", salt="x",
    )
    db_session.add(user)
    db_session.commit()
    return user


@pytest.fixture
def headers(owner):
    return {"Authorization": f"Bearer {create_access_token(data={'sub': str(owner.id)})}"}


@pytest.fixture
def household(db_session, owner):
    hh = models.Household(
        id=uuid.uuid7(), name="Transfer HH", base_currency="USD", country_code="US", owner_id=owner.id,
    )
    db_session.add(hh)
    db_session.flush()
    db_session.add(models.HouseholdMember(
        id=uuid.uuid7(), household_id=hh.id, user_id=owner.id, role=models.HouseholdRoleType.owner,
    ))
    db_session.commit()
    return hh


def _account(db_session, household, name, currency="USD"):
    acc = models.FinancialAccount(
        id=uuid.uuid7(), household_id=household.id, name=name,
        liquidity="liquid", tax_status="taxable", currency=currency,
    )
    db_session.add(acc)
    db_session.commit()
    return acc


def _balance(db_session, account, amount):
    db_session.add(models.AccountBalance(
        id=uuid.uuid7(), account_id=account.id,
        date=datetime(2024, 1, 1, tzinfo=timezone.utc).date(), balance=Decimal(amount),
    ))
    db_session.commit()


def test_transfer_creates_paired_transactions(client, headers, db_session, household):
    src = _account(db_session, household, "Checking")
    dst = _account(db_session, household, "Savings")
    _balance(db_session, src, "1000")
    _balance(db_session, dst, "0")

    response = client.post(
        "/cashflow/transfers",
        headers=headers,
        json={
            "from_account_id": str(src.id),
            "to_account_id": str(dst.id),
            "amount": "250.00",
            "date": "2024-01-05T12:00:00Z",
            "description": "Monthly savings",
        },
    )
    assert response.status_code == 201
    withdrawal, deposit = response.json()

    assert withdrawal["transaction_type"] == "expense"
    assert deposit["transaction_type"] == "income"
    assert withdrawal["transfer_id"] == deposit["transfer_id"]
    assert Decimal(withdrawal["amount"]) == Decimal("250.00")
    assert Decimal(deposit["amount"]) == Decimal("250.00")

    # Balances synced: source down, destination up
    src_balances = {b.date.isoformat(): b.balance for b in db_session.query(models.AccountBalance).filter_by(account_id=src.id)}
    dst_balances = {b.date.isoformat(): b.balance for b in db_session.query(models.AccountBalance).filter_by(account_id=dst.id)}
    assert Decimal(src_balances["2024-01-05"]) == Decimal("750.00")
    assert Decimal(dst_balances["2024-01-05"]) == Decimal("250.00")


def test_transfer_cross_currency_converts_amount(client, headers, db_session, household):
    src = _account(db_session, household, "USD Account", currency="USD")
    dst = _account(db_session, household, "SGD Account", currency="SGD")

    with patch("src.routers.cashflow.fetch_and_cache_exchange_rates") as mock_rates:
        # USD→SGD 1.35; conversions to home (USD) are 1.0 and 1/1.35
        def rate(db, base, target, d):
            if base == target:
                return 1.0
            if (base, target) == ("USD", "SGD"):
                return 1.35
            if (base, target) == ("SGD", "USD"):
                return 1 / 1.35
            return 1.0
        mock_rates.side_effect = rate

        response = client.post(
            "/cashflow/transfers",
            headers=headers,
            json={
                "from_account_id": str(src.id),
                "to_account_id": str(dst.id),
                "amount": "100.00",
                "date": "2024-01-05T12:00:00Z",
            },
        )

    assert response.status_code == 201
    withdrawal, deposit = response.json()
    assert withdrawal["currency"] == "USD"
    assert deposit["currency"] == "SGD"
    assert float(deposit["amount"]) == pytest.approx(135.0)


def test_transfer_rejects_cross_household(client, headers, db_session, household, owner):
    other_hh = models.Household(
        id=uuid.uuid7(), name="Second HH", base_currency="USD", country_code="US", owner_id=owner.id,
    )
    db_session.add(other_hh)
    db_session.flush()
    db_session.add(models.HouseholdMember(
        id=uuid.uuid7(), household_id=other_hh.id, user_id=owner.id, role=models.HouseholdRoleType.owner,
    ))
    db_session.commit()

    src = _account(db_session, household, "Here")
    dst = _account(db_session, other_hh, "There")

    response = client.post(
        "/cashflow/transfers",
        headers=headers,
        json={
            "from_account_id": str(src.id),
            "to_account_id": str(dst.id),
            "amount": "10.00",
            "date": "2024-01-05T12:00:00Z",
        },
    )
    assert response.status_code == 400


def test_transfer_missing_account_404(client, headers, db_session, household):
    src = _account(db_session, household, "Only Account")
    response = client.post(
        "/cashflow/transfers",
        headers=headers,
        json={
            "from_account_id": str(src.id),
            "to_account_id": str(uuid.uuid7()),
            "amount": "10.00",
            "date": "2024-01-05T12:00:00Z",
        },
    )
    assert response.status_code == 404


def test_transfer_requires_membership(client, db_session, household):
    outsider = models.User(
        id=uuid.uuid7(), email="outsider@example.com", name="Outsider",
        salted_hashed_password="x", salt="x",
    )
    db_session.add(outsider)
    db_session.commit()
    outsider_headers = {"Authorization": f"Bearer {create_access_token(data={'sub': str(outsider.id)})}"}

    src = _account(db_session, household, "A")
    dst = _account(db_session, household, "B")
    response = client.post(
        "/cashflow/transfers",
        headers=outsider_headers,
        json={
            "from_account_id": str(src.id),
            "to_account_id": str(dst.id),
            "amount": "10.00",
            "date": "2024-01-05T12:00:00Z",
        },
    )
    assert response.status_code == 403
