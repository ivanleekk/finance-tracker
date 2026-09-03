"""
Repair of liability balance chains written before the sign fix.

`sync_transaction_to_balances` used to push a *cash-flow* delta into every
account regardless of kind, so on a liability — whose balance is the amount
outstanding, stored positive — every charge subtracted instead of adding. A card
charged to $100 was stored as -100, and since every net-worth reader subtracts a
liability, spending made the household richer.

Fixing the write path leaves the rows already on disk wrong. This rebuilds them,
and the two things it will not do are the point:

*   **It refuses anything it cannot explain.** Every write that reached the chain
    also left a `Transaction` row (transfers and trades included; the only
    exception is the reconciliation `add_account_balance` books, which calls
    `propagate_balance_change` directly with a delta already in the account's own
    convention — so those are excluded here). That makes the chain checkable: the
    gap between two adjacent rows must equal the transactions between them. An
    account whose gaps match the *negated* impacts is broken and is repaired; one
    whose gaps already match is skipped; anything else is reported and left
    alone rather than guessed at.
*   **It is safe to run twice.** Idempotency comes from that same check rather
    than from a marker — a repaired account reads as already-correct on the next
    pass, so a second run is a no-op.

The correction itself is exact. A manual checkpoint stops propagation, so the
chain is a series of independent segments; within one, every transaction reached
every later row, and the stored value is the true value less twice the impact.
The opening figure cancels out of that subtraction, so nothing has to be guessed
about where the account started.
"""

from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass, field
from datetime import date as Date
from decimal import Decimal
from typing import Optional
import uuid

from sqlalchemy.orm import Session

from src import models
from src.services.market_data import fetch_and_cache_exchange_rates_range

# Half a cent. Balances are Numeric and impacts are products of Numerics, so the
# arithmetic is exact; this only absorbs the rounding a stored rate introduces.
TOLERANCE = Decimal("0.005")

BROKEN = "broken"
ALREADY_CORRECT = "already_correct"
NOTHING_TO_CHECK = "nothing_to_check"
UNRECOGNISED = "unrecognised"


@dataclass
class AccountRef:
    """
    The few account columns this repair needs, read explicitly.

    Loading `models.FinancialAccount` whole would select every column the ORM
    knows about, and the script has to run against databases *behind* the code —
    a production instance that has not taken this branch's migrations has no
    `is_archived`, and the query would die on a column the repair never uses.
    """

    id: uuid.UUID
    household_id: uuid.UUID
    name: str
    currency: str
    base_currency: str


@dataclass
class RowFix:
    balance_id: uuid.UUID
    on: Date
    old: Decimal
    new: Decimal

    @property
    def delta(self) -> Decimal:
        return self.new - self.old


@dataclass
class AccountPlan:
    account_id: uuid.UUID
    name: str
    currency: str
    verdict: str
    fixes: list[RowFix] = field(default_factory=list)
    note: Optional[str] = None

    @property
    def net_worth_delta(self) -> Decimal:
        """
        What repairing this account does to net worth, in the account's own
        currency: a liability is subtracted, so raising the balance lowers it.
        """
        return -self.fixes[-1].delta if self.fixes else Decimal("0")


def _dec(value) -> Decimal:
    return value if isinstance(value, Decimal) else Decimal(str(value or 0))


def _owed_impact(transaction) -> Decimal:
    """
    What this transaction does to the amount owed, in the account's own currency.

    `create_transaction` computes the same figure in cash-flow terms — negative
    when money left — and the fixed `sync_transaction_to_balances` flips it for a
    liability. Working in the owed convention here means a charge simply reads
    as +100, the direction the repaired row must move.
    """
    amount = _dec(transaction.amount) * _dec(transaction.exchange_rate or 1)
    kind = transaction.transaction_type
    is_income = getattr(kind, "value", kind) == models.TransactionType.income.value
    return -amount if is_income else amount


def _relevant_transactions(db: Session, account_id: uuid.UUID) -> list:
    """
    Every transaction that pushed a delta through `sync_transaction_to_balances`.

    Reconciliations are excluded: `add_account_balance` books the row but moves
    the chain itself, with a delta already in the account's own convention, so it
    was never mis-signed and counting it here would invent an error.
    """
    adjustment_ids = [
        row[0]
        for row in db.query(models.Category.id)
        .filter(models.Category.name == models.SYSTEM_CATEGORY_BALANCE_ADJUSTMENT)
        .all()
    ]
    query = db.query(
        models.Transaction.date,
        models.Transaction.amount,
        models.Transaction.exchange_rate,
        models.Transaction.transaction_type,
    ).filter(models.Transaction.account_id == account_id)
    if adjustment_ids:
        query = query.filter(
            (models.Transaction.category_id.is_(None))
            | (models.Transaction.category_id.notin_(adjustment_ids))
        )
    return sorted(query.all(), key=lambda t: t.date)


def plan_account(db: Session, account: AccountRef) -> AccountPlan:
    """Work out what this account's chain should say, without writing anything."""
    plan = AccountPlan(
        account_id=account.id,
        name=account.name,
        currency=account.currency or "USD",
        verdict=NOTHING_TO_CHECK,
    )

    balances = (
        db.query(models.AccountBalance)
        .filter(models.AccountBalance.account_id == account.id)
        .order_by(models.AccountBalance.date)
        .all()
    )
    if not balances:
        plan.note = "no balance history"
        return plan

    transactions = _relevant_transactions(db, account.id)
    if not transactions:
        plan.note = "no transactions reached this chain"
        return plan

    # A manual checkpoint stops propagation, so it starts a new segment. A
    # transaction dated *on* a checkpoint still moved it (the sync updates that
    # day's row directly, whatever its flag), which is why the boundary is
    # inclusive on the left.
    anchors = sorted(b.date for b in balances if b.is_manual)

    def segment(on: Date) -> int:
        return bisect_right(anchors, on) - 1

    impacts: dict[Date, Decimal] = {}
    for transaction in transactions:
        on = transaction.date.date() if hasattr(transaction.date, "date") else transaction.date
        impacts[on] = impacts.get(on, Decimal("0")) + _owed_impact(transaction)

    # Running impact per segment, so a row's correction is a lookup rather than a
    # rescan of the whole history.
    cumulative: dict[Date, Decimal] = {}
    running: dict[int, Decimal] = {}
    for on in sorted(impacts):
        seg = segment(on)
        running[seg] = running.get(seg, Decimal("0")) + impacts[on]
        cumulative[on] = running[seg]

    def impact_through(on: Date, seg: int) -> Decimal:
        """Impacts in `seg` dated on or before `on`."""
        dates = sorted(d for d in cumulative if segment(d) == seg and d <= on)
        return cumulative[dates[-1]] if dates else Decimal("0")

    # Does the chain move the way the transactions say, or the opposite way? A
    # charge must raise the balance; the old code lowered it.
    agrees = disagrees = 0

    # The commonest shape in practice has no step to compare at all: a card that
    # was never given an opening balance has one row per spending day, the first
    # of them created by the transaction itself. `sync_transaction_to_balances`
    # starts such a row from zero, so that row *is* the running total, and it
    # settles the question on its own. A non-zero opening balance simply fails
    # both comparisons and is left to the steps below to judge.
    first = balances[0]
    if not first.is_manual:
        through = impact_through(first.date, segment(first.date))
        if abs(through) > TOLERANCE:
            stored = _dec(first.balance)
            if abs(stored - through) <= TOLERANCE:
                agrees += 1
            elif abs(stored + through) <= TOLERANCE:
                disagrees += 1
    for previous, current in zip(balances, balances[1:]):
        seg = segment(current.date)
        if segment(previous.date) != seg:
            continue  # a checkpoint resets the chain; the gap means nothing
        expected = impact_through(current.date, seg) - impact_through(previous.date, seg)
        if abs(expected) <= TOLERANCE:
            continue
        observed = _dec(current.balance) - _dec(previous.balance)
        if abs(observed - expected) <= TOLERANCE:
            agrees += 1
        elif abs(observed + expected) <= TOLERANCE:
            disagrees += 1
        else:
            plan.verdict = UNRECOGNISED
            plan.note = (
                f"the step to {current.date} moved {observed}, but its transactions "
                f"total {expected} — repaired by hand, or edited outside the app"
            )
            return plan

    if disagrees and agrees:
        plan.verdict = UNRECOGNISED
        plan.note = f"{disagrees} steps carry the old sign and {agrees} the new one"
        return plan
    if not disagrees:
        plan.verdict = ALREADY_CORRECT if agrees else NOTHING_TO_CHECK
        if not agrees:
            plan.note = "no step is large enough to tell either way"
        return plan

    plan.verdict = BROKEN
    for balance in balances:
        seg = segment(balance.date)
        # Stored is the true figure less twice the movement: the opening value
        # cancels, so nothing has to be assumed about where the account started.
        correction = 2 * impact_through(balance.date, seg)
        if abs(correction) <= TOLERANCE:
            continue
        old = _dec(balance.balance)
        plan.fixes.append(RowFix(balance.id, balance.date, old, old + correction))
    return plan


def apply_plan(db: Session, account: AccountRef, plan: AccountPlan) -> None:
    """Write a `BROKEN` plan's rows back, home-currency equivalents included."""
    if plan.verdict != BROKEN or not plan.fixes:
        return

    acc_curr = account.currency or "USD"
    home_curr = account.base_currency or "USD"
    rates = fetch_and_cache_exchange_rates_range(
        db, acc_curr, home_curr, plan.fixes[0].on, plan.fixes[-1].on
    )

    by_id = {fix.balance_id: fix for fix in plan.fixes}
    rows = (
        db.query(models.AccountBalance)
        .filter(models.AccountBalance.id.in_(list(by_id)))
        .all()
    )
    for row in rows:
        fix = by_id[row.id]
        row.balance = fix.new
        rate = rates.get((row.date, acc_curr, home_curr), 1.0)
        row.balance_home_currency = float(fix.new) * rate


def liability_accounts(
    db: Session,
    *,
    household_id: Optional[uuid.UUID] = None,
    account_id: Optional[uuid.UUID] = None,
) -> list[AccountRef]:
    query = (
        db.query(
            models.FinancialAccount.id,
            models.FinancialAccount.household_id,
            models.FinancialAccount.name,
            models.FinancialAccount.currency,
            models.Household.base_currency,
        )
        .join(models.Household, models.Household.id == models.FinancialAccount.household_id)
        .filter(models.FinancialAccount.kind == models.AccountKind.liability)
    )
    if household_id:
        query = query.filter(models.FinancialAccount.household_id == household_id)
    if account_id:
        query = query.filter(models.FinancialAccount.id == account_id)
    return [
        AccountRef(
            id=row[0],
            household_id=row[1],
            name=row[2],
            currency=row[3] or "USD",
            base_currency=row[4] or "USD",
        )
        for row in query.order_by(models.FinancialAccount.name).all()
    ]
