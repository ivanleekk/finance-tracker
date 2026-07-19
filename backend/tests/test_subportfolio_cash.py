import uuid
from datetime import datetime, timezone

import pytest

from src import models


@pytest.fixture
def test_user(db_session):
    user = models.User(
        id=uuid.uuid7(),
        email="cash_tracking@example.com",
        name="Cash User",
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
        name="Cash Household",
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
        name="Cash Brokerage",
        liquidity="liquid",
        tax_status="taxable",
        currency="USD",
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
        name="Cash Subportfolio",
        risk_profile="moderate",
    )
    db_session.add(sub)
    db_session.commit()
    db_session.refresh(sub)
    return sub


def _cash_payload(household, account, direction="deposit", amount=1000, currency="USD"):
    return {
        "household_id": str(household.id),
        "account_id": str(account.id),
        "direction": direction,
        "amount": amount,
        "currency": currency,
        "date": datetime.now(timezone.utc).isoformat(),
        "exchange_rate": 1.0,
    }


def test_deposit_creates_cash_trade_and_transaction(client, auth_headers, test_household, test_subportfolio, test_account, db_session):
    response = client.post(
        f"/portfolio/subportfolios/{test_subportfolio.id}/cash",
        headers=auth_headers,
        json=_cash_payload(test_household, test_account),
    )
    assert response.status_code == 201, response.text
    data = response.json()
    assert data["type"] == "buy"
    assert data["quantity"] == 1000
    assert float(data["price"]) == 1.0
    assert data["currency"] == "USD"
    assert data["transaction_id"] is not None

    # Cash asset was created with the right convention
    asset = db_session.query(models.Asset).filter(models.Asset.id == uuid.UUID(data["asset_id"])).first()
    assert asset.ticker == "CASH.USD"
    assert asset.type == models.CASH_ASSET_TYPE

    # A funding transaction (expense) exists on the account
    transaction = db_session.query(models.Transaction).filter(
        models.Transaction.id == uuid.UUID(data["transaction_id"])
    ).first()
    assert transaction.transaction_type == models.TransactionType.expense
    assert float(transaction.amount) == 1000.0
    assert transaction.description == "Cash deposit: 1000 USD"
    assert transaction.account_id == test_account.id


def test_deposit_appears_in_snapshots_at_face_value(client, auth_headers, test_household, test_subportfolio, test_account, db_session):
    response = client.post(
        f"/portfolio/subportfolios/{test_subportfolio.id}/cash",
        headers=auth_headers,
        json=_cash_payload(test_household, test_account, amount=2500),
    )
    assert response.status_code == 201, response.text

    snapshots = db_session.query(models.PortfolioSnapshot).filter(
        models.PortfolioSnapshot.sub_portfolio_id == test_subportfolio.id
    ).all()
    assert len(snapshots) >= 1
    latest = max(snapshots, key=lambda s: s.date)
    assert latest.quantity == 2500
    assert float(latest.current_price) == 1.0
    assert float(latest.current_value_home_currency) == 2500.0


def test_withdraw_reduces_cash_and_credits_account(client, auth_headers, test_household, test_subportfolio, test_account, db_session):
    deposit = client.post(
        f"/portfolio/subportfolios/{test_subportfolio.id}/cash",
        headers=auth_headers,
        json=_cash_payload(test_household, test_account, amount=1000),
    )
    assert deposit.status_code == 201, deposit.text

    withdraw = client.post(
        f"/portfolio/subportfolios/{test_subportfolio.id}/cash",
        headers=auth_headers,
        json=_cash_payload(test_household, test_account, direction="withdraw", amount=400),
    )
    assert withdraw.status_code == 201, withdraw.text
    data = withdraw.json()
    assert data["type"] == "sell"

    transaction = db_session.query(models.Transaction).filter(
        models.Transaction.id == uuid.UUID(data["transaction_id"])
    ).first()
    assert transaction.transaction_type == models.TransactionType.income
    assert transaction.description == "Cash withdrawal: 400 USD"

    snapshots = db_session.query(models.PortfolioSnapshot).filter(
        models.PortfolioSnapshot.sub_portfolio_id == test_subportfolio.id
    ).all()
    latest = max(snapshots, key=lambda s: s.date)
    assert latest.quantity == 600


def test_overdraw_is_rejected(client, auth_headers, test_household, test_subportfolio, test_account):
    deposit = client.post(
        f"/portfolio/subportfolios/{test_subportfolio.id}/cash",
        headers=auth_headers,
        json=_cash_payload(test_household, test_account, amount=100),
    )
    assert deposit.status_code == 201, deposit.text

    withdraw = client.post(
        f"/portfolio/subportfolios/{test_subportfolio.id}/cash",
        headers=auth_headers,
        json=_cash_payload(test_household, test_account, direction="withdraw", amount=500),
    )
    assert withdraw.status_code == 400
    assert "Insufficient cash" in withdraw.json()["detail"]


def test_cash_is_scoped_per_subportfolio(client, auth_headers, test_household, test_subportfolio, test_account, db_session):
    other_sub = models.SubPortfolio(
        id=uuid.uuid7(),
        household_id=test_household.id,
        name="Other Subportfolio",
        risk_profile="moderate",
    )
    db_session.add(other_sub)
    db_session.commit()

    deposit = client.post(
        f"/portfolio/subportfolios/{test_subportfolio.id}/cash",
        headers=auth_headers,
        json=_cash_payload(test_household, test_account, amount=300),
    )
    assert deposit.status_code == 201, deposit.text

    # The other sub-portfolio holds no cash, so withdrawing from it must fail
    withdraw = client.post(
        f"/portfolio/subportfolios/{other_sub.id}/cash",
        headers=auth_headers,
        json=_cash_payload(test_household, test_account, direction="withdraw", amount=100),
    )
    assert withdraw.status_code == 400


def test_wrong_household_and_missing_account_are_rejected(client, auth_headers, test_household, test_subportfolio, test_account, db_session):
    response = client.post(
        f"/portfolio/subportfolios/{test_subportfolio.id}/cash",
        headers=auth_headers,
        json={**_cash_payload(test_household, test_account), "account_id": str(uuid.uuid7())},
    )
    assert response.status_code == 404

    other_household = models.Household(
        id=uuid.uuid7(),
        name="Other Household",
        base_currency="USD",
        country_code="US",
        owner_id=test_household.owner_id,
    )
    db_session.add(other_household)
    db_session.commit()
    response = client.post(
        f"/portfolio/subportfolios/{test_subportfolio.id}/cash",
        headers=auth_headers,
        json={**_cash_payload(other_household, test_account)},
    )
    assert response.status_code == 400
