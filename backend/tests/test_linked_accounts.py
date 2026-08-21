"""
Accounts earmarked to a sub-portfolio (#252).

The motivating case: a Singapore CPF OA balance counts towards a housing goal
but can't be withdrawn and invested, so it can't be modelled as sub-portfolio
cash (which moves real money out of an account). Linking references the account
instead -- the balance stays put for net worth and *also* counts towards the
goal.

The load-bearing rule tested here is that the linked balance reaches the goal's
value but NOT its return metrics: a CPF contribution is a deposit, not
performance, and counting it as one inflates every ratio on the Portfolio tab.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest

from src import models
from src.services import linked_account_service
from src.services.performance import calculate_performance_metrics
from src.services.snapshot_engine import run_snapshot_range


@pytest.fixture
def test_user(db_session):
    user = models.User(
        id=uuid.uuid7(),
        email="linked_accounts@example.com",
        name="Linked User",
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
    return {"Authorization": f"Bearer {create_access_token(data={'sub': str(test_user.id)})}"}


@pytest.fixture
def test_household(db_session, test_user):
    household = models.Household(
        id=uuid.uuid7(),
        name="Linked Household",
        base_currency="SGD",
        country_code="SG",
        owner_id=test_user.id,
    )
    db_session.add(household)
    db_session.commit()
    db_session.refresh(household)
    return household


@pytest.fixture
def housing_goal(db_session, test_household):
    goal = models.SubPortfolio(
        id=uuid.uuid7(),
        household_id=test_household.id,
        name="Housing",
        risk_profile="conservative",
        target_amount=Decimal("200000"),
    )
    db_session.add(goal)
    db_session.commit()
    db_session.refresh(goal)
    return goal


@pytest.fixture
def cpf_account(db_session, test_household):
    """A CPF OA account, time-locked and un-investable, with a balance history."""
    account = models.FinancialAccount(
        id=uuid.uuid7(),
        household_id=test_household.id,
        name="CPF OA",
        liquidity="time_locked",
        tax_status="tax_deferred",
        currency="SGD",
    )
    db_session.add(account)
    db_session.flush()
    for offset, amount in ((10, "50000"), (5, "51000")):
        db_session.add(
            models.AccountBalance(
                id=uuid.uuid7(),
                account_id=account.id,
                date=date.today() - timedelta(days=offset),
                balance=Decimal(amount),
                balance_home_currency=Decimal(amount),
            )
        )
    db_session.commit()
    db_session.refresh(account)
    return account


# ---------------------------------------------------------------------------
# balance_series: the forward-fill rule
# ---------------------------------------------------------------------------


def test_balance_series_forward_fills_quiet_days(db_session, cpf_account):
    """
    Balances are recorded only when something happens. Without forward-filling,
    every quiet day would value the account at zero and the goal's equity curve
    would render as a comb.
    """
    start = date.today() - timedelta(days=10)
    series = linked_account_service.balance_series(
        db_session, [cpf_account.id], start, date.today()
    )

    # Day of the first balance, and a quiet day three days later: same figure.
    assert series[(start, cpf_account.id)] == 50000.0
    assert series[(start + timedelta(days=3), cpf_account.id)] == 50000.0
    # After the second recorded balance it steps up and holds.
    assert series[(date.today() - timedelta(days=5), cpf_account.id)] == 51000.0
    assert series[(date.today(), cpf_account.id)] == 51000.0


def test_balance_series_omits_days_before_the_first_balance(db_session, cpf_account):
    """
    Zero-filling the run-up would draw the goal starting at zero and crashing
    into existence; the account simply has no data there, so it emits nothing.
    """
    start = date.today() - timedelta(days=20)
    series = linked_account_service.balance_series(
        db_session, [cpf_account.id], start, date.today()
    )

    assert (start, cpf_account.id) not in series
    assert (date.today() - timedelta(days=11), cpf_account.id) not in series
    assert (date.today() - timedelta(days=10), cpf_account.id) in series


def test_balance_series_is_empty_without_accounts(db_session):
    assert linked_account_service.balance_series(
        db_session, [], date.today() - timedelta(days=5), date.today()
    ) == {}


# ---------------------------------------------------------------------------
# The pseudo-asset
# ---------------------------------------------------------------------------


def test_pseudo_asset_is_keyed_by_id_and_tracks_renames(db_session, cpf_account):
    asset = linked_account_service.get_or_create_linked_account_asset(db_session, cpf_account)
    assert asset.ticker == f"ACCT.{cpf_account.id}"
    assert asset.type == models.LINKED_ACCOUNT_ASSET_TYPE

    # Renaming the account must reuse the same asset -- keying on the name would
    # orphan the snapshot history behind it.
    cpf_account.name = "CPF Ordinary Account"
    db_session.commit()
    again = linked_account_service.get_or_create_linked_account_asset(db_session, cpf_account)
    assert again.id == asset.id
    assert again.name == "CPF Ordinary Account"


# ---------------------------------------------------------------------------
# Snapshots, goal value and the metrics exclusion
# ---------------------------------------------------------------------------


def _snapshot_total(db_session, goal_id, on_date):
    rows = db_session.query(models.PortfolioSnapshot).filter(
        models.PortfolioSnapshot.sub_portfolio_id == goal_id,
        models.PortfolioSnapshot.date == on_date,
    ).all()
    return sum(float(r.current_value_home_currency or 0) for r in rows)


def test_linked_balance_lands_in_the_goals_value(db_session, test_household, housing_goal, cpf_account):
    cpf_account.sub_portfolio_id = housing_goal.id
    db_session.commit()

    run_snapshot_range(db_session, test_household.id, date.today() - timedelta(days=10), date.today())

    assert _snapshot_total(db_session, housing_goal.id, date.today()) == pytest.approx(51000.0)
    # And it holds on the quiet days in between, via the forward fill.
    assert _snapshot_total(
        db_session, housing_goal.id, date.today() - timedelta(days=7)
    ) == pytest.approx(50000.0)


def test_linked_balance_is_excluded_from_return_metrics(
    db_session, test_household, housing_goal, cpf_account
):
    """
    The whole point of the design decision: the balance counts towards the goal's
    value, but a contribution landing in it is a deposit, not a return. If these
    rows reached the equity curve, this metric set would be non-empty and would
    report the 50k -> 51k step as investment performance.
    """
    cpf_account.sub_portfolio_id = housing_goal.id
    db_session.commit()
    run_snapshot_range(db_session, test_household.id, date.today() - timedelta(days=10), date.today())

    # Sanity: the snapshots this metric call would read really do exist.
    assert _snapshot_total(db_session, housing_goal.id, date.today()) > 0

    metrics = calculate_performance_metrics(
        db_session, test_household.id, sub_portfolio_id=housing_goal.id
    )
    # With every row filtered out there is no curve left, so the returns are flat
    # zero rather than a fabricated +2% off the 50k -> 51k contribution step.
    assert metrics.simple_return == 0.0
    assert metrics.time_weighted_return == 0.0
    assert metrics.money_weighted_return == 0.0
    assert metrics.volatility == 0.0
    assert metrics.sharpe_ratio == 0.0


def test_unlinking_removes_the_balance_from_the_goal(
    db_session, test_household, housing_goal, cpf_account
):
    cpf_account.sub_portfolio_id = housing_goal.id
    db_session.commit()
    run_snapshot_range(db_session, test_household.id, date.today() - timedelta(days=10), date.today())
    assert _snapshot_total(db_session, housing_goal.id, date.today()) > 0

    cpf_account.sub_portfolio_id = None
    db_session.commit()
    run_snapshot_range(db_session, test_household.id, date.today() - timedelta(days=10), date.today())

    assert _snapshot_total(db_session, housing_goal.id, date.today()) == 0


# ---------------------------------------------------------------------------
# API surface and its guard rails
# ---------------------------------------------------------------------------


def test_update_links_and_unlinks_through_the_api(
    client, auth_headers, housing_goal, cpf_account
):
    linked = client.put(
        f"/accounts/{cpf_account.id}",
        json={"sub_portfolio_id": str(housing_goal.id)},
        headers=auth_headers,
    )
    assert linked.status_code == 200
    assert linked.json()["sub_portfolio_id"] == str(housing_goal.id)

    # An explicit null clears it; the model uses exclude_unset, so this is the
    # only way to express "un-earmark" as opposed to "leave alone".
    unlinked = client.put(
        f"/accounts/{cpf_account.id}", json={"sub_portfolio_id": None}, headers=auth_headers
    )
    assert unlinked.status_code == 200
    assert unlinked.json()["sub_portfolio_id"] is None


def test_cannot_link_to_a_sub_portfolio_in_another_household(
    client, auth_headers, db_session, test_user, cpf_account
):
    other_household = models.Household(
        id=uuid.uuid7(),
        name="Someone Else",
        base_currency="SGD",
        country_code="SG",
        owner_id=test_user.id,
    )
    db_session.add(other_household)
    db_session.flush()
    foreign_goal = models.SubPortfolio(
        id=uuid.uuid7(),
        household_id=other_household.id,
        name="Not Yours",
        risk_profile="balanced",
    )
    db_session.add(foreign_goal)
    db_session.commit()

    response = client.put(
        f"/accounts/{cpf_account.id}",
        json={"sub_portfolio_id": str(foreign_goal.id)},
        headers=auth_headers,
    )
    assert response.status_code == 404


def test_cannot_link_to_another_members_private_goal(
    client, auth_headers, db_session, test_household, cpf_account
):
    """
    Without the visibility check this would leak the existence of a private goal,
    and let its value be read back with this account's balance inside it.
    """
    other_user = models.User(
        id=uuid.uuid7(),
        email="housemate@example.com",
        name="Housemate",
        salted_hashed_password="fakehash",
        salt="fakesalt",
    )
    db_session.add(other_user)
    db_session.flush()
    private_goal = models.SubPortfolio(
        id=uuid.uuid7(),
        household_id=test_household.id,
        name="Their Private Goal",
        risk_profile="balanced",
        owner_user_id=other_user.id,
    )
    db_session.add(private_goal)
    db_session.commit()

    response = client.put(
        f"/accounts/{cpf_account.id}",
        json={"sub_portfolio_id": str(private_goal.id)},
        headers=auth_headers,
    )
    assert response.status_code in (403, 404)


def test_deleting_the_goal_leaves_the_account_alive(
    client, auth_headers, db_session, housing_goal, cpf_account
):
    """ON DELETE SET NULL: dropping a goal must never take a real account with it."""
    cpf_account.sub_portfolio_id = housing_goal.id
    db_session.commit()

    assert client.delete(
        f"/portfolio/subportfolios/{housing_goal.id}", headers=auth_headers
    ).status_code in (200, 204)

    db_session.expire_all()
    survivor = db_session.get(models.FinancialAccount, cpf_account.id)
    assert survivor is not None
    assert survivor.sub_portfolio_id is None
