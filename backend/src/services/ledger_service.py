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
and `receivable_account` / `payable_account` create them per Counterparty.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Iterable, Optional, Sequence

from sqlalchemy import func
from sqlalchemy.orm import Session

from src import models

#: Entries balance to the cent. Anything larger is a caller bug, not rounding.
BALANCE_TOLERANCE = Decimal("0.005")

CENTS = Decimal("0.01")


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
    counterparty_id: Optional[uuid.UUID] = None,
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
            models.LedgerAccount.counterparty_id == counterparty_id,
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
        counterparty_id=counterparty_id,
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
    counterparty: models.Counterparty,
    owner_user_id: Optional[uuid.UUID] = None,
) -> models.LedgerAccount:
    """Money `counterparty` owes the household: an asset."""
    return _get_or_create(
        db,
        household_id=household_id,
        name=f"Owed by {counterparty.name}",
        type=models.LedgerAccountType.asset,
        role=models.LedgerAccountRole.receivable,
        counterparty_id=counterparty.id,
        owner_user_id=owner_user_id,
    )


def payable_account(
    db: Session,
    household_id: uuid.UUID,
    counterparty: models.Counterparty,
    owner_user_id: Optional[uuid.UUID] = None,
) -> models.LedgerAccount:
    """Money the household owes `counterparty`: a liability."""
    return _get_or_create(
        db,
        household_id=household_id,
        name=f"Owed to {counterparty.name}",
        type=models.LedgerAccountType.liability,
        role=models.LedgerAccountRole.payable,
        counterparty_id=counterparty.id,
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
    signed = net if account.is_debit_normal else -net
    # Quantized because a balance is money a person is shown and acts on: left at
    # full precision, a rounding residue surfaces as an unsettleable fraction of
    # a cent, and the same figure reads differently depending on which endpoint
    # returned it.
    return signed.quantize(CENTS, rounding=ROUND_HALF_UP)


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


# ---------------------------------------------------------------------------
# Posting the app's own rows
# ---------------------------------------------------------------------------


def _home_amount(transaction: models.Transaction) -> Decimal:
    """
    What the transaction was worth in the household's base currency.

    `amount_home_currency` is written by `create_transaction`; falling back to the
    raw amount is only for rows that predate it, and is the same fallback the
    budget rollups use.
    """
    value = transaction.amount_home_currency
    return _dec(value if value is not None else transaction.amount)


def post_transaction(
    db: Session,
    transaction: models.Transaction,
    *,
    splits: Sequence[tuple[models.Counterparty, Decimal]] = (),
    owner_user_id: Optional[uuid.UUID] = None,
) -> Optional[models.JournalEntry]:
    """
    Mirror one transaction into the ledger, optionally splitting part of it onto
    one or more counterparties who owe the household for it.

    The split is the point. Paying the whole restaurant bill moves the whole bill
    out of your account — that is what the balance chain records, and it is true.
    But only your share is *your spending*: the rest is a debt someone owes you,
    so it debits their receivable instead of the category. Budgets then charge you
    for what you ate rather than for what you fronted, without anyone having to
    log a fictional smaller expense and lose the real one. A dinner split three
    ways debits three receivables and your own share, all against one credit to
    the account — `post_entry` was never limited to two-line entries.

    Transfer legs are skipped: a transfer is one event across two rows, and
    `post_transfer` posts it once from the pair.
    """
    if transaction.transfer_id is not None:
        return None

    account = transaction.account
    category = transaction.category
    if account is None or category is None:
        return None

    total = _home_amount(transaction)
    if total <= 0:
        return None

    account_line = ledger_account_for_financial_account(db, account)
    category_line = ledger_account_for_category(db, category)

    # The column is an Enum, but a freshly-built row still holds the plain string
    # `create_transaction` copied off the category. Normalize rather than assume.
    kind = transaction.transaction_type
    is_income = getattr(kind, "value", kind) == models.TransactionType.income.value

    lines: list[LineSpec] = []
    if is_income:
        # Money in: the account gains it, the income category is its source.
        lines = [
            debit(account_line.id, total),
            credit(category_line.id, total),
        ]
    else:
        share = total
        for counterparty, owed_amount in splits:
            owed = min(_dec(owed_amount), share)
            if owed <= 0:
                continue
            share -= owed
            receivable = receivable_account(db, account.household_id, counterparty, owner_user_id)
            lines.append(debit(receivable.id, owed, memo=f"Owed by {counterparty.name}"))
        if share > 0:
            lines.append(debit(category_line.id, share, memo="Your share" if lines else None))
        lines.append(credit(account_line.id, total))

    entry = post_entry(
        db,
        household_id=account.household_id,
        date=transaction.date,
        lines=lines,
        description=transaction.description,
        source=models.JournalSource.transaction,
        source_id=transaction.id,
    )
    # Record what actually moved on the account line, for a foreign-currency account.
    if transaction.currency and transaction.currency != (account.household.base_currency or "USD"):
        for line in entry.lines:
            if line.ledger_account_id == account_line.id:
                line.native_amount = _dec(transaction.amount)
                line.native_currency = transaction.currency
                line.exchange_rate = transaction.exchange_rate
    return entry


def post_transfer(
    db: Session,
    *,
    transfer_id: uuid.UUID,
    withdrawal: models.Transaction,
    deposit: models.Transaction,
) -> models.JournalEntry:
    """
    One entry for both legs of a transfer: the destination gains what the source
    loses, and no category is touched on either side.

    A cross-currency transfer is the case that makes this worth stating. The two
    legs are converted to home currency independently, so they can disagree by a
    rounding cent or by a genuine spread; the difference is not spending, and
    forcing it into a category would put it in a budget. It lands in the
    adjustment equity account instead, where it reads as what it is.
    """
    from_account = withdrawal.account
    to_account = deposit.account

    out = _home_amount(withdrawal)
    into = _home_amount(deposit)

    from_line = ledger_account_for_financial_account(db, from_account)
    to_line = ledger_account_for_financial_account(db, to_account)

    lines = [debit(to_line.id, into), credit(from_line.id, out)]
    drift = out - into
    if abs(drift) > BALANCE_TOLERANCE:
        plug = equity_account(db, from_account.household_id, models.LedgerAccountRole.adjustment)
        if drift > 0:
            lines.append(debit(plug.id, drift, memo="Conversion difference"))
        else:
            lines.append(credit(plug.id, -drift, memo="Conversion difference"))

    return post_entry(
        db,
        household_id=from_account.household_id,
        date=withdrawal.date,
        lines=lines,
        description=withdrawal.description,
        source=models.JournalSource.transfer,
        source_id=transfer_id,
    )


def post_spend_on_your_behalf(
    db: Session,
    *,
    household_id: uuid.UUID,
    category: models.Category,
    counterparty: models.Counterparty,
    amount: Decimal,
    date: datetime,
    description: Optional[str] = None,
    owner_user_id: Optional[uuid.UUID] = None,
) -> models.JournalEntry:
    """
    Someone else paid for something of yours: real spending of yours, and a debt.

    This is the flow single entry had no way to write down. No money left any of
    your accounts, so there is no transaction to log, and logging one against a
    real account would corrupt that account's balance. The ledger has somewhere
    to put it: the category is debited because you did incur the cost, and their
    payable is credited because you now owe them for it.
    """
    amount = _dec(amount)
    if amount <= 0:
        raise ValueError("Amount must be positive.")

    category_line = ledger_account_for_category(db, category)
    payable = payable_account(db, household_id, counterparty, owner_user_id)

    return post_entry(
        db,
        household_id=household_id,
        date=date,
        lines=[
            debit(category_line.id, amount),
            credit(payable.id, amount, memo=f"Owed to {counterparty.name}"),
        ],
        description=description or f"Paid by {counterparty.name}",
        source=models.JournalSource.manual,
    )


# ---------------------------------------------------------------------------
# Reimbursements
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CounterpartyBalance:
    """What one person is owed, or owes, right now."""

    counterparty_id: uuid.UUID
    counterparty_name: str
    role: models.LedgerAccountRole
    ledger_account_id: uuid.UUID
    amount: Decimal
    owner_user_id: Optional[uuid.UUID]


def counterparty_balances(
    db: Session,
    household_id: uuid.UUID,
    user: Optional[models.User] = None,
    include_settled: bool = False,
) -> list[CounterpartyBalance]:
    """
    Outstanding receivables and payables, one row per person per direction.

    A settled person nets to zero and drops out by default: the list is meant to
    answer "who still owes me?", not to be a history.
    """
    accounts = (
        db.query(models.LedgerAccount)
        .filter(
            models.LedgerAccount.household_id == household_id,
            models.LedgerAccount.role.in_(
                [models.LedgerAccountRole.receivable, models.LedgerAccountRole.payable]
            ),
        )
        .all()
    )

    results: list[CounterpartyBalance] = []
    for account in accounts:
        if user is not None and account.owner_user_id not in (None, user.id):
            continue
        balance = account_balance(db, account.id)
        if not include_settled and abs(balance) <= BALANCE_TOLERANCE:
            continue
        counterparty_name = account.counterparty.name if account.counterparty else account.name
        results.append(
            CounterpartyBalance(
                counterparty_id=account.counterparty_id,
                counterparty_name=counterparty_name,
                role=account.role,
                ledger_account_id=account.id,
                amount=balance,
                owner_user_id=account.owner_user_id,
            )
        )
    results.sort(key=lambda row: (row.role.value, row.counterparty_name.lower()))
    return results


def post_settlement(
    db: Session,
    *,
    transaction: models.Transaction,
    counterparty: models.Counterparty,
    role: models.LedgerAccountRole,
    owner_user_id: Optional[uuid.UUID] = None,
) -> models.JournalEntry:
    """
    Money changing hands to clear a debt, not to buy anything.

    The settlement rides on a real transaction because real money really moves,
    and the account balance has to follow it. What it must not do is touch a
    category: the spending was recorded when the bill was paid. That is why the
    transaction is filed under the `Reimbursement` system category and why this
    entry credits the receivable (or debits the payable) instead.

    `owner_user_id` must identify the debt being cleared, not the account the
    repayment happens to move through — those are unrelated. `receivable_account`/
    `payable_account` find-or-create by `(household_id, role, counterparty_id,
    owner_user_id)`, so passing the settling account's own owner here opens a
    second, disconnected ledger account whenever the two owners differ, leaving
    the original debt outstanding instead of clearing it.
    """
    account = transaction.account
    total = _home_amount(transaction)
    account_line = ledger_account_for_financial_account(db, account)

    if role == models.LedgerAccountRole.receivable:
        other = receivable_account(db, account.household_id, counterparty, owner_user_id)
        lines = [debit(account_line.id, total), credit(other.id, total)]
    else:
        other = payable_account(db, account.household_id, counterparty, owner_user_id)
        lines = [debit(other.id, total), credit(account_line.id, total)]

    return post_entry(
        db,
        household_id=account.household_id,
        date=transaction.date,
        lines=lines,
        description=transaction.description,
        source=models.JournalSource.transaction,
        source_id=transaction.id,
    )


# ---------------------------------------------------------------------------
# What the budget rollups need
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SplitLine:
    """One counterparty's share of a split transaction."""

    counterparty_id: uuid.UUID
    counterparty_name: str
    amount: Decimal


def counterparty_split_by_transaction(
    db: Session, transaction_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[SplitLine]]:
    """
    Per transaction, who else's money it was and how much, keyed by transaction id.

    Only transactions that were actually split appear. A transaction with no
    ledger entry — everything logged before the ledger existed — is absent, which
    reads correctly as "none of it was somebody else's" without needing a
    backfill to say so. A transaction split among several people gets one
    `SplitLine` per person: the query already groups by `(source_id,
    counterparty)`, so multiple receivable lines on one entry were always
    readable this way — nothing before this needed more than one.
    """
    ids = list(transaction_ids)
    if not ids:
        return {}

    rows = (
        db.query(
            models.JournalEntry.source_id,
            models.LedgerAccount.counterparty_id,
            models.Counterparty.name,
            func.coalesce(func.sum(models.JournalLine.debit), 0),
        )
        .join(models.JournalLine, models.JournalLine.entry_id == models.JournalEntry.id)
        .join(models.LedgerAccount, models.JournalLine.ledger_account_id == models.LedgerAccount.id)
        .join(models.Counterparty, models.LedgerAccount.counterparty_id == models.Counterparty.id)
        .filter(
            models.JournalEntry.source == models.JournalSource.transaction,
            models.JournalEntry.source_id.in_(ids),
            models.LedgerAccount.role == models.LedgerAccountRole.receivable,
        )
        .group_by(
            models.JournalEntry.source_id,
            models.LedgerAccount.counterparty_id,
            models.Counterparty.name,
        )
        .all()
    )
    result: dict[uuid.UUID, list[SplitLine]] = {}
    for source_id, counterparty_id, name, total in rows:
        amount = _dec(total)
        if amount > 0:
            result.setdefault(source_id, []).append(
                SplitLine(counterparty_id=counterparty_id, counterparty_name=name, amount=amount)
            )
    return result


def ledger_only_category_movement(
    db: Session,
    household_id: uuid.UUID,
    start: date,
    end: date,
    user: Optional[models.User] = None,
) -> dict[uuid.UUID, list[tuple[date, Decimal]]]:
    """
    Category spend that exists only in the ledger, keyed by `Category.id`.

    Restricted to `manual` entries on purpose. Everything the ledger mirrors from
    a `Transaction` is already counted by the transaction rollup, and counting it
    from both sides would double it; a manual entry is by definition one with no
    transaction behind it — today, the "someone else paid for me" case.

    Dated movements rather than totals, because the runway calculation needs to
    know which months actually had spending, not just how much there was.
    """
    query = (
        db.query(
            models.LedgerAccount.category_id,
            models.JournalEntry.date,
            models.JournalLine.debit,
            models.JournalLine.credit,
            models.JournalEntry.id,
        )
        .join(models.JournalLine, models.JournalLine.ledger_account_id == models.LedgerAccount.id)
        .join(models.JournalEntry, models.JournalLine.entry_id == models.JournalEntry.id)
        .filter(
            models.JournalEntry.household_id == household_id,
            models.JournalEntry.source == models.JournalSource.manual,
            models.LedgerAccount.role == models.LedgerAccountRole.category,
            models.LedgerAccount.type == models.LedgerAccountType.expense,
        )
    )
    query = _restrict_dates(query, start, end)
    rows = query.all()
    if not rows:
        return {}

    if user is not None:
        visible = _visible_manual_entry_ids(db, household_id, user)
        rows = [row for row in rows if row[4] in visible]

    movements: dict[uuid.UUID, list[tuple[date, Decimal]]] = {}
    for category_id, entry_date, line_debit, line_credit, _entry_id in rows:
        net = _dec(line_debit) - _dec(line_credit)
        if net == 0:
            continue
        movements.setdefault(category_id, []).append((entry_date.date(), net))
    return movements


def _visible_manual_entry_ids(
    db: Session, household_id: uuid.UUID, user: models.User
) -> set[uuid.UUID]:
    """
    Manual entries the user is allowed to see.

    A ledger-only spend always has a counterparty line — that is what makes it a
    ledger-only spend — so the counterparty account's owner is the entry's owner.
    Anything private to another member is dropped here rather than filtered in a
    client, for the same reason the list endpoints are: the client-side filter is
    not a boundary.
    """
    rows = (
        db.query(models.JournalEntry.id, models.LedgerAccount.owner_user_id)
        .join(models.JournalLine, models.JournalLine.entry_id == models.JournalEntry.id)
        .join(models.LedgerAccount, models.JournalLine.ledger_account_id == models.LedgerAccount.id)
        .filter(
            models.JournalEntry.household_id == household_id,
            models.JournalEntry.source == models.JournalSource.manual,
            models.LedgerAccount.role.in_(
                [models.LedgerAccountRole.receivable, models.LedgerAccountRole.payable]
            ),
        )
        .all()
    )
    hidden = {entry_id for entry_id, owner in rows if owner is not None and owner != user.id}
    return {entry_id for entry_id, _ in rows} - hidden


def post_balance_adjustment(
    db: Session,
    *,
    account: models.FinancialAccount,
    transaction: models.Transaction,
    delta_home: Decimal,
) -> Optional[models.JournalEntry]:
    """
    A manual reconciliation: "this account really holds X", with no explanation.

    The one-sided fact single entry could simply assert. A ledger has to name the
    other side, and equity is where the unexplained belongs — in its own account,
    so a reconciliation stays visible as a reconciliation instead of disappearing
    into whatever category happened to be handy.

    `delta_home` is **signed**: positive when the account turned out to hold more
    than the chain said, negative when less.
    """
    delta = _dec(delta_home)
    if abs(delta) <= BALANCE_TOLERANCE:
        return None

    account_line = ledger_account_for_financial_account(db, account)
    plug = equity_account(db, account.household_id, models.LedgerAccountRole.adjustment)

    if delta > 0:
        lines = [debit(account_line.id, delta), credit(plug.id, delta)]
    else:
        lines = [debit(plug.id, -delta), credit(account_line.id, -delta)]

    return post_entry(
        db,
        household_id=account.household_id,
        date=transaction.date,
        lines=lines,
        description=transaction.description,
        source=models.JournalSource.balance_adjustment,
        source_id=transaction.id,
    )
