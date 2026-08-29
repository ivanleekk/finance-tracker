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

from sqlalchemy.orm import Session, joinedload

from src import models
from src.services import ledger_service
from src.services.date_utils import add_months
from src.services.money import dec, money

# How much history the runway calculation averages over. Long enough to smooth a
# one-off big month, short enough to reflect a real change in lifestyle.
RUNWAY_LOOKBACK_MONTHS = 6

# A household with no spending history has infinite runway, which is useless to
# display. Cap what we report so the UI can say "12+ months".
MAX_REPORTED_MONTHS = Decimal("99")


def period_bounds(period: models.BudgetPeriod, on: date) -> tuple[date, date]:
    """Start and end date of the budget period containing `on`."""
    if period == models.BudgetPeriod.yearly:
        return date(on.year, 1, 1), date(on.year, 12, 31)
    return date(on.year, on.month, 1), date(on.year, on.month, monthrange(on.year, on.month)[1])


@dataclass
class BudgetStatus:
    budget: models.Budget
    category_names: List[str]
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
) -> tuple[Dict[uuid.UUID, Decimal], Dict[uuid.UUID, set[date]]]:
    """
    Expense totals per category over [start, end], in the base currency, plus
    the distinct calendar months (each as its first-of-month date) each
    category has a qualifying transaction in.

    Transfers are excluded: moving money between your own accounts is not
    spending, and counting it would make every budget look blown.

    Two corrections come from the ledger. Money fronted for someone else is
    subtracted, because the transaction records what left the account and the
    ledger records whose it was — a dinner you paid for and split three ways is
    a third of your budget, not all of it. And spending somebody else paid for on
    your behalf is added, because it never touched an account of yours and so has
    no transaction at all, only a journal entry and a debt.
    """
    account_ids = _visible_account_ids(db, household_id, user)

    # A household with no visible accounts can still have spending somebody else
    # paid for, which by definition sits in no account.
    rows: List[models.Transaction] = []
    if account_ids:
        rows = (
            db.query(models.Transaction)
            .filter(
                models.Transaction.account_id.in_(account_ids),
                models.Transaction.transaction_type == models.TransactionType.expense,
                models.Transaction.transfer_id.is_(None),
                models.Transaction.date
                >= datetime.combine(start, datetime.min.time()).replace(tzinfo=timezone.utc),
                models.Transaction.date
                < datetime.combine(end, datetime.min.time()).replace(tzinfo=timezone.utc)
                + _one_day(),
            )
            .all()
        )

    totals: Dict[uuid.UUID, Decimal] = {}
    months: Dict[uuid.UUID, set[date]] = {}

    splits = ledger_service.counterparty_split_by_transaction(db, [row.id for row in rows])
    for row in rows:
        amount = row.amount_home_currency
        if amount is None:
            amount = row.amount
        own_share = dec(amount)
        split = splits.get(row.id)
        if split:
            own_share -= sum((line.amount for line in split), Decimal("0"))
        if own_share <= 0:
            # Fronted in full for someone else. None of it is yours, so it is not
            # a spend month either — a month whose only expense was somebody
            # else's should not drag the runway average down.
            continue
        totals[row.category_id] = totals.get(row.category_id, Decimal("0")) + own_share
        row_date = row.date.date()
        months.setdefault(row.category_id, set()).add(date(row_date.year, row_date.month, 1))

    ledger_only = ledger_service.ledger_only_category_movement(db, household_id, start, end, user)
    for category_id, movements in ledger_only.items():
        for moved_on, amount in movements:
            if amount <= 0:
                continue
            totals[category_id] = totals.get(category_id, Decimal("0")) + amount
            months.setdefault(category_id, set()).add(date(moved_on.year, moved_on.month, 1))

    return totals, months


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
        .options(joinedload(models.Budget.budget_categories))
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
            totals, _ = _spend_by_category(db, household_id, user, start, end)
            spend_cache[(start, end)] = totals
        category_ids = budget.category_ids
        spent = sum(
            (spend_cache[(start, end)].get(cid, Decimal("0")) for cid in category_ids),
            Decimal("0"),
        )

        limit = dec(budget.amount)
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
                category_names=[category_names.get(cid, "Unknown") for cid in category_ids],
                limit=money(limit),
                spent=money(spent),
                remaining=money(limit - spent),
                percent_used=float(spent / limit * 100) if limit > 0 else 0.0,
                period_start=start,
                period_end=end,
                days_elapsed=days_elapsed,
                days_total=days_total,
                projected_spend=money(projected),
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
    target_months = dec(household.emergency_fund_target_months if household else None) or Decimal("6")

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
        liquid_total += dec(value)

    # Trailing expenses, excluding transfers.
    lookback_start = add_months(date(on.year, on.month, 1), -RUNWAY_LOOKBACK_MONTHS)
    period_end = date(on.year, on.month, 1) - _one_day()  # end of last complete month

    months_of_history = 0
    total_expenses = Decimal("0")
    if period_end >= lookback_start:
        spend, months_by_category = _spend_by_category(db, household_id, user, lookback_start, period_end)
        # Skip the app's own bookkeeping categories. Buying shares is not a
        # survival cost — if the income stopped you would simply stop investing,
        # and counting it can easily double the fund the user is told to hold.
        # Budgets are per-category and still count these normally.
        excluded = _system_category_ids(db, household_id)
        included_category_ids = [cid for cid in spend if cid not in excluded]
        total_expenses = sum((spend[cid] for cid in included_category_ids), Decimal("0"))

        if total_expenses > 0:
            # Average over the calendar months that actually have real
            # spending, not a flat 6 — a household with one month of history
            # divided by 6 would report a fifth of its real burn rate.
            # Counting distinct spend-months (rather than the span from the
            # earliest to the latest one) also keeps a single old, unrelated
            # charge from stretching the window across months the household
            # spent nothing at all in.
            spend_months = set().union(*(months_by_category[cid] for cid in included_category_ids))
            months_of_history = min(RUNWAY_LOOKBACK_MONTHS, len(spend_months))

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

    target_amount = money(average_monthly * target_months)
    shortfall = money(max(target_amount - liquid_total, Decimal("0")))

    return EmergencyFundStatus(
        liquid_total=money(liquid_total),
        average_monthly_expenses=money(average_monthly),
        months_covered=months_covered.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
        if months_covered is not None
        else None,
        target_months=target_months,
        target_amount=target_amount,
        shortfall=shortfall,
        months_of_history=months_of_history,
        on_track=months_covered is not None and months_covered >= target_months,
    )
