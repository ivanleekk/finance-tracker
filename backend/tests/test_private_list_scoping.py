"""
Household *list* endpoints must apply the private-ownership rule.

`verify_private_owner_visibility` is a single-row guard and cannot protect a list query, so a
list endpoint that filters on `household_id` alone returns every other member's private rows.
AGENTS.md 4a says the rule is enforced server-side, not just filtered client-side — and the
native clients gate private data behind a biometric vault lock, which is meaningless if the API
hands the same rows to anyone in the household.

Each test here fails if its endpoint's owner predicate is removed.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest

from src import models
from src.auth import create_access_token


@pytest.fixture
def owner(db_session):
    user = models.User(
        id=uuid.uuid7(),
        email="scope_owner@example.com",
        name="Owner",
        salted_hashed_password="fakehash",
        salt="fakesalt",
    )
    db_session.add(user)
    db_session.commit()
    return user


@pytest.fixture
def housemate(db_session):
    user = models.User(
        id=uuid.uuid7(),
        email="scope_housemate@example.com",
        name="Housemate",
        salted_hashed_password="fakehash",
        salt="fakesalt",
    )
    db_session.add(user)
    db_session.commit()
    return user


@pytest.fixture
def household(db_session, owner, housemate):
    hh = models.Household(
        id=uuid.uuid7(),
        name="Shared House",
        base_currency="USD",
        country_code="US",
        owner_id=owner.id,
    )
    db_session.add(hh)
    db_session.flush()
    for user in (owner, housemate):
        db_session.add(
            models.HouseholdMember(
                id=uuid.uuid7(),
                household_id=hh.id,
                user_id=user.id,
                role=models.HouseholdRoleType.owner if user is owner else models.HouseholdRoleType.editor,
            )
        )
    db_session.commit()
    return hh


@pytest.fixture
def owner_headers(owner):
    return {"Authorization": f"Bearer {create_access_token(data={'sub': str(owner.id)})}"}


@pytest.fixture
def housemate_headers(housemate):
    return {"Authorization": f"Bearer {create_access_token(data={'sub': str(housemate.id)})}"}


@pytest.fixture
def private_account(db_session, household, housemate):
    """An account private to the housemate, with one transaction on it."""
    account = models.FinancialAccount(
        id=uuid.uuid7(),
        household_id=household.id,
        name="Housemate Secret Savings",
        liquidity="liquid",
        tax_status="taxable",
        currency="USD",
        owner_user_id=housemate.id,
    )
    category = models.Category(
        id=uuid.uuid7(), household_id=household.id, name="Private Spending", type="expense"
    )
    db_session.add_all([account, category])
    db_session.flush()
    db_session.add(
        models.Transaction(
            id=uuid.uuid7(),
            account_id=account.id,
            category_id=category.id,
            date=datetime.now(timezone.utc),
            amount=Decimal("4242.00"),
            amount_home_currency=Decimal("4242.00"),
            currency="USD",
            exchange_rate=1.0,
            description="Very private purchase",
            transaction_type=models.TransactionType.expense,
        )
    )
    db_session.commit()
    return account


@pytest.fixture
def private_sub_portfolio(db_session, household, housemate):
    """A sub-portfolio private to the housemate, with a trade, dividend and snapshot."""
    sub = models.SubPortfolio(
        id=uuid.uuid7(),
        household_id=household.id,
        name="Housemate Secret Goal",
        risk_profile="balanced",
        owner_user_id=housemate.id,
    )
    asset = models.Asset(
        id=uuid.uuid7(), ticker="SECRET", name="Secret Corp", type="stock", currency="USD"
    )
    account = models.FinancialAccount(
        id=uuid.uuid7(),
        household_id=household.id,
        name="Housemate Brokerage",
        liquidity="liquid",
        tax_status="taxable",
        currency="USD",
        owner_user_id=housemate.id,
    )
    db_session.add_all([sub, asset, account])
    db_session.flush()
    db_session.add_all([
        models.Trade(
            id=uuid.uuid7(),
            household_id=household.id,
            sub_portfolio_id=sub.id,
            asset_id=asset.id,
            account_id=account.id,
            trade_type=models.TradeType.buy,
            date=datetime.now(timezone.utc),
            quantity=13.0,
            price=Decimal("100.00"),
            currency="USD",
            exchange_rate=1.0,
        ),
        models.Dividend(
            id=uuid.uuid7(),
            household_id=household.id,
            sub_portfolio_id=sub.id,
            asset_id=asset.id,
            account_id=account.id,
            date=datetime.now(timezone.utc),
            amount=Decimal("13.00"),
            amount_home_currency=Decimal("13.00"),
            per_share_amount=Decimal("1.00"),
            quantity=13.0,
            exchange_rate=1.0,
        ),
        models.PortfolioSnapshot(
            id=uuid.uuid7(),
            household_id=household.id,
            sub_portfolio_id=sub.id,
            asset_id=asset.id,
            date=date.today(),
            quantity=13.0,
            current_price=Decimal("100.00"),
            exchange_rate_used=1.0,
            current_value_home_currency=Decimal("1300.00"),
        ),
    ])
    db_session.commit()
    return sub


def test_transactions_list_hides_another_members_private_account(
    client, owner_headers, housemate_headers, household, private_account
):
    url = f"/cashflow/transactions/household/{household.id}"

    seen_by_owner = client.get(url, headers=owner_headers)
    assert seen_by_owner.status_code == 200
    assert seen_by_owner.json() == [], "the owner must not see the housemate's private transactions"

    # The housemate still sees their own.
    seen_by_housemate = client.get(url, headers=housemate_headers).json()
    assert len(seen_by_housemate) == 1
    assert seen_by_housemate[0]["description"] == "Very private purchase"


def test_trades_list_hides_another_members_private_sub_portfolio(
    client, owner_headers, housemate_headers, household, private_sub_portfolio
):
    url = f"/portfolio/trades/household/{household.id}"

    assert client.get(url, headers=owner_headers).json() == []
    assert len(client.get(url, headers=housemate_headers).json()) == 1


def test_dividends_list_hides_another_members_private_sub_portfolio(
    client, owner_headers, housemate_headers, household, private_sub_portfolio
):
    url = f"/portfolio/dividends/household/{household.id}"

    assert client.get(url, headers=owner_headers).json() == []
    assert len(client.get(url, headers=housemate_headers).json()) == 1


def test_snapshots_list_hides_another_members_private_sub_portfolio(
    client, owner_headers, housemate_headers, household, private_sub_portfolio
):
    url = f"/portfolio/snapshots/household/{household.id}"

    assert client.get(url, headers=owner_headers).json() == []
    assert len(client.get(url, headers=housemate_headers).json()) == 1


def test_timeseries_hides_another_members_private_sub_portfolio(
    client, owner_headers, housemate_headers, household, private_sub_portfolio
):
    """
    The aggregated variant leaks the same information in summary form: a total per
    (date, sub_portfolio) still discloses the private goal's existence and its value.
    """
    url = f"/portfolio/snapshots/household/{household.id}/timeseries"

    assert client.get(url, headers=owner_headers).json() == []
    housemate_rows = client.get(url, headers=housemate_headers).json()
    assert len(housemate_rows) == 1
    assert float(housemate_rows[0]["total_value_home_currency"]) == pytest.approx(1300.0)


def test_shared_rows_remain_visible_to_everyone(
    client, owner_headers, housemate_headers, db_session, household
):
    """The guard must not over-correct: shared (NULL owner) rows stay visible to all members."""
    shared_sub = models.SubPortfolio(
        id=uuid.uuid7(),
        household_id=household.id,
        name="Shared Goal",
        risk_profile="balanced",
        owner_user_id=None,
    )
    asset = models.Asset(
        id=uuid.uuid7(), ticker="SHARED", name="Shared Corp", type="stock", currency="USD"
    )
    shared_account = models.FinancialAccount(
        id=uuid.uuid7(),
        household_id=household.id,
        name="Joint Brokerage",
        liquidity="liquid",
        tax_status="taxable",
        currency="USD",
        owner_user_id=None,
    )
    db_session.add_all([shared_sub, asset, shared_account])
    db_session.flush()
    db_session.add(
        models.Trade(
            id=uuid.uuid7(),
            household_id=household.id,
            sub_portfolio_id=shared_sub.id,
            asset_id=asset.id,
            account_id=shared_account.id,
            trade_type=models.TradeType.buy,
            date=datetime.now(timezone.utc),
            quantity=5.0,
            price=Decimal("20.00"),
            currency="USD",
            exchange_rate=1.0,
        )
    )
    db_session.commit()

    url = f"/portfolio/trades/household/{household.id}"
    assert len(client.get(url, headers=owner_headers).json()) == 1
    assert len(client.get(url, headers=housemate_headers).json()) == 1
