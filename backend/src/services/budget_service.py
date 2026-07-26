"""
Budgets and the emergency-fund runway.

Both answer questions the app previously left to the user's head: "am I
overspending this category?" and "how long would my cash last if the income
stopped?".

Everything is computed in the household base currency from
``amount_home_currency``, so a household spending across currencies gets one
comparable number.
"""

from __future__ import annotations

from calendar import monthrange
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Dict, List, Optional
import uuid

from sqlalchemy.orm import Session

from src import models
from src.services.date_utils import add_months

CENTS = Decimal("0.01")

# How much history the runway calculation averages over. Long enough to smooth a
# one-off big month, short enough to reflect a real change in lifestyle.
RUNWAY_LOOKBACK_MONTHS = 6

# A household with no spending history has infinite runway, which is useless to
# display. Cap what we report so the UI can say "12+ months".
MAX_REPORTED_MONTHS = Decimal("99")


def _money(value: Decimal) -> Decimal:
    return value.quantize(CENTS, rounding=ROUND_HALF_UP)


def _dec(value) -> Decimal:
    if value is None:
        return Decimal("0")
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def period_bounds(period: models.BudgetPeriod, on: date) -> tuple[date, date]:
    """Start and end date of the budget period containing `on`."""
    if period == models.BudgetPeriod.yearly:
        return date(on.year, 1, 1), date(on.year, 12, 31)
    return date(on.year, on.month, 1), date(on.year, on.month, monthrange(on.year, on.month)[1])


@dataclass
class BudgetStatus:
    budget: models.Budget
    category_name: str
    limit: Decimal
    spent: Decimal
    remaining: Decimal
    percent_used: float
    period_start: date
    period_end: date
    days_elapsed: int
    days_total: int
    # Spend extrapolated to the end of the period at the current daily rate.
    projected_spend: Decimal
    projected_over: bool


def _visible_account_ids(db: Session, household_id: uuid.UUID, user: models.User) -> List[uuid.UUID]:
    return [
        a.id
        for a in db.query(models.FinancialAccount.id, models.FinancialAccount.owner_user_id)
        .filter(
            models.FinancialAccount.household_id == household_id,
            (models.FinancialAccount.owner_user_id.is_(None))
            | (models.FinancialAccount.owner_user_id == user.id),
        )
        .all()
    ]


def _spend_by_category(
    db: Session,
    household_id: uuid.UUID,
    user: models.User,
    start: date,
    end: date,
) -> Dict[uuid.UUID, Decimal]:
    """
    Expense totals per category over [start, end], in the base currency.

    Transfers are excluded: moving money between your own accounts is not
    spending, and counting it would make every budget look blown.
    """
    account_ids = _visible_account_ids(db, household_id, user)
    if not account_ids:
        return {}

    rows = (
        db.query(models.Transaction)
        .filter(
            models.Transaction.account_id.in_(account_ids),
            models.Transaction.transaction_type == models.TransactionType.expense,
            models.Transaction.transfer_id.is_(None),
            models.Transaction.date >= datetime.combine(start, datetime.min.time()).replace(tzinfo=timezone.utc),
            models.Transaction.date < datetime.combine(end, datetime.min.time()).replace(tzinfo=timezone.utc)
            + _one_day(),
        )
        .all()
    )

    totals: Dict[uuid.UUID, Decimal] = {}
    for row in rows:
        amount = row.amount_home_currency
        if amount is None:
            amount = row.amount
        totals[row.category_id] = totals.get(row.category_id, Decimal("0")) + _dec(amount)
    return totals


def _one_day():
    from datetime import timedelta

    return timedelta(days=1)


def _system_category_ids(db: Session, household_id: uuid.UUID) -> set:
    """
    Ids of the categories the app generates itself (see models.SYSTEM_CATEGORY_NAMES).

    Matched by name because that is how the creating code finds-or-creates them;
    a user-made category that happens to share the name is indistinguishable and
    is treated the same way.
    """
    return {
        c.id
        for c in db.query(models.Category.id, models.Category.name)
        .filter(
            models.Category.household_id == household_id,
            models.Category.name.in_(models.SYSTEM_CATEGORY_NAMES),
        )
        .all()
    }


def budget_statuses(
    db: Session,
    household_id: uuid.UUID,
    user: models.User,
    on: Optional[date] = None,
) -> List[BudgetStatus]:
    """Every budget the user can see, with spend so far in its current period."""
    on = on or datetime.now(timezone.utc).date()

    budgets = (
        db.query(models.Budget)
        .filter(
            models.Budget.household_id == household_id,
            (models.Budget.owner_user_id.is_(None)) | (models.Budget.owner_user_id == user.id),
        )
        .all()
    )
    if not budgets:
        return []

    category_names = {
        c.id: c.name
        for c in db.query(models.Category).filter(models.Category.household_id == household_id).all()
    }

    # Monthly and yearly budgets need different windows; compute each window once.
    spend_cache: Dict[tuple[date, date], Dict[uuid.UUID, Decimal]] = {}

    statuses: List[BudgetStatus] = []
    for budget in budgets:
        start, end = period_bounds(budget.period, on)
        if (start, end) not in spend_cache:
            spend_cache[(start, end)] = _spend_by_category(db, household_id, user, start, end)
        spent = spend_cache[(start, end)].get(budget.category_id, Decimal("0"))

        limit = _dec(budget.amount)
        days_total = (end - start).days + 1
        # Clamp: viewing a past or future period shouldn't project off the end.
        days_elapsed = min(max((on - start).days + 1, 0), days_total)

        if days_elapsed > 0:
            projected = spent / Decimal(days_elapsed) * Decimal(days_total)
        else:
            projected = Decimal("0")

        statuses.append(
            BudgetStatus(
                budget=budget,
                category_name=category_names.get(budget.category_id, "Unknown"),
                limit=_money(limit),
                spent=_money(spent),
                remaining=_money(limit - spent),
                percent_used=float(spent / limit * 100) if limit > 0 else 0.0,
                period_start=start,
                period_end=end,
                days_elapsed=days_elapsed,
                days_total=days_total,
                projected_spend=_money(projected),
                projected_over=limit > 0 and projected > limit,
            )
        )

    statuses.sort(key=lambda s: s.percent_used, reverse=True)
    return statuses


@dataclass
class EmergencyFundStatus:
    liquid_total: Decimal
    average_monthly_expenses: Decimal
    months_covered: Optional[Decimal]  # None when there is no spending history
    target_months: Decimal
    target_amount: Decimal
    shortfall: Decimal
    months_of_history: int
    on_track: bool


def emergency_fund_status(
    db: Session,
    household_id: uuid.UUID,
    user: models.User,
    on: Optional[date] = None,
) -> EmergencyFundStatus:
    """
    How long the household's liquid cash would last at its recent burn rate.

    "Liquid" means asset accounts marked ``LiquidityStatus.liquid`` — cash you
    could actually reach this week. Investments are excluded deliberately: an
    emergency fund you have to sell equities to reach is not an emergency fund.
    """
    on = on or datetime.now(timezone.utc).date()

    household = db.query(models.Household).filter(models.Household.id == household_id).first()
    target_months = _dec(household.emergency_fund_target_months if household else None) or Decimal("6")

    accounts = (
        db.query(models.FinancialAccount)
        .filter(
            models.FinancialAccount.household_id == household_id,
            models.FinancialAccount.kind == models.AccountKind.asset,
            models.FinancialAccount.liquidity == models.LiquidityStatus.liquid,
            (models.FinancialAccount.owner_user_id.is_(None))
            | (models.FinancialAccount.owner_user_id == user.id),
        )
        .all()
    )

    liquid_total = Decimal("0")
    for account in accounts:
        latest = (
            db.query(models.AccountBalance)
            .filter(models.AccountBalance.account_id == account.id)
            .order_by(models.AccountBalance.date.desc())
            .first()
        )
        if latest is None:
            continue
        value = latest.balance_home_currency
        if value is None:
            value = latest.balance
        liquid_total += _dec(value)

    # Trailing expenses, excluding transfers.
    lookback_start = add_months(date(on.year, on.month, 1), -RUNWAY_LOOKBACK_MONTHS)
    period_end = date(on.year, on.month, 1) - _one_day()  # end of last complete month

    months_of_history = 0
    total_expenses = Decimal("0")
    if period_end >= lookback_start:
        spend = _spend_by_category(db, household_id, user, lookback_start, period_end)
        # Skip the app's own bookkeeping categories. Buying shares is not a
        # survival cost — if the income stopped you would simply stop investing,
        # and counting it can easily double the fund the user is told to hold.
        # Budgets are per-category and still count these normally.
        excluded = _system_category_ids(db, household_id)
        total_expenses = sum(
            (amount for category_id, amount in spend.items() if category_id not in excluded),
            Decimal("0"),
        )
        months_of_history = RUNWAY_LOOKBACK_MONTHS

    average_monthly = (
        total_expenses / Decimal(months_of_history) if months_of_history > 0 else Decimal("0")
    )

    if average_monthly > 0:
        # An overdrawn household has no runway at all. Reporting a negative
        # number of months is meaningless — floor it at zero so the UI can say
        # "0 months" and flag it as critical.
        months_covered = max(
            min(liquid_total / average_monthly, MAX_REPORTED_MONTHS), Decimal("0")
        )
    else:
        # No recorded spending: the runway is undefined, not infinite. Saying
        # "99 months" to someone who simply hasn't logged expenses yet would be
        # a false reassurance.
        months_covered = None

    target_amount = _money(average_monthly * target_months)
    shortfall = _money(max(target_amount - liquid_total, Decimal("0")))

    return EmergencyFundStatus(
        liquid_total=_money(liquid_total),
        average_monthly_expenses=_money(average_monthly),
        months_covered=months_covered.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
        if months_covered is not None
        else None,
        target_months=target_months,
        target_amount=target_amount,
        shortfall=shortfall,
        months_of_history=months_of_history,
        on_track=months_covered is not None and months_covered >= target_months,
    )
