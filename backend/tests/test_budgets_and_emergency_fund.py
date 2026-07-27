"""
Budgets and the emergency-fund runway.

The two things that must not go wrong: transfers must never count as spending
(they'd blow every budget), and a household with no logged expenses must not be
told it has an infinite runway.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest

from src import models
from src.services import budget_service


@pytest.fixture
def owner(db_session):
    user = models.User(
        id=uuid.uuid7(),
        email="budget_owner@example.com",
        name="Budget Owner",
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
        email="budget_stranger@example.com",
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
        name="Budget Household",
        base_currency="USD",
        country_code="US",
        owner_id=owner.id,
        emergency_fund_target_months=Decimal("6"),
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
    return acc


@pytest.fixture
def dining(db_session, household):
    cat = models.Category(
        id=uuid.uuid7(), household_id=household.id, name="Dining", type="expense"
    )
    db_session.add(cat)
    db_session.commit()
    db_session.refresh(cat)
    return cat


@pytest.fixture
def salary(db_session, household):
    cat = models.Category(
        id=uuid.uuid7(), household_id=household.id, name="Salary", type="income"
    )
    db_session.add(cat)
    db_session.commit()
    db_session.refresh(cat)
    return cat


def _balance(db_session, account, amount, on):
    db_session.add(
        models.AccountBalance(
            id=uuid.uuid7(),
            account_id=account.id,
            date=on,
            balance=Decimal(str(amount)),
            balance_home_currency=Decimal(str(amount)),
            is_manual=True,
        )
    )
    db_session.commit()


def _expense(db_session, account, category, amount, on, *, transfer_id=None, income=False):
    txn = models.Transaction(
        id=uuid.uuid7(),
        account_id=account.id,
        category_id=category.id,
        date=datetime.combine(on, datetime.min.time()).replace(tzinfo=timezone.utc),
        amount=Decimal(str(amount)),
        amount_home_currency=Decimal(str(amount)),
        currency="USD",
        exchange_rate=1.0,
        transaction_type=models.TransactionType.income if income else models.TransactionType.expense,
        transfer_id=transfer_id,
    )
    db_session.add(txn)
    db_session.commit()
    return txn


def _budget(db_session, household, category, amount, period=models.BudgetPeriod.monthly, owner_user_id=None):
    budget = models.Budget(
        id=uuid.uuid7(),
        household_id=household.id,
        category_id=category.id,
        amount=Decimal(str(amount)),
        period=period,
        owner_user_id=owner_user_id,
    )
    db_session.add(budget)
    db_session.commit()
    db_session.refresh(budget)
    return budget


# ---------------------------------------------------------------------------
# Period bounds
# ---------------------------------------------------------------------------


def test_monthly_period_bounds():
    start, end = budget_service.period_bounds(models.BudgetPeriod.monthly, date(2026, 2, 14))
    assert (start, end) == (date(2026, 2, 1), date(2026, 2, 28))


def test_monthly_period_bounds_leap_february():
    start, end = budget_service.period_bounds(models.BudgetPeriod.monthly, date(2028, 2, 14))
    assert end == date(2028, 2, 29)


def test_yearly_period_bounds():
    start, end = budget_service.period_bounds(models.BudgetPeriod.yearly, date(2026, 7, 9))
    assert (start, end) == (date(2026, 1, 1), date(2026, 12, 31))


# ---------------------------------------------------------------------------
# Budget status
# ---------------------------------------------------------------------------


def test_budget_tracks_spend_in_the_current_period(
    db_session, household, account, dining, owner
):
    _budget(db_session, household, dining, 600)
    _expense(db_session, account, dining, 120, date(2026, 3, 3))
    _expense(db_session, account, dining, 80, date(2026, 3, 10))
    # Previous month must not leak in.
    _expense(db_session, account, dining, 500, date(2026, 2, 20))

    [status] = budget_service.budget_statuses(db_session, household.id, owner, date(2026, 3, 15))

    assert status.spent == Decimal("200.00")
    assert status.limit == Decimal("600.00")
    assert status.remaining == Decimal("400.00")
    assert status.percent_used == pytest.approx(33.33, abs=0.01)


def test_transfers_never_count_as_spending(db_session, household, account, dining, owner):
    """A transfer between your own accounts is not spending."""
    _budget(db_session, household, dining, 500)
    _expense(db_session, account, dining, 100, date(2026, 3, 3))
    _expense(db_session, account, dining, 5000, date(2026, 3, 4), transfer_id=uuid.uuid7())

    [status] = budget_service.budget_statuses(db_session, household.id, owner, date(2026, 3, 15))

    assert status.spent == Decimal("100.00")


def test_income_never_counts_as_spending(db_session, household, account, dining, salary, owner):
    _budget(db_session, household, dining, 500)
    _expense(db_session, account, dining, 100, date(2026, 3, 3))
    _expense(db_session, account, salary, 9000, date(2026, 3, 5), income=True)

    [status] = budget_service.budget_statuses(db_session, household.id, owner, date(2026, 3, 15))
    assert status.spent == Decimal("100.00")


def test_projection_extrapolates_the_current_pace(db_session, household, account, dining, owner):
    _budget(db_session, household, dining, 600)
    # 300 spent in the first 10 days of a 31-day month -> ~930 projected.
    _expense(db_session, account, dining, 300, date(2026, 3, 5))

    [status] = budget_service.budget_statuses(db_session, household.id, owner, date(2026, 3, 10))

    assert status.days_elapsed == 10
    assert status.days_total == 31
    assert status.projected_spend == Decimal("930.00")
    assert status.projected_over is True


def test_budget_within_pace_is_not_flagged(db_session, household, account, dining, owner):
    _budget(db_session, household, dining, 600)
    _expense(db_session, account, dining, 100, date(2026, 3, 5))

    [status] = budget_service.budget_statuses(db_session, household.id, owner, date(2026, 3, 10))
    assert status.projected_over is False


def test_overspent_budget_reports_negative_remaining(
    db_session, household, account, dining, owner
):
    _budget(db_session, household, dining, 200)
    _expense(db_session, account, dining, 350, date(2026, 3, 5))

    [status] = budget_service.budget_statuses(db_session, household.id, owner, date(2026, 3, 10))
    assert status.remaining == Decimal("-150.00")
    assert status.percent_used == pytest.approx(175.0)


def test_yearly_budget_uses_the_whole_year(db_session, household, account, dining, owner):
    _budget(db_session, household, dining, 12000, period=models.BudgetPeriod.yearly)
    _expense(db_session, account, dining, 400, date(2026, 1, 15))
    _expense(db_session, account, dining, 600, date(2026, 6, 15))

    [status] = budget_service.budget_statuses(db_session, household.id, owner, date(2026, 7, 1))
    assert status.spent == Decimal("1000.00")
    assert status.days_total == 365


def test_budget_with_no_spending_is_zeroed(db_session, household, dining, owner):
    _budget(db_session, household, dining, 300)
    [status] = budget_service.budget_statuses(db_session, household.id, owner, date(2026, 3, 10))
    assert status.spent == Decimal("0.00")
    assert status.percent_used == 0.0


def test_another_members_private_account_spend_is_excluded(
    db_session, household, account, dining, owner, stranger
):
    db_session.add(
        models.HouseholdMember(
            id=uuid.uuid7(),
            user_id=stranger.id,
            household_id=household.id,
            role=models.HouseholdRoleType.editor,
        )
    )
    private_account = models.FinancialAccount(
        id=uuid.uuid7(),
        household_id=household.id,
        name="Their Card",
        liquidity=models.LiquidityStatus.liquid,
        tax_status=models.TaxTreatment.taxable,
        kind=models.AccountKind.asset,
        currency="USD",
        owner_user_id=stranger.id,
    )
    db_session.add(private_account)
    db_session.commit()

    _budget(db_session, household, dining, 500)
    _expense(db_session, account, dining, 100, date(2026, 3, 3))
    _expense(db_session, private_account, dining, 400, date(2026, 3, 4))

    [status] = budget_service.budget_statuses(db_session, household.id, owner, date(2026, 3, 15))
    assert status.spent == Decimal("100.00")


# ---------------------------------------------------------------------------
# Budget endpoints
# ---------------------------------------------------------------------------


def test_create_budget(client, owner_headers, household, dining):
    response = client.post(
        "/cashflow/budgets",
        headers=owner_headers,
        json={
            "household_id": str(household.id),
            "category_id": str(dining.id),
            "amount": "600",
            "period": "monthly",
        },
    )
    assert response.status_code == 201
    assert Decimal(response.json()["amount"]) == Decimal("600")


def test_income_categories_cannot_be_budgeted(client, owner_headers, household, salary):
    response = client.post(
        "/cashflow/budgets",
        headers=owner_headers,
        json={
            "household_id": str(household.id),
            "category_id": str(salary.id),
            "amount": "600",
        },
    )
    assert response.status_code == 400


def test_duplicate_budget_for_a_category_is_refused(client, owner_headers, household, dining, db_session):
    _budget(db_session, household, dining, 600)
    response = client.post(
        "/cashflow/budgets",
        headers=owner_headers,
        json={
            "household_id": str(household.id),
            "category_id": str(dining.id),
            "amount": "900",
        },
    )
    assert response.status_code == 409


def test_budget_status_endpoint(client, owner_headers, db_session, household, account, dining):
    _budget(db_session, household, dining, 600)
    _expense(db_session, account, dining, 150, date(2026, 3, 5))

    response = client.get(
        f"/cashflow/budgets/household/{household.id}/status?as_of=2026-03-10",
        headers=owner_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert Decimal(data["total_limit"]) == Decimal("600.00")
    assert Decimal(data["total_spent"]) == Decimal("150.00")
    assert data["budgets"][0]["category_name"] == "Dining"


def test_budget_endpoints_require_household_access(client, stranger_headers, household):
    assert client.get(
        f"/cashflow/budgets/household/{household.id}/status", headers=stranger_headers
    ).status_code == 403


# ---------------------------------------------------------------------------
# Emergency fund
# ---------------------------------------------------------------------------


def test_runway_from_liquid_cash_and_trailing_expenses(
    db_session, household, account, dining, owner
):
    """12,000 cash against 2,000/month of spending is 6 months of runway."""
    on = date(2026, 7, 15)
    _balance(db_session, account, 12000, date(2026, 7, 1))
    # 2,000/month across the six complete months before July.
    for month in range(1, 7):
        _expense(db_session, account, dining, 2000, date(2026, month, 10))

    status = budget_service.emergency_fund_status(db_session, household.id, owner, on)

    assert status.liquid_total == Decimal("12000.00")
    assert status.average_monthly_expenses == Decimal("2000.00")
    assert status.months_covered == Decimal("6.0")
    assert status.on_track is True
    assert status.shortfall == Decimal("0.00")


def test_shortfall_when_under_target(db_session, household, account, dining, owner):
    on = date(2026, 7, 15)
    _balance(db_session, account, 4000, date(2026, 7, 1))
    for month in range(1, 7):
        _expense(db_session, account, dining, 2000, date(2026, month, 10))

    status = budget_service.emergency_fund_status(db_session, household.id, owner, on)

    assert status.months_covered == Decimal("2.0")
    assert status.on_track is False
    # Target is 6 x 2,000 = 12,000; they have 4,000.
    assert status.target_amount == Decimal("12000.00")
    assert status.shortfall == Decimal("8000.00")


def test_no_spending_history_gives_an_undefined_runway_not_an_infinite_one(
    db_session, household, account, owner
):
    _balance(db_session, account, 5000, date(2026, 7, 1))

    status = budget_service.emergency_fund_status(db_session, household.id, owner, date(2026, 7, 15))

    assert status.months_covered is None
    assert status.on_track is False
    assert status.liquid_total == Decimal("5000.00")


def test_illiquid_and_investment_accounts_are_excluded(
    db_session, household, account, dining, owner
):
    """An emergency fund you must sell equities or a house to reach isn't one."""
    on = date(2026, 7, 15)
    _balance(db_session, account, 3000, date(2026, 7, 1))

    for liquidity in (models.LiquidityStatus.market_liquid, models.LiquidityStatus.illiquid,
                      models.LiquidityStatus.retirement):
        other = models.FinancialAccount(
            id=uuid.uuid7(),
            household_id=household.id,
            name=f"Other {liquidity.value}",
            liquidity=liquidity,
            tax_status=models.TaxTreatment.taxable,
            kind=models.AccountKind.asset,
            currency="USD",
        )
        db_session.add(other)
        db_session.commit()
        _balance(db_session, other, 900000, date(2026, 7, 1))

    for month in range(1, 7):
        _expense(db_session, account, dining, 1000, date(2026, month, 10))

    status = budget_service.emergency_fund_status(db_session, household.id, owner, on)
    assert status.liquid_total == Decimal("3000.00")
    assert status.months_covered == Decimal("3.0")


def test_liabilities_do_not_add_to_the_fund(db_session, household, account, dining, owner):
    card = models.FinancialAccount(
        id=uuid.uuid7(),
        household_id=household.id,
        name="Credit Card",
        liquidity=models.LiquidityStatus.liquid,
        tax_status=models.TaxTreatment.taxable,
        kind=models.AccountKind.liability,
        currency="USD",
    )
    db_session.add(card)
    db_session.commit()
    _balance(db_session, card, 2000, date(2026, 7, 1))
    _balance(db_session, account, 5000, date(2026, 7, 1))

    status = budget_service.emergency_fund_status(db_session, household.id, owner, date(2026, 7, 15))
    assert status.liquid_total == Decimal("5000.00")


def test_transfers_do_not_inflate_the_burn_rate(db_session, household, account, dining, owner):
    on = date(2026, 7, 15)
    _balance(db_session, account, 6000, date(2026, 7, 1))
    for month in range(1, 7):
        _expense(db_session, account, dining, 1000, date(2026, month, 10))
        _expense(db_session, account, dining, 50000, date(2026, month, 11), transfer_id=uuid.uuid7())

    status = budget_service.emergency_fund_status(db_session, household.id, owner, on)
    assert status.average_monthly_expenses == Decimal("1000.00")
    assert status.months_covered == Decimal("6.0")


def test_overdrawn_household_has_zero_runway_not_a_negative_one(
    db_session, household, account, dining, owner
):
    """An overdrawn account means no runway — "-3.7 months" is meaningless."""
    on = date(2026, 7, 15)
    _balance(db_session, account, -4000, date(2026, 7, 1))
    for month in range(1, 7):
        _expense(db_session, account, dining, 1000, date(2026, month, 10))

    status = budget_service.emergency_fund_status(db_session, household.id, owner, on)

    assert status.liquid_total == Decimal("-4000.00")
    assert status.months_covered == Decimal("0.0")
    assert status.on_track is False


def test_new_household_with_one_month_of_history_is_not_averaged_over_six(
    db_session, household, account, dining, owner
):
    """
    A household that only started logging expenses last month must get that
    month's real total, not total/6 (which would understate the burn rate by
    5x for anyone who just signed up).
    """
    on = date(2026, 7, 15)
    _balance(db_session, account, 6000, date(2026, 7, 1))
    _expense(db_session, account, dining, 600, date(2026, 6, 10))

    status = budget_service.emergency_fund_status(db_session, household.id, owner, on)

    assert status.average_monthly_expenses == Decimal("600.00")
    assert status.months_covered == Decimal("10.0")


def test_partial_history_divides_by_actual_months_not_the_full_lookback(
    db_session, household, account, dining, owner
):
    on = date(2026, 7, 15)
    _balance(db_session, account, 6000, date(2026, 7, 1))
    # Two of the six lookback months have spending; the other four have none.
    _expense(db_session, account, dining, 1000, date(2026, 5, 10))
    _expense(db_session, account, dining, 1000, date(2026, 6, 10))

    status = budget_service.emergency_fund_status(db_session, household.id, owner, on)

    assert status.average_monthly_expenses == Decimal("1000.00")


def test_early_system_category_spend_does_not_stretch_the_history_window(
    db_session, household, account, dining, owner
):
    """
    An Investment purchase four months ago must not make a household look
    like it has four months of real spending history when the only actual
    (non-system) expense is from last month.
    """
    on = date(2026, 7, 15)
    investment = models.Category(
        id=uuid.uuid7(),
        household_id=household.id,
        name=models.SYSTEM_CATEGORY_INVESTMENT,
        type="expense",
    )
    db_session.add(investment)
    db_session.commit()

    _balance(db_session, account, 6000, date(2026, 7, 1))
    _expense(db_session, account, investment, 5000, date(2026, 3, 10))
    _expense(db_session, account, dining, 600, date(2026, 6, 10))

    status = budget_service.emergency_fund_status(db_session, household.id, owner, on)

    assert status.average_monthly_expenses == Decimal("600.00")


def test_a_single_old_transaction_does_not_dilute_concentrated_recent_spending(
    db_session, household, account, dining, owner
):
    """
    One old, unrelated charge (e.g. an annual subscription renewal) must not
    stretch the averaging window across the months in between where nothing
    else was spent. It should count as one extra spend-month, not pull the
    whole window back to its own date the way averaging over the
    earliest-to-latest span would.
    """
    on = date(2026, 7, 15)
    software = models.Category(
        id=uuid.uuid7(), household_id=household.id, name="Software", type="expense"
    )
    db_session.add(software)
    db_session.commit()

    _balance(db_session, account, 6000, date(2026, 7, 1))
    _expense(db_session, account, software, 12, date(2026, 2, 5))
    _expense(db_session, account, dining, 3000, date(2026, 6, 10))

    status = budget_service.emergency_fund_status(db_session, household.id, owner, on)

    # 2 distinct spend-months (Feb, Jun) — total/2, not the 5-month span
    # between them, which would understate the real recent burn rate.
    assert status.average_monthly_expenses == Decimal("1506.00")


def test_investment_purchases_do_not_inflate_the_burn_rate(
    db_session, household, account, dining, owner
):
    """
    Buying shares is filed under the app's auto-created "Investment" expense
    category. It is not a survival cost — if the income stopped you would stop
    investing — so it must not raise the emergency fund the user is told to hold.
    """
    on = date(2026, 7, 15)
    investment = models.Category(
        id=uuid.uuid7(),
        household_id=household.id,
        name=models.SYSTEM_CATEGORY_INVESTMENT,
        type="expense",
    )
    db_session.add(investment)
    db_session.commit()

    _balance(db_session, account, 6000, date(2026, 7, 1))
    for month in range(1, 7):
        _expense(db_session, account, dining, 1000, date(2026, month, 10))
        _expense(db_session, account, investment, 5000, date(2026, month, 11))

    status = budget_service.emergency_fund_status(db_session, household.id, owner, on)

    # 1,000/month of real spending, not 6,000.
    assert status.average_monthly_expenses == Decimal("1000.00")
    assert status.months_covered == Decimal("6.0")
    assert status.target_amount == Decimal("6000.00")


def test_balance_adjustments_do_not_inflate_the_burn_rate(
    db_session, household, account, dining, owner
):
    on = date(2026, 7, 15)
    adjustment = models.Category(
        id=uuid.uuid7(),
        household_id=household.id,
        name=models.SYSTEM_CATEGORY_BALANCE_ADJUSTMENT,
        type="expense",
    )
    db_session.add(adjustment)
    db_session.commit()

    _balance(db_session, account, 6000, date(2026, 7, 1))
    for month in range(1, 7):
        _expense(db_session, account, dining, 1000, date(2026, month, 10))
        _expense(db_session, account, adjustment, 2500, date(2026, month, 11))

    status = budget_service.emergency_fund_status(db_session, household.id, owner, on)
    assert status.average_monthly_expenses == Decimal("1000.00")


def test_budgets_still_count_system_categories(db_session, household, account, owner):
    """
    The exclusion is runway-only. Budgeting "Investment" to cap how much goes
    into the market each month is a legitimate thing to want, so budgets must
    keep counting it.
    """
    investment = models.Category(
        id=uuid.uuid7(),
        household_id=household.id,
        name=models.SYSTEM_CATEGORY_INVESTMENT,
        type="expense",
    )
    db_session.add(investment)
    db_session.commit()

    _budget(db_session, household, investment, 2000)
    _expense(db_session, account, investment, 1500, date(2026, 3, 5))

    [status] = budget_service.budget_statuses(db_session, household.id, owner, date(2026, 3, 15))
    assert status.spent == Decimal("1500.00")


def test_runway_is_capped_rather_than_reported_as_absurd(
    db_session, household, account, dining, owner
):
    on = date(2026, 7, 15)
    _balance(db_session, account, 10_000_000, date(2026, 7, 1))
    for month in range(1, 7):
        _expense(db_session, account, dining, 100, date(2026, month, 10))

    status = budget_service.emergency_fund_status(db_session, household.id, owner, on)
    assert status.months_covered == Decimal("99.0")


def test_emergency_fund_endpoint(client, owner_headers, db_session, household, account, dining):
    _balance(db_session, account, 12000, date(2026, 7, 1))
    for month in range(1, 7):
        _expense(db_session, account, dining, 2000, date(2026, month, 10))

    response = client.get(
        f"/cashflow/household/{household.id}/emergency-fund?as_of=2026-07-15",
        headers=owner_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert Decimal(data["months_covered"]) == Decimal("6.0")
    assert data["on_track"] is True
    assert data["base_currency"] == "USD"


def test_emergency_fund_respects_a_custom_target(
    client, owner_headers, db_session, household, account, dining
):
    household.emergency_fund_target_months = Decimal("12")
    db_session.commit()

    _balance(db_session, account, 12000, date(2026, 7, 1))
    for month in range(1, 7):
        _expense(db_session, account, dining, 2000, date(2026, month, 10))

    data = client.get(
        f"/cashflow/household/{household.id}/emergency-fund?as_of=2026-07-15",
        headers=owner_headers,
    ).json()
    # 6 months of cover against a 12-month target.
    assert data["on_track"] is False
    assert Decimal(data["target_amount"]) == Decimal("24000.00")
    assert Decimal(data["shortfall"]) == Decimal("12000.00")


def test_emergency_fund_requires_household_access(client, stranger_headers, household):
    assert client.get(
        f"/cashflow/household/{household.id}/emergency-fund", headers=stranger_headers
    ).status_code == 403


@pytest.mark.parametrize("months", ["-1", "500"])
def test_household_rejects_absurd_emergency_target(client, owner_headers, household, months):
    response = client.put(
        f"/users/households/{household.id}",
        headers=owner_headers,
        json={"emergency_fund_target_months": months},
    )
    assert response.status_code == 422
