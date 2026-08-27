"""
Per-card spend limits, measured against that card's own cycle.

This is `budget_service` re-parameterised, and deliberately so: the spend
rollup, the pace projection and the over/at-risk tone are the same machinery.
Two things differ — the clock (a statement window instead of a calendar month)
and the taxonomy (the card's own categories instead of the household's shared
ones) — and everything else is shared shape.

Nothing here reads `Transaction.mcc`. Limits are driven entirely by the card
category the user picked. If every merchant code in the database were wrong
tomorrow, no meter would move; that constraint is what keeps the feature
buildable by an app with no bank feed.
"""

from __future__ import annotations

from calendar import monthrange
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Dict, List, Optional
import uuid

from sqlalchemy.orm import Session, joinedload

from src import models
from src.services.budget_service import _dec, _money


ONE_DAY = timedelta(days=1)


def _clamped_day(year: int, month: int, day: int) -> date:
    """
    `day` in the given month, pulled back to the last day when the month is
    short. A card closing on the 31st has to close in February too, and the
    answer is the 28th (or 29th) rather than an error or a slip into March.
    """
    return date(year, month, min(day, monthrange(year, month)[1]))


def _previous_month(year: int, month: int) -> tuple[int, int]:
    return (year - 1, 12) if month == 1 else (year, month - 1)


def _next_month(year: int, month: int) -> tuple[int, int]:
    return (year + 1, 1) if month == 12 else (year, month + 1)


def statement_bounds(card: models.Card, on: date) -> tuple[date, date]:
    """
    The card's cycle containing `on`, as an inclusive [start, end] pair.

    Sits beside `budget_service.period_bounds` and answers the same question for
    a different clock. A card closing on the 18th has a cycle running the 19th
    to the 18th; the closing date itself belongs to the cycle it closes, which
    is how statements read.

    A `calendar` card ignores `statement_day` entirely — some issuers reset
    bonus caps on the calendar month no matter when the statement closes, and
    that is not derivable from the statement date, so it is stated per card.
    """
    if card.cycle_basis == models.CycleBasis.calendar:
        return date(on.year, on.month, 1), _clamped_day(on.year, on.month, 31)

    day = card.statement_day or 1
    this_close = _clamped_day(on.year, on.month, day)

    if on <= this_close:
        prev_year, prev_month = _previous_month(on.year, on.month)
        start = _clamped_day(prev_year, prev_month, day) + ONE_DAY
        return start, this_close

    next_year, next_month = _next_month(on.year, on.month)
    return this_close + ONE_DAY, _clamped_day(next_year, next_month, day)


def limit_bounds(card: models.Card, limit: models.CardLimit, on: date) -> tuple[date, date]:
    """
    The window a given limit resets over.

    Most caps follow the card's own cycle, but a card whose statement closes
    mid-month can still carry a cap the issuer resets on the calendar — so the
    basis is per limit rather than inherited from the card.
    """
    if limit.reset_basis == models.LimitResetBasis.cycle:
        return statement_bounds(card, on)
    if limit.reset_basis == models.LimitResetBasis.calendar_month:
        return date(on.year, on.month, 1), _clamped_day(on.year, on.month, 31)
    if limit.reset_basis == models.LimitResetBasis.quarter:
        first = 3 * ((on.month - 1) // 3) + 1
        last = first + 2
        return date(on.year, first, 1), _clamped_day(on.year, last, 31)
    return date(on.year, 1, 1), date(on.year, 12, 31)


@dataclass
class CardCategoryStatus:
    """Spend in one of a card's categories over the window being reported."""

    category: models.CardCategory
    spent: Decimal


@dataclass
class CardLimitStatus:
    """
    A limit and how this cycle is tracking against it.

    Field-for-field the shape `BudgetStatus` already returns, so the clients'
    existing budget presentation — tone, bar fraction, pace marker — reads it
    with no new maths. `direction` is the one addition: it tells the reader
    whether `remaining` is headroom to protect or a shortfall to close.
    """

    limit: models.CardLimit
    category_names: List[str]
    amount: Decimal
    spent: Decimal
    # Ceiling: what is left before the cap. Floor: what is still needed, or 0
    # once the minimum is met. Never negative in either direction — "how far
    # past" is `spent` against `amount`, and a negative remaining reads as a
    # number the user has to interpret.
    remaining: Decimal
    percent_used: float
    period_start: date
    period_end: date
    days_elapsed: int
    days_total: int
    projected_spend: Decimal
    # Ceiling: the current pace bursts the cap before the cycle closes. Floor:
    # the current pace fails to reach the minimum. Either way, the thing the
    # user wants to be warned about.
    projected_missed: bool
    # True once the limit is already decided for this window — burst, or met.
    settled: bool


def _card_spend_by_category(
    db: Session,
    card: models.Card,
    start: date,
    end: date,
) -> Dict[Optional[uuid.UUID], Decimal]:
    """
    What this card was charged over [start, end], grouped by card category.

    Measured in the **account's own currency**, not the household base
    currency. This is where it departs from `budget_service`, and deliberately:
    the issuer's cap is denominated in the card's currency, so converting to the
    household base would meter against a number the issuer never applies.

    Transfers are excluded, which is what keeps paying the bill from reading as
    spending — the payment moves money to the card, it is not a new purchase.
    System categories go too, for the reason the burn rate drops them.

    The ledger split correction that `budget_service` applies is deliberately
    **not** applied here. A dinner you paid for and split three ways is a third
    of your budget but the whole of the card's cap: the issuer charged the card
    the full amount and counts the full amount.
    """
    system_category_ids = [
        c.id
        for c in db.query(models.Category.id, models.Category.name)
        .filter(
            models.Category.household_id == card.account.household_id,
            models.Category.name.in_(models.SYSTEM_CATEGORY_NAMES),
        )
        .all()
    ]

    query = db.query(models.Transaction).filter(
        models.Transaction.account_id == card.financial_account_id,
        models.Transaction.transaction_type == models.TransactionType.expense,
        models.Transaction.transfer_id.is_(None),
        models.Transaction.date >= datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc),
        models.Transaction.date < datetime.combine(end + ONE_DAY, datetime.min.time(), tzinfo=timezone.utc),
    )
    if system_category_ids:
        query = query.filter(models.Transaction.category_id.notin_(system_category_ids))

    default_id = next((c.id for c in card.categories if c.is_default), None)

    totals: Dict[Optional[uuid.UUID], Decimal] = {}
    for txn in query.all():
        # The amount that actually hit the card: the entered amount converted at
        # the rate recorded on the row, which is the account-currency figure.
        charged = _dec(txn.amount) * _dec(txn.exchange_rate if txn.exchange_rate else 1)
        key = txn.card_category_id or default_id
        totals[key] = totals.get(key, Decimal("0")) + charged
    return totals


def card_limit_statuses(
    db: Session,
    card: models.Card,
    on: Optional[date] = None,
) -> List[CardLimitStatus]:
    """
    Every limit on this card, with spend so far in the window it resets over.

    Several categories can point at one limit — "the first $1,000 across dining
    and groceries" — so spend is rolled up from all of them. A category with no
    limit is tracked but produces no meter here; its spend shows on the
    breakdown instead.
    """
    on = on or datetime.now(timezone.utc).date()

    # Limits can reset on different bases, so each distinct window is summed once.
    spend_cache: Dict[tuple[date, date], Dict[Optional[uuid.UUID], Decimal]] = {}

    statuses: List[CardLimitStatus] = []
    for limit in card.limits:
        start, end = limit_bounds(card, limit, on)
        if (start, end) not in spend_cache:
            spend_cache[(start, end)] = _card_spend_by_category(db, card, start, end)
        totals = spend_cache[(start, end)]

        categories = [c for c in card.categories if c.limit_id == limit.id]
        spent = sum((totals.get(c.id, Decimal("0")) for c in categories), Decimal("0"))
        amount = _dec(limit.amount)

        days_total = (end - start).days + 1
        # Clamp: viewing a past or future cycle must not project off the end.
        days_elapsed = min(max((on - start).days + 1, 0), days_total)
        projected = spent / Decimal(days_elapsed) * Decimal(days_total) if days_elapsed > 0 else Decimal("0")

        # A ceiling and a floor read the same distance from the same number:
        # `remaining` is how far there is still to go, and the limit is settled
        # once spend reaches the amount — burst for a ceiling, met for a floor.
        # Only the direction the projection has to fall in actually differs.
        is_floor = limit.direction == models.LimitDirection.floor
        remaining = max(amount - spent, Decimal("0"))
        settled = spent >= amount
        projected_missed = amount > 0 and (
            projected < amount if is_floor else projected > amount
        )

        statuses.append(
            CardLimitStatus(
                limit=limit,
                category_names=[c.name for c in categories],
                amount=_money(amount),
                spent=_money(spent),
                remaining=_money(remaining),
                percent_used=float(spent / amount * 100) if amount > 0 else 0.0,
                period_start=start,
                period_end=end,
                days_elapsed=days_elapsed,
                days_total=days_total,
                projected_spend=_money(projected),
                projected_missed=projected_missed,
                settled=settled,
            )
        )

    # Most urgent first. A ceiling is urgent when it is nearly full; a floor is
    # urgent when it is nearly empty, so the floor's ordering key is inverted.
    statuses.sort(
        key=lambda s: -s.percent_used
        if s.limit.direction == models.LimitDirection.ceiling
        else s.percent_used
    )
    return statuses


def card_category_breakdown(
    db: Session,
    card: models.Card,
    on: Optional[date] = None,
) -> tuple[date, date, List[CardCategoryStatus]]:
    """
    Where this card's spending went over the current cycle.

    Useful before any limit exists, which is why it is a separate read: a card
    with categories but no caps still answers "what did I put on this card this
    cycle".
    """
    on = on or datetime.now(timezone.utc).date()
    start, end = statement_bounds(card, on)
    totals = _card_spend_by_category(db, card, start, end)
    rows = [
        CardCategoryStatus(category=c, spent=_money(totals.get(c.id, Decimal("0"))))
        for c in card.categories
    ]
    rows.sort(key=lambda r: r.spent, reverse=True)
    return start, end, rows
