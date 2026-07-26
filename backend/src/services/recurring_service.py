"""
Recurring transactions: salary, rent, subscriptions, standing repayments.

Occurrences are always computed as "the nth occurrence measured from
``start_date``" rather than by stepping forward from the previous one. That
matters for month-anchored rules: stepping would clamp Jan 31 to Feb 28 and then
never climb back, so a rule anchored on the 31st would silently become a rule on
the 28th. Measuring from the start gives Jan 31 → Feb 28 → Mar 31.

``next_due_date`` on the row is the only state materialization needs, which
makes ``materialize_due`` idempotent: it posts what is owed, advances the
pointer, and a second run in the same day posts nothing.
"""

from __future__ import annotations

from datetime import date, datetime, time, timezone
from decimal import Decimal
from typing import List, Optional
import uuid

from sqlalchemy.orm import Session

from src import models
from src.services.date_utils import add_months
from src.services.transaction_service import create_transaction

# A rule left alone for years shouldn't post thousands of rows in one request.
# Anything beyond this is a sign of bad data, so we stop and leave next_due_date
# where it is rather than hammering the DB.
MAX_CATCHUP_PER_RUN = 120

# How far ahead the upcoming-occurrences preview will ever look.
MAX_UPCOMING = 60


def occurrence(start: date, frequency: models.RecurrenceFrequency, index: int) -> date:
    """The `index`-th occurrence (0 = the start date itself)."""
    if index < 0:
        raise ValueError("occurrence index must be non-negative")

    if frequency == models.RecurrenceFrequency.weekly:
        return start + _days(7 * index)
    if frequency == models.RecurrenceFrequency.biweekly:
        return start + _days(14 * index)
    if frequency == models.RecurrenceFrequency.monthly:
        return add_months(start, index)
    if frequency == models.RecurrenceFrequency.quarterly:
        return add_months(start, 3 * index)
    if frequency == models.RecurrenceFrequency.yearly:
        return add_months(start, 12 * index)
    raise ValueError(f"unsupported frequency: {frequency}")


def _days(count: int):
    from datetime import timedelta

    return timedelta(days=count)


def _index_of(start: date, frequency: models.RecurrenceFrequency, current: date) -> int:
    """
    Which occurrence `current` is.

    Month-clamped dates (Feb 28 for a rule anchored on the 31st) don't invert
    cleanly with plain calendar arithmetic, so we estimate and then check a small
    window around the estimate for an exact match.
    """
    days = (current - start).days
    if frequency == models.RecurrenceFrequency.weekly:
        estimate = days // 7
    elif frequency == models.RecurrenceFrequency.biweekly:
        estimate = days // 14
    elif frequency == models.RecurrenceFrequency.monthly:
        estimate = days // 30
    elif frequency == models.RecurrenceFrequency.quarterly:
        estimate = days // 91
    else:
        estimate = days // 365

    estimate = max(estimate, 0)
    for candidate in range(max(estimate - 2, 0), estimate + 3):
        if occurrence(start, frequency, candidate) == current:
            return candidate

    # `current` isn't exactly on the schedule (hand-edited row). Fall back to the
    # last occurrence at or before it so we never post the same period twice.
    candidate = 0
    while occurrence(start, frequency, candidate + 1) <= current:
        candidate += 1
        if candidate > MAX_CATCHUP_PER_RUN * 12:
            break
    return candidate


def next_occurrence(rule: models.RecurringTransaction, after: date) -> date:
    """The first occurrence strictly after `after`."""
    index = _index_of(rule.start_date, rule.frequency, after)
    nxt = occurrence(rule.start_date, rule.frequency, index + 1)
    while nxt <= after:
        index += 1
        nxt = occurrence(rule.start_date, rule.frequency, index + 1)
    return nxt


def upcoming_occurrences(
    rule: models.RecurringTransaction, *, until: date, limit: int = MAX_UPCOMING
) -> List[date]:
    """
    Dates this rule will fire between its next due date and `until`.

    Paused rules return nothing — a preview of what a paused rule *would* do is
    misleading in a list headed "upcoming".
    """
    if not rule.is_active:
        return []

    dates: List[date] = []
    current = rule.next_due_date
    index = _index_of(rule.start_date, rule.frequency, current)

    while current <= until and len(dates) < min(limit, MAX_UPCOMING):
        if rule.end_date and current > rule.end_date:
            break
        dates.append(current)
        index += 1
        current = occurrence(rule.start_date, rule.frequency, index)

    return dates


def materialize_due(
    db: Session, household_id: uuid.UUID, as_of: Optional[date] = None
) -> int:
    """
    Post every occurrence that has come due, and return how many were posted.

    Safe to call repeatedly: each posting advances ``next_due_date`` past the
    date it just handled, so a second call on the same day is a no-op. Catches up
    multiple missed periods if the app has been idle. The caller commits.
    """
    as_of = as_of or datetime.now(timezone.utc).date()

    rules = (
        db.query(models.RecurringTransaction)
        .filter(
            models.RecurringTransaction.household_id == household_id,
            models.RecurringTransaction.is_active.is_(True),
            models.RecurringTransaction.next_due_date <= as_of,
        )
        .all()
    )

    posted = 0
    for rule in rules:
        account = db.query(models.FinancialAccount).filter(
            models.FinancialAccount.id == rule.account_id
        ).first()
        category = db.query(models.Category).filter(
            models.Category.id == rule.category_id
        ).first()
        # A rule whose account or category was deleted can't post. Deactivate it
        # rather than raising on every daily run.
        if not account or not category:
            rule.is_active = False
            continue

        for _ in range(MAX_CATCHUP_PER_RUN):
            due = rule.next_due_date
            if due > as_of:
                break
            if rule.end_date and due > rule.end_date:
                rule.is_active = False
                break

            create_transaction(
                db,
                account=account,
                category=category,
                date=datetime.combine(due, time.min).replace(tzinfo=timezone.utc),
                amount=Decimal(str(rule.amount)),
                currency=rule.currency,
                description=rule.description or f"Recurring: {category.name}",
                recurring_transaction_id=rule.id,
            )
            posted += 1

            rule.last_posted_date = due
            rule.next_due_date = next_occurrence(rule, due)

            if rule.end_date and rule.next_due_date > rule.end_date:
                rule.is_active = False
                break

    return posted


def materialize_due_all_households(db: Session, as_of: Optional[date] = None) -> int:
    """Run materialization for every household. Used by the daily job."""
    total = 0
    household_ids = [hh.id for hh in db.query(models.Household.id).all()]
    for household_id in household_ids:
        total += materialize_due(db, household_id, as_of)
    return total
