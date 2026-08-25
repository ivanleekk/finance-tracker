"""
The double-entry ledger: posting balanced entries, and reading balances back.

Everything that moves money goes through `post_entry`, which refuses to write an
entry whose debits and credits disagree. That refusal is the whole point — it is
what makes the ledger's answers trustworthy without every caller remembering to
keep both sides in step.

The chart of accounts is built lazily around the rows the app already has:
`ledger_account_for_financial_account` and `ledger_account_for_category` find or
create the mirror of an existing account or category, so nothing has to be
migrated up front and a household that has never posted an entry costs nothing.
Receivables and payables are the accounts that have no single-entry equivalent,
and `receivable_account` / `payable_account` create them per counterparty name.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Iterable, Optional, Sequence

from sqlalchemy import func
from sqlalchemy.orm import Session

from src import models

#: Entries balance to the cent. Anything larger is a caller bug, not rounding.
BALANCE_TOLERANCE = Decimal("0.005")


class UnbalancedEntry(ValueError):
    """Raised when a proposed entry's debits and credits disagree."""


def _dec(value) -> Decimal:
    if value is None:
        return Decimal("0")
    return value if isinstance(value, Decimal) else Decimal(str(value))


@dataclass(frozen=True)
class LineSpec:
    """
    One side of a proposed entry. `debit` and `credit` are in the household's base
    currency; pass exactly one of them.
    """

    ledger_account_id: uuid.UUID
    debit: Decimal = Decimal("0")
    credit: Decimal = Decimal("0")
    native_amount: Optional[Decimal] = None
    native_currency: Optional[str] = None
    exchange_rate: Optional[float] = None
    memo: Optional[str] = None


def debit(account_id: uuid.UUID, amount, **kwargs) -> LineSpec:
    return LineSpec(ledger_account_id=account_id, debit=_dec(amount), **kwargs)


def credit(account_id: uuid.UUID, amount, **kwargs) -> LineSpec:
    return LineSpec(ledger_account_id=account_id, credit=_dec(amount), **kwargs)


# ---------------------------------------------------------------------------
# Chart of accounts
# ---------------------------------------------------------------------------


def _get_or_create(
    db: Session,
    *,
    household_id: uuid.UUID,
    name: str,
    type: models.LedgerAccountType,
    role: models.LedgerAccountRole,
    financial_account_id: Optional[uuid.UUID] = None,
    category_id: Optional[uuid.UUID] = None,
    counterparty_name: Optional[str] = None,
    owner_user_id: Optional[uuid.UUID] = None,
) -> models.LedgerAccount:
    query = db.query(models.LedgerAccount).filter(
        models.LedgerAccount.household_id == household_id,
        models.LedgerAccount.role == role,
    )
    if financial_account_id is not None:
        query = query.filter(models.LedgerAccount.financial_account_id == financial_account_id)
    elif category_id is not None:
        query = query.filter(models.LedgerAccount.category_id == category_id)
    else:
        query = query.filter(
            models.LedgerAccount.counterparty_name == counterparty_name,
            models.LedgerAccount.owner_user_id == owner_user_id,
        )

    existing = query.first()
    if existing is not None:
        return existing

    account = models.LedgerAccount(
        household_id=household_id,
        name=name,
        type=type,
        role=role,
        financial_account_id=financial_account_id,
        category_id=category_id,
        counterparty_name=counterparty_name,
        owner_user_id=owner_user_id,
    )
    db.add(account)
    db.flush()
    return account


def ledger_account_for_financial_account(
    db: Session, account: models.FinancialAccount
) -> models.LedgerAccount:
    """
    The chart account mirroring a real bank/loan/property account.

    A liability account is credit-normal here, which is why the ledger reports a
    loan as a negative contribution to net worth without anyone negating it by
    hand — the sign is in the account type rather than in the reading code.
    """
    is_liability = account.kind == models.AccountKind.liability
    return _get_or_create(
        db,
        household_id=account.household_id,
        name=account.name,
        type=models.LedgerAccountType.liability if is_liability else models.LedgerAccountType.asset,
        role=models.LedgerAccountRole.cash,
        financial_account_id=account.id,
        owner_user_id=account.owner_user_id,
    )


def ledger_account_for_category(db: Session, category: models.Category) -> models.LedgerAccount:
    """The chart account mirroring a budget category."""
    is_income = str(category.type) == "income" or getattr(category.type, "value", None) == "income"
    return _get_or_create(
        db,
        household_id=category.household_id,
        name=category.name,
        type=models.LedgerAccountType.income if is_income else models.LedgerAccountType.expense,
        role=models.LedgerAccountRole.category,
        category_id=category.id,
    )


def receivable_account(
    db: Session,
    household_id: uuid.UUID,
    counterparty_name: str,
    owner_user_id: Optional[uuid.UUID] = None,
) -> models.LedgerAccount:
    """Money `counterparty_name` owes the household: an asset."""
    return _get_or_create(
        db,
        household_id=household_id,
        name=f"Owed by {counterparty_name}",
        type=models.LedgerAccountType.asset,
        role=models.LedgerAccountRole.receivable,
        counterparty_name=counterparty_name,
        owner_user_id=owner_user_id,
    )


def payable_account(
    db: Session,
    household_id: uuid.UUID,
    counterparty_name: str,
    owner_user_id: Optional[uuid.UUID] = None,
) -> models.LedgerAccount:
    """Money the household owes `counterparty_name`: a liability."""
    return _get_or_create(
        db,
        household_id=household_id,
        name=f"Owed to {counterparty_name}",
        type=models.LedgerAccountType.liability,
        role=models.LedgerAccountRole.payable,
        counterparty_name=counterparty_name,
        owner_user_id=owner_user_id,
    )


def equity_account(
    db: Session, household_id: uuid.UUID, role: models.LedgerAccountRole
) -> models.LedgerAccount:
    """
    The equity plug a one-sided fact lands in.

    An opening balance and a manual reconciliation both assert "this account holds
    X" without saying where the money came from. Single-entry could just set the
    number; a ledger has to put the other side somewhere, and equity is where the
    unexplained belongs. Keeping them in their own accounts means a reconciliation
    is visible as a reconciliation rather than hidden inside real spending.
    """
    names = {
        models.LedgerAccountRole.opening_balance: "Opening balances",
        models.LedgerAccountRole.adjustment: "Balance adjustments",
    }
    return _get_or_create(
        db,
        household_id=household_id,
        name=names[role],
        type=models.LedgerAccountType.equity,
        role=role,
    )


# ---------------------------------------------------------------------------
# Posting
# ---------------------------------------------------------------------------


def post_entry(
    db: Session,
    *,
    household_id: uuid.UUID,
    date: datetime,
    lines: Sequence[LineSpec],
    description: Optional[str] = None,
    source: models.JournalSource = models.JournalSource.manual,
    source_id: Optional[uuid.UUID] = None,
) -> models.JournalEntry:
    """
    Write one balanced entry.

    Replaces any entry already posted for the same `(source, source_id)`, which is
    what makes editing a transaction safe: the old entry goes and the corrected one
    takes its place, rather than the two accumulating. It is also what lets the
    backfill be re-run over a household that is already partly migrated.
    """
    if len(lines) < 2:
        raise UnbalancedEntry("An entry needs at least two lines.")

    total_debit = sum((_dec(line.debit) for line in lines), Decimal("0"))
    total_credit = sum((_dec(line.credit) for line in lines), Decimal("0"))

    for line in lines:
        if _dec(line.debit) < 0 or _dec(line.credit) < 0:
            raise UnbalancedEntry("A line's debit and credit must both be non-negative.")
        if _dec(line.debit) > 0 and _dec(line.credit) > 0:
            raise UnbalancedEntry("A line is either a debit or a credit, never both.")

    if abs(total_debit - total_credit) > BALANCE_TOLERANCE:
        raise UnbalancedEntry(
            f"Debits ({total_debit}) do not equal credits ({total_credit})."
        )

    if source_id is not None:
        existing = (
            db.query(models.JournalEntry)
            .filter(
                models.JournalEntry.source == source,
                models.JournalEntry.source_id == source_id,
            )
            .first()
        )
        if existing is not None:
            db.delete(existing)
            db.flush()

    entry = models.JournalEntry(
        household_id=household_id,
        date=date,
        description=description,
        source=source,
        source_id=source_id,
    )
    db.add(entry)
    db.flush()

    for line in lines:
        db.add(
            models.JournalLine(
                entry_id=entry.id,
                ledger_account_id=line.ledger_account_id,
                debit=_dec(line.debit),
                credit=_dec(line.credit),
                native_amount=line.native_amount,
                native_currency=line.native_currency,
                exchange_rate=line.exchange_rate,
                memo=line.memo,
            )
        )
    db.flush()
    return entry


def delete_entry_for(db: Session, source: models.JournalSource, source_id: uuid.UUID) -> None:
    """Drop the entry a now-deleted row had posted, if it had one."""
    entry = (
        db.query(models.JournalEntry)
        .filter(models.JournalEntry.source == source, models.JournalEntry.source_id == source_id)
        .first()
    )
    if entry is not None:
        db.delete(entry)
        db.flush()


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------


def account_balance(
    db: Session,
    ledger_account_id: uuid.UUID,
    start: Optional[date] = None,
    end: Optional[date] = None,
) -> Decimal:
    """
    An account's balance on its own normal side, so the number reads positive when
    the account holds what it is supposed to: cash in the bank, spend in a
    category, debt on a loan.
    """
    account = db.query(models.LedgerAccount).filter(models.LedgerAccount.id == ledger_account_id).first()
    if account is None:
        return Decimal("0")

    query = (
        db.query(
            func.coalesce(func.sum(models.JournalLine.debit), 0),
            func.coalesce(func.sum(models.JournalLine.credit), 0),
        )
        .join(models.JournalEntry, models.JournalLine.entry_id == models.JournalEntry.id)
        .filter(models.JournalLine.ledger_account_id == ledger_account_id)
    )
    query = _restrict_dates(query, start, end)
    debits, credits = query.one()
    net = _dec(debits) - _dec(credits)
    return net if account.is_debit_normal else -net


def category_movement(
    db: Session,
    household_id: uuid.UUID,
    start: date,
    end: date,
    category_ids: Optional[Iterable[uuid.UUID]] = None,
) -> dict[uuid.UUID, Decimal]:
    """
    Net movement per *category* over a window, keyed by `Category.id`.

    Net, not gross, is the point: a refund credits the category it came from, so
    it reduces the spend the budget sees instead of arriving as income. Money paid
    on someone else's behalf never debits a category at all — it debits their
    receivable — so it is absent here rather than subtracted.
    """
    query = (
        db.query(
            models.LedgerAccount.category_id,
            func.coalesce(func.sum(models.JournalLine.debit), 0),
            func.coalesce(func.sum(models.JournalLine.credit), 0),
        )
        .join(models.JournalLine, models.JournalLine.ledger_account_id == models.LedgerAccount.id)
        .join(models.JournalEntry, models.JournalLine.entry_id == models.JournalEntry.id)
        .filter(
            models.LedgerAccount.household_id == household_id,
            models.LedgerAccount.role == models.LedgerAccountRole.category,
            models.LedgerAccount.category_id.isnot(None),
        )
    )
    if category_ids is not None:
        ids = list(category_ids)
        if not ids:
            return {}
        query = query.filter(models.LedgerAccount.category_id.in_(ids))
    query = _restrict_dates(query, start, end)

    totals: dict[uuid.UUID, Decimal] = {}
    for category_id, debits, credits in query.group_by(models.LedgerAccount.category_id).all():
        totals[category_id] = _dec(debits) - _dec(credits)
    return totals


def _restrict_dates(query, start: Optional[date], end: Optional[date]):
    if start is not None:
        query = query.filter(
            models.JournalEntry.date
            >= datetime.combine(start, datetime.min.time()).replace(tzinfo=timezone.utc)
        )
    if end is not None:
        # `end` is inclusive, and entries carry a time of day.
        query = query.filter(
            models.JournalEntry.date
            < datetime.combine(end, datetime.max.time()).replace(tzinfo=timezone.utc)
        )
    return query


def trial_balance(db: Session, household_id: uuid.UUID) -> tuple[Decimal, Decimal]:
    """
    Total debits and total credits across a household's whole ledger. Equal, always
    — it is the invariant `post_entry` enforces, checked from the other end.
    """
    debits, credits = (
        db.query(
            func.coalesce(func.sum(models.JournalLine.debit), 0),
            func.coalesce(func.sum(models.JournalLine.credit), 0),
        )
        .join(models.JournalEntry, models.JournalLine.entry_id == models.JournalEntry.id)
        .filter(models.JournalEntry.household_id == household_id)
        .one()
    )
    return _dec(debits), _dec(credits)
