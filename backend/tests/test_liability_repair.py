"""
Repairing liability chains written before the sign fix.

The scenarios that matter are the ones where the script must *not* act: an
account that is already right, one that has been half-repaired by hand, and a
second run over rows it just wrote.
"""

import uuid
from datetime import date
from decimal import Decimal

import pytest

from src import models
from src.services.liability_repair import (
    ALREADY_CORRECT,
    BROKEN,
    UNRECOGNISED,
    apply_plan,
    liability_accounts,
    plan_account,
)


@pytest.fixture
def user(db_session):
    row = models.User(
        id=uuid.uuid7(),
        email="repair@example.com",
        name="Repair",
        salted_hashed_password="fakehash",
        salt="fakesalt",
    )
    db_session.add(row)
    db_session.commit()
    return row


@pytest.fixture
def headers(user):
    from src.auth import create_access_token

    return {"Authorization": f"Bearer {create_access_token(data={'sub': str(user.id)})}"}


@pytest.fixture
def household(db_session, user):
    row = models.Household(
        id=uuid.uuid7(),
        name="Repair Household",
        base_currency="USD",
        country_code="US",
        owner_id=user.id,
    )
    db_session.add(row)
    db_session.commit()
    return row


@pytest.fixture
def card(db_session, household):
    row = models.FinancialAccount(
        id=uuid.uuid7(),
        household_id=household.id,
        name="Card",
        kind=models.AccountKind.liability,
        liquidity="liquid",
        tax_status="taxable",
        currency="USD",
    )
    db_session.add(row)
    db_session.commit()
    return row


@pytest.fixture
def dining(db_session, household):
    row = models.Category(
        id=uuid.uuid7(), household_id=household.id, name="Dining", type="expense"
    )
    db_session.add(row)
    db_session.commit()
    return row


def _charge(client, headers, card, category, on, amount):
    response = client.post(
        "/cashflow/transactions",
        headers=headers,
        json={
            "account_id": str(card.id),
            "category_id": str(category.id),
            "date": f"{on}T12:00:00Z",
            "amount": amount,
            "description": f"Charge {on}",
        },
    )
    assert response.status_code == 201, response.text


def _opening(client, headers, card, on, amount):
    response = client.post(
        "/accounts/balances",
        headers=headers,
        json={"account_id": str(card.id), "date": on, "balance": amount},
    )
    assert response.status_code == 201, response.text


def _chain(db_session, card):
    db_session.expire_all()
    rows = (
        db_session.query(models.AccountBalance)
        .filter_by(account_id=card.id)
        .order_by(models.AccountBalance.date)
        .all()
    )
    return {r.date: Decimal(str(r.balance)) for r in rows}


def _break(db_session, card, wrong: dict):
    """Rewrite the chain the way the pre-fix code would have left it."""
    for row in db_session.query(models.AccountBalance).filter_by(account_id=card.id).all():
        if row.date in wrong:
            row.balance = wrong[row.date]
            row.balance_home_currency = float(wrong[row.date])
    db_session.commit()


def _ref(db_session, card):
    """The account as the repair sees it — a handful of columns, not the entity."""
    (found,) = [a for a in liability_accounts(db_session) if a.id == card.id]
    return found


def test_it_rebuilds_a_chain_written_with_the_old_sign(
    client, headers, db_session, card, dining
):
    _opening(client, headers, card, "2023-10-01", "0.00")
    _charge(client, headers, card, dining, "2023-10-05", "100.00")
    _charge(client, headers, card, dining, "2023-10-08", "50.00")

    correct = _chain(db_session, card)
    assert correct == {
        date(2023, 10, 1): Decimal("0.000"),
        date(2023, 10, 5): Decimal("100.000"),
        date(2023, 10, 8): Decimal("150.000"),
    }

    # What the pre-fix code stored: every charge subtracted.
    _break(db_session, card, {date(2023, 10, 5): Decimal("-100"), date(2023, 10, 8): Decimal("-150")})

    plan = plan_account(db_session, _ref(db_session, card))
    assert plan.verdict == BROKEN
    # A liability is subtracted, so putting $150 of debt back lowers net worth.
    assert plan.net_worth_delta == Decimal("-300")

    apply_plan(db_session, _ref(db_session, card), plan)
    db_session.commit()
    assert _chain(db_session, card) == correct


def test_running_it_twice_changes_nothing(client, headers, db_session, card, dining):
    _opening(client, headers, card, "2023-10-01", "0.00")
    _charge(client, headers, card, dining, "2023-10-05", "100.00")
    _break(db_session, card, {date(2023, 10, 5): Decimal("-100")})

    apply_plan(db_session, _ref(db_session, card), plan_account(db_session, _ref(db_session, card)))
    db_session.commit()
    repaired = _chain(db_session, card)

    second = plan_account(db_session, _ref(db_session, card))
    assert second.verdict == ALREADY_CORRECT
    assert second.fixes == []
    apply_plan(db_session, _ref(db_session, card), second)
    db_session.commit()
    assert _chain(db_session, card) == repaired


def test_an_untouched_account_is_recognised_as_already_correct(
    client, headers, db_session, card, dining
):
    """Rows written since the fix must be left exactly as they are."""
    _opening(client, headers, card, "2023-10-01", "0.00")
    _charge(client, headers, card, dining, "2023-10-05", "100.00")

    plan = plan_account(db_session, _ref(db_session, card))
    assert plan.verdict == ALREADY_CORRECT
    assert plan.fixes == []


def test_a_manual_checkpoint_starts_a_new_segment(client, headers, db_session, card, dining):
    """
    Propagation stops at a reconciliation, so the correction has to as well —
    the user's counted figure is an assertion, not something to re-derive.
    """
    _opening(client, headers, card, "2023-10-01", "0.00")
    _charge(client, headers, card, dining, "2023-10-05", "100.00")
    # A second balance post is a checkpoint: "I counted, and I owe 500."
    response = client.post(
        "/accounts/balances",
        headers=headers,
        json={"account_id": str(card.id), "date": "2023-10-20", "balance": "500.00"},
    )
    assert response.status_code == 201, response.text
    _charge(client, headers, card, dining, "2023-10-25", "60.00")

    correct = _chain(db_session, card)
    assert correct[date(2023, 10, 20)] == Decimal("500.000")
    assert correct[date(2023, 10, 25)] == Decimal("560.000")

    _break(
        db_session,
        card,
        {date(2023, 10, 5): Decimal("-100"), date(2023, 10, 25): Decimal("440")},
    )

    plan = plan_account(db_session, _ref(db_session, card))
    assert plan.verdict == BROKEN
    apply_plan(db_session, _ref(db_session, card), plan)
    db_session.commit()

    repaired = _chain(db_session, card)
    assert repaired == correct
    # The checkpoint itself was never rewritten.
    assert repaired[date(2023, 10, 20)] == Decimal("500.000")


def test_a_half_repaired_chain_is_left_alone(client, headers, db_session, card, dining):
    """
    Someone patching rows by hand is the case where guessing does damage. The
    script reports it and writes nothing.
    """
    _opening(client, headers, card, "2023-10-01", "0.00")
    _charge(client, headers, card, dining, "2023-10-05", "100.00")
    _charge(client, headers, card, dining, "2023-10-08", "50.00")
    # First step carries the old sign, second the new one.
    _break(db_session, card, {date(2023, 10, 5): Decimal("-100"), date(2023, 10, 8): Decimal("-50")})

    plan = plan_account(db_session, _ref(db_session, card))
    assert plan.verdict == UNRECOGNISED
    assert plan.fixes == []
    assert plan.note


def test_it_only_ever_looks_at_liabilities(db_session, household, card):
    savings = models.FinancialAccount(
        id=uuid.uuid7(),
        household_id=household.id,
        name="Savings",
        kind=models.AccountKind.asset,
        liquidity="liquid",
        tax_status="taxable",
        currency="USD",
    )
    db_session.add(savings)
    db_session.commit()

    found = liability_accounts(db_session, household_id=household.id)
    assert [a.id for a in found] == [card.id]
    assert found[0].base_currency == "USD"


def test_a_card_with_no_opening_balance_is_still_repaired(
    client, headers, db_session, card, dining
):
    """
    The commonest shape, and the one a step comparison cannot see: nobody ever
    posted an opening balance, so the only rows are the ones the charges created
    and a single-day card has just one of them. The sync starts such a row from
    zero, which is what makes the row its own running total.
    """
    _charge(client, headers, card, dining, "2023-10-05", "420.00")
    _charge(client, headers, card, dining, "2023-10-05", "260.00")

    assert _chain(db_session, card) == {date(2023, 10, 5): Decimal("680.000")}
    _break(db_session, card, {date(2023, 10, 5): Decimal("-680")})

    plan = plan_account(db_session, _ref(db_session, card))
    assert plan.verdict == BROKEN
    apply_plan(db_session, _ref(db_session, card), plan)
    db_session.commit()
    assert _chain(db_session, card) == {date(2023, 10, 5): Decimal("680.000")}


def test_a_lone_row_behind_an_opening_balance_is_not_guessed_at(
    client, headers, db_session, card, dining
):
    """
    The same shape, but the account started with debt already on it. The row is
    then no longer its own running total, nothing else pins it down, and the
    script says so rather than picking a direction.
    """
    _opening(client, headers, card, "2023-10-05", "900.00")
    _charge(client, headers, card, dining, "2023-10-05", "100.00")

    plan = plan_account(db_session, _ref(db_session, card))
    assert plan.verdict not in (BROKEN,)
    assert plan.fixes == []
