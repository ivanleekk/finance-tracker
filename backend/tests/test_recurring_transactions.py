"""
Recurring transactions: the rules that stop a user retyping rent and salary
every month.

The properties that matter: occurrences never drift off a month-end anchor,
materialization is idempotent (a second run posts nothing), and it can catch up
several missed periods after the app has been idle.
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest

from src import models
from src.services import recurring_service


F = models.RecurrenceFrequency


# ---------------------------------------------------------------------------
# Recurrence date math (no DB)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "frequency,index,expected",
    [
        (F.weekly, 1, date(2026, 1, 22)),
        (F.weekly, 4, date(2026, 2, 12)),
        (F.biweekly, 1, date(2026, 1, 29)),
        (F.monthly, 1, date(2026, 2, 15)),
        (F.monthly, 12, date(2027, 1, 15)),
        (F.quarterly, 1, date(2026, 4, 15)),
        (F.yearly, 1, date(2027, 1, 15)),
    ],
)
def test_occurrence_steps_by_frequency(frequency, index, expected):
    assert recurring_service.occurrence(date(2026, 1, 15), frequency, index) == expected


def test_occurrence_zero_is_the_start_date():
    start = date(2026, 3, 9)
    assert recurring_service.occurrence(start, F.monthly, 0) == start


def test_month_end_anchor_does_not_drift():
    """
    A rule anchored on the 31st must clamp into February and then climb back —
    the classic bug is Jan 31 → Feb 28 → Mar 28, silently moving the rent date.
    """
    start = date(2026, 1, 31)
    assert recurring_service.occurrence(start, F.monthly, 1) == date(2026, 2, 28)
    assert recurring_service.occurrence(start, F.monthly, 2) == date(2026, 3, 31)
    assert recurring_service.occurrence(start, F.monthly, 3) == date(2026, 4, 30)
    assert recurring_service.occurrence(start, F.monthly, 4) == date(2026, 5, 31)


def test_leap_year_end_of_february():
    # 2028 is a leap year.
    assert recurring_service.occurrence(date(2028, 1, 30), F.monthly, 1) == date(2028, 2, 29)


def test_negative_occurrence_index_rejected():
    with pytest.raises(ValueError):
        recurring_service.occurrence(date(2026, 1, 1), F.monthly, -1)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def owner(db_session):
    user = models.User(
        id=uuid.uuid7(),
        email="recurring_owner@example.com",
        name="Recurring Owner",
        salted_hashed_password="fakehash",
        salt="fakesalt",
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def owner_headers(client, owner):
    from src.auth import create_access_token

    return {"Authorization": f"Bearer {create_access_token(data={'sub': str(owner.id)})}"}


@pytest.fixture
def stranger(db_session):
    user = models.User(
        id=uuid.uuid7(),
        email="recurring_stranger@example.com",
        name="Stranger",
        salted_hashed_password="fakehash",
        salt="fakesalt",
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def stranger_headers(client, stranger):
    from src.auth import create_access_token

    return {"Authorization": f"Bearer {create_access_token(data={'sub': str(stranger.id)})}"}


@pytest.fixture
def household(db_session, owner):
    hh = models.Household(
        id=uuid.uuid7(),
        name="Recurring Household",
        base_currency="USD",
        country_code="US",
        owner_id=owner.id,
    )
    db_session.add(hh)
    db_session.commit()
    db_session.refresh(hh)
    return hh


@pytest.fixture
def account(db_session, household):
    acc = models.FinancialAccount(
        id=uuid.uuid7(),
        household_id=household.id,
        name="Checking",
        liquidity=models.LiquidityStatus.liquid,
        tax_status=models.TaxTreatment.taxable,
        kind=models.AccountKind.asset,
        currency="USD",
    )
    db_session.add(acc)
    db_session.commit()
    db_session.refresh(acc)

    db_session.add(
        models.AccountBalance(
            id=uuid.uuid7(),
            account_id=acc.id,
            date=date(2026, 1, 1),
            balance=Decimal("10000"),
            balance_home_currency=Decimal("10000"),
            is_manual=True,
        )
    )
    db_session.commit()
    return acc


@pytest.fixture
def rent_category(db_session, household):
    cat = models.Category(
        id=uuid.uuid7(), household_id=household.id, name="Rent", type="expense"
    )
    db_session.add(cat)
    db_session.commit()
    db_session.refresh(cat)
    return cat


@pytest.fixture
def salary_category(db_session, household):
    cat = models.Category(
        id=uuid.uuid7(), household_id=household.id, name="Salary", type="income"
    )
    db_session.add(cat)
    db_session.commit()
    db_session.refresh(cat)
    return cat


def _rule(db_session, household, account, category, **kwargs):
    start = kwargs.pop("start_date", date(2026, 1, 1))
    rule = models.RecurringTransaction(
        id=uuid.uuid7(),
        household_id=household.id,
        account_id=account.id,
        category_id=category.id,
        amount=kwargs.pop("amount", Decimal("2000")),
        currency=kwargs.pop("currency", None),
        description=kwargs.pop("description", None),
        frequency=kwargs.pop("frequency", F.monthly),
        start_date=start,
        end_date=kwargs.pop("end_date", None),
        next_due_date=kwargs.pop("next_due_date", start),
        is_active=kwargs.pop("is_active", True),
        **kwargs,
    )
    db_session.add(rule)
    db_session.commit()
    db_session.refresh(rule)
    return rule


def _transactions_for(db_session, rule):
    return (
        db_session.query(models.Transaction)
        .filter(models.Transaction.recurring_transaction_id == rule.id)
        .order_by(models.Transaction.date)
        .all()
    )


# ---------------------------------------------------------------------------
# Materialization
# ---------------------------------------------------------------------------


def test_materialize_posts_due_occurrences(db_session, household, account, rent_category):
    rule = _rule(db_session, household, account, rent_category, start_date=date(2026, 1, 1))

    posted = recurring_service.materialize_due(db_session, household.id, date(2026, 3, 15))
    db_session.commit()

    assert posted == 3  # Jan, Feb, Mar
    rows = _transactions_for(db_session, rule)
    assert [r.date.date() for r in rows] == [date(2026, 1, 1), date(2026, 2, 1), date(2026, 3, 1)]
    assert all(r.transaction_type == models.TransactionType.expense for r in rows)

    db_session.refresh(rule)
    assert rule.next_due_date == date(2026, 4, 1)
    assert rule.last_posted_date == date(2026, 3, 1)


def test_materialize_is_idempotent(db_session, household, account, rent_category):
    rule = _rule(db_session, household, account, rent_category, start_date=date(2026, 1, 1))

    first = recurring_service.materialize_due(db_session, household.id, date(2026, 2, 15))
    db_session.commit()
    second = recurring_service.materialize_due(db_session, household.id, date(2026, 2, 15))
    db_session.commit()

    assert first == 2
    assert second == 0
    assert len(_transactions_for(db_session, rule)) == 2


def test_materialize_catches_up_after_a_long_idle_period(
    db_session, household, account, rent_category
):
    rule = _rule(db_session, household, account, rent_category, start_date=date(2026, 1, 1))

    posted = recurring_service.materialize_due(db_session, household.id, date(2026, 12, 31))
    db_session.commit()

    assert posted == 12
    db_session.refresh(rule)
    assert rule.next_due_date == date(2027, 1, 1)


def test_expense_rule_reduces_the_account_balance(
    db_session, household, account, rent_category
):
    _rule(db_session, household, account, rent_category, amount=Decimal("1500"))

    recurring_service.materialize_due(db_session, household.id, date(2026, 2, 15))
    db_session.commit()

    latest = (
        db_session.query(models.AccountBalance)
        .filter(models.AccountBalance.account_id == account.id)
        .order_by(models.AccountBalance.date.desc())
        .first()
    )
    # 10,000 opening − two months of 1,500 rent.
    assert Decimal(str(latest.balance)) == Decimal("7000")


def test_income_rule_increases_the_account_balance(
    db_session, household, account, salary_category
):
    _rule(db_session, household, account, salary_category, amount=Decimal("5000"))

    recurring_service.materialize_due(db_session, household.id, date(2026, 1, 15))
    db_session.commit()

    latest = (
        db_session.query(models.AccountBalance)
        .filter(models.AccountBalance.account_id == account.id)
        .order_by(models.AccountBalance.date.desc())
        .first()
    )
    assert Decimal(str(latest.balance)) == Decimal("15000")


def test_paused_rule_posts_nothing(db_session, household, account, rent_category):
    rule = _rule(db_session, household, account, rent_category, is_active=False)

    posted = recurring_service.materialize_due(db_session, household.id, date(2026, 6, 1))
    db_session.commit()

    assert posted == 0
    assert _transactions_for(db_session, rule) == []


def test_rule_stops_at_its_end_date(db_session, household, account, rent_category):
    rule = _rule(
        db_session,
        household,
        account,
        rent_category,
        start_date=date(2026, 1, 1),
        end_date=date(2026, 3, 31),
    )

    posted = recurring_service.materialize_due(db_session, household.id, date(2026, 12, 1))
    db_session.commit()

    assert posted == 3
    db_session.refresh(rule)
    assert rule.is_active is False


def test_deleting_a_category_in_use_by_a_rule_is_refused_clearly(
    client, owner_headers, db_session, household, account, rent_category
):
    """
    The FK would otherwise surface as a bare 500. The user should be told what
    is holding the category, not handed a server error.
    """
    _rule(db_session, household, account, rent_category)

    response = client.delete(f"/cashflow/categories/{rent_category.id}", headers=owner_headers)
    assert response.status_code == 409
    assert "recurring" in response.json()["detail"].lower()


def test_deleting_an_account_in_use_by_a_rule_is_refused_clearly(
    client, owner_headers, db_session, household, account, rent_category
):
    _rule(db_session, household, account, rent_category)

    response = client.delete(f"/accounts/{account.id}", headers=owner_headers)
    assert response.status_code == 409
    assert "recurring" in response.json()["detail"].lower()


def test_category_delete_still_works_once_the_rule_is_gone(
    client, owner_headers, db_session, household, account, rent_category
):
    rule = _rule(db_session, household, account, rent_category)

    assert client.delete(f"/cashflow/recurring/{rule.id}", headers=owner_headers).status_code == 204
    assert client.delete(f"/cashflow/categories/{rent_category.id}", headers=owner_headers).status_code == 204


def test_month_end_rule_posts_on_clamped_dates(db_session, household, account, rent_category):
    rule = _rule(db_session, household, account, rent_category, start_date=date(2026, 1, 31))

    recurring_service.materialize_due(db_session, household.id, date(2026, 4, 30))
    db_session.commit()

    dates = [r.date.date() for r in _transactions_for(db_session, rule)]
    assert dates == [date(2026, 1, 31), date(2026, 2, 28), date(2026, 3, 31), date(2026, 4, 30)]


def test_upcoming_occurrences_previews_without_posting(
    db_session, household, account, rent_category
):
    rule = _rule(db_session, household, account, rent_category, start_date=date(2026, 1, 1))

    upcoming = recurring_service.upcoming_occurrences(rule, until=date(2026, 4, 15))

    assert upcoming == [date(2026, 1, 1), date(2026, 2, 1), date(2026, 3, 1), date(2026, 4, 1)]
    assert _transactions_for(db_session, rule) == []


def test_upcoming_respects_end_date_and_pause(db_session, household, account, rent_category):
    ending = _rule(
        db_session, household, account, rent_category, end_date=date(2026, 2, 28)
    )
    assert recurring_service.upcoming_occurrences(ending, until=date(2026, 6, 1)) == [
        date(2026, 1, 1),
        date(2026, 2, 1),
    ]

    ending.is_active = False
    db_session.commit()
    assert recurring_service.upcoming_occurrences(ending, until=date(2026, 6, 1)) == []


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


def test_create_recurring_via_api(client, owner_headers, household, account, rent_category):
    response = client.post(
        "/cashflow/recurring",
        headers=owner_headers,
        json={
            "household_id": str(household.id),
            "account_id": str(account.id),
            "category_id": str(rent_category.id),
            "amount": "1800",
            "description": "Monthly rent",
            "frequency": "monthly",
            "start_date": "2026-01-01",
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["frequency"] == "monthly"
    # A new rule owes its first occurrence immediately.
    assert data["next_due_date"] == "2026-01-01"


def test_create_rejects_end_before_start(
    client, owner_headers, household, account, rent_category
):
    response = client.post(
        "/cashflow/recurring",
        headers=owner_headers,
        json={
            "household_id": str(household.id),
            "account_id": str(account.id),
            "category_id": str(rent_category.id),
            "amount": "100",
            "frequency": "monthly",
            "start_date": "2026-06-01",
            "end_date": "2026-01-01",
        },
    )
    assert response.status_code == 400


def test_create_rejects_non_positive_amount(
    client, owner_headers, household, account, rent_category
):
    response = client.post(
        "/cashflow/recurring",
        headers=owner_headers,
        json={
            "household_id": str(household.id),
            "account_id": str(account.id),
            "category_id": str(rent_category.id),
            "amount": "0",
            "frequency": "monthly",
            "start_date": "2026-01-01",
        },
    )
    assert response.status_code == 422


def test_run_endpoint_posts_due_transactions(
    client, owner_headers, db_session, household, account, rent_category
):
    # Start in the past so something is genuinely due today.
    _rule(db_session, household, account, rent_category, start_date=date(2026, 1, 1))

    response = client.post(
        f"/cashflow/recurring/household/{household.id}/run", headers=owner_headers
    )
    assert response.status_code == 200
    assert response.json()["posted"] >= 1

    # Running again immediately posts nothing.
    again = client.post(
        f"/cashflow/recurring/household/{household.id}/run", headers=owner_headers
    )
    assert again.json()["posted"] == 0


def test_upcoming_endpoint(client, owner_headers, db_session, household, account, rent_category):
    today = datetime.now(timezone.utc).date()
    _rule(db_session, household, account, rent_category, start_date=today, description="Rent")

    response = client.get(
        f"/cashflow/recurring/household/{household.id}/upcoming?days=90", headers=owner_headers
    )
    assert response.status_code == 200
    rows = response.json()
    assert len(rows) >= 3
    assert rows[0]["category_name"] == "Rent"
    assert rows[0]["account_name"] == "Checking"
    # Sorted by date.
    assert rows == sorted(rows, key=lambda r: r["date"])


@pytest.mark.parametrize("days", [0, 1000])
def test_upcoming_rejects_out_of_range_days(client, owner_headers, household, days):
    response = client.get(
        f"/cashflow/recurring/household/{household.id}/upcoming?days={days}", headers=owner_headers
    )
    assert response.status_code == 400


def test_pause_via_update(client, owner_headers, db_session, household, account, rent_category):
    rule = _rule(db_session, household, account, rent_category)

    response = client.put(
        f"/cashflow/recurring/{rule.id}", headers=owner_headers, json={"is_active": False}
    )
    assert response.status_code == 200
    assert response.json()["is_active"] is False


def test_delete_rule_keeps_the_history_it_posted(
    client, owner_headers, db_session, household, account, rent_category
):
    rule = _rule(db_session, household, account, rent_category, start_date=date(2026, 1, 1))
    recurring_service.materialize_due(db_session, household.id, date(2026, 2, 15))
    db_session.commit()
    posted_ids = [t.id for t in _transactions_for(db_session, rule)]
    assert len(posted_ids) == 2

    response = client.delete(f"/cashflow/recurring/{rule.id}", headers=owner_headers)
    assert response.status_code == 204

    surviving = (
        db_session.query(models.Transaction)
        .filter(models.Transaction.id.in_(posted_ids))
        .all()
    )
    assert len(surviving) == 2
    # The link is cleared, the money is not.
    assert all(t.recurring_transaction_id is None for t in surviving)


def test_recurring_requires_household_access(client, stranger_headers, household):
    assert (
        client.get(
            f"/cashflow/recurring/household/{household.id}", headers=stranger_headers
        ).status_code
        == 403
    )


def test_another_members_private_rule_is_hidden(
    client, owner_headers, db_session, household, account, rent_category, stranger
):
    db_session.add(
        models.HouseholdMember(
            id=uuid.uuid7(),
            user_id=stranger.id,
            household_id=household.id,
            role=models.HouseholdRoleType.editor,
        )
    )
    db_session.commit()

    _rule(db_session, household, account, rent_category, description="Shared rent")
    private = models.RecurringTransaction(
        id=uuid.uuid7(),
        household_id=household.id,
        account_id=account.id,
        category_id=rent_category.id,
        amount=Decimal("99"),
        frequency=F.monthly,
        start_date=date(2026, 1, 1),
        next_due_date=date(2026, 1, 1),
        owner_user_id=stranger.id,
        description="Their private rule",
    )
    db_session.add(private)
    db_session.commit()

    rows = client.get(
        f"/cashflow/recurring/household/{household.id}", headers=owner_headers
    ).json()
    descriptions = [r["description"] for r in rows]
    assert "Shared rent" in descriptions
    assert "Their private rule" not in descriptions
