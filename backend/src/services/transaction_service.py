"""
The one place a Transaction row is created.

Posting a transaction is three coupled steps — convert to the account currency,
convert to the household base currency, and push the delta into the balance
chain. Getting any of them wrong silently corrupts net worth, so the recurring
engine must not reimplement them; it calls the same helper the manual
``POST /cashflow/transactions`` endpoint does.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Optional, Sequence
import uuid

from sqlalchemy.orm import Session

from src import models
from src.services import ledger_service
from src.services.account_service import sync_transaction_to_balances
from src.services.money import dec, money
from src.services.market_data import (
    ExchangeRateUnavailable,
    fetch_and_cache_exchange_rates,
)


def resolve_rates(
    db: Session,
    *,
    account: models.FinancialAccount,
    date: datetime,
    amount: Decimal,
    currency: Optional[str] = None,
    exchange_rate: Optional[float] = None,
    amount_charged: Optional[Decimal] = None,
) -> tuple[str, float, float]:
    """
    The two rates a transaction needs, derived once so create and edit agree.

    Returns ``(currency, rate_to_account, rate_to_home)``.

    Three ways to get the account rate, in order of how much the caller knows:

    1. ``amount_charged`` — what the account was actually charged, in its own
       currency. This is the best answer when the user has it, because the card
       spread is already inside it: the rate is ``charged / amount``, exactly
       the rate the statement implies, and no lookup happens at all. It is not
       stored, because ``amount * exchange_rate`` reproduces it.
    2. ``exchange_rate`` — an explicit rate the caller worked out.
    3. The spot close for the transaction's own date, nearest preceding for
       weekends and holidays. Strict: a pair that cannot be resolved raises
       rather than quietly becoming 1.0.

    The home rate is composed *through* the account rather than looked up
    independently. That keeps ``amount_home_currency`` consistent with what the
    balance chain was moved by — two independent lookups can disagree — and it
    is what carries a user-supplied rate, spread and all, into every rollup
    instead of discarding it in favour of the mid-market close.
    """
    acc_currency = account.currency or "USD"
    home_currency = account.household.base_currency or "USD"
    txn_currency = currency or acc_currency

    if amount_charged is not None and amount > 0:
        rate = float(Decimal(str(amount_charged)) / Decimal(str(amount)))
    elif exchange_rate:
        rate = float(exchange_rate)
    else:
        rate = fetch_and_cache_exchange_rates(
            db, txn_currency, acc_currency, date.date(), strict=True
        )

    acc_to_home = fetch_and_cache_exchange_rates(
        db, acc_currency, home_currency, date.date(), strict=True
    )
    return txn_currency, rate, rate * acc_to_home


def fee_category(db: Session, household_id: uuid.UUID) -> models.Category:
    """
    The household's "Card Fees" category, created on first use.

    Deliberately *not* in ``SYSTEM_CATEGORY_NAMES``: unlike a transfer or a
    settlement, a surcharge is money genuinely gone, so the burn rate has to
    count it. It is its own category rather than part of the purchase's so that
    "what did fees cost me this year" is answerable at all, which is the reason
    to record one.
    """
    category = (
        db.query(models.Category)
        .filter(
            models.Category.household_id == household_id,
            models.Category.name == models.SYSTEM_CATEGORY_FEE,
        )
        .first()
    )
    if category is None:
        category = models.Category(
            id=uuid.uuid7(),
            household_id=household_id,
            name=models.SYSTEM_CATEGORY_FEE,
            type="expense",
        )
        db.add(category)
        db.flush()
    return category


def fee_amount(amount: Decimal, rate: float, fee_percent: Optional[Decimal]) -> Decimal:
    """
    What a surcharge comes to, in the account's own currency, rounded to cents.

    Charged on the converted purchase rather than on the foreign figure, because
    that is what the card does: the fee is a percentage of what it billed you.
    """
    if not fee_percent or fee_percent <= 0:
        return Decimal("0")
    return money(dec(amount) * Decimal(str(rate)) * dec(fee_percent) / Decimal("100"))


def sync_fee_transaction(
    db: Session,
    purchase: models.Transaction,
    account: models.FinancialAccount,
) -> Optional[models.Transaction]:
    """
    Create, reprice or remove the fee row a purchase's ``fee_percent`` implies.

    The fee is a **separate transaction**, not a column folded into the
    purchase, and that is the load-bearing decision here.
    ``amount * exchange_rate`` means "what left the account" to the balance
    chain, to ``card_service``, and to the amount every client prints next to a
    row; a fee hidden inside either factor would silently redefine all of them,
    and a fee left outside them would make the balance wrong. A row of its own
    keeps every reader correct with no reader changed — and it is what the
    statement shows, since the card posts the surcharge separately too.

    Idempotent: called on create and on every edit, it converges the companion
    on what the purchase now says. Returns the fee row, or None if there is
    no fee (having deleted any it used to have).
    """
    existing = (
        db.query(models.Transaction)
        .filter(models.Transaction.fee_for_transaction_id == purchase.id)
        .first()
    )
    charge = fee_amount(purchase.amount, purchase.exchange_rate or 1.0, purchase.fee_percent)

    if charge <= 0:
        if existing is not None:
            _reverse_fee(db, existing)
        return None

    home_rate = Decimal("0")
    if purchase.amount and purchase.amount_home_currency is not None and purchase.exchange_rate:
        # The purchase already knows what one unit of the account's currency is
        # worth at home: its own two figures divided. Re-deriving it from a
        # fresh lookup could disagree with the row the fee belongs to.
        account_value = dec(purchase.amount) * Decimal(str(purchase.exchange_rate))
        if account_value > 0:
            home_rate = dec(purchase.amount_home_currency) / account_value

    category = fee_category(db, account.household_id)
    if existing is not None:
        _reverse_fee(db, existing)

    fee = models.Transaction(
        id=uuid.uuid7(),
        account_id=purchase.account_id,
        category_id=category.id,
        date=purchase.date,
        amount=charge,
        amount_home_currency=money(charge * home_rate) if home_rate else charge,
        # Denominated in the account's own currency: the card charges its fee in
        # what it settles in, not in what the merchant billed.
        currency=account.currency or "USD",
        exchange_rate=1.0,
        description=f"{purchase.fee_percent}% fee",
        transaction_type=models.TransactionType.expense.value,
        fee_for_transaction_id=purchase.id,
        # The same card category as the purchase, so a metered card sees the fee
        # against the same cap the spend it came from counts towards.
        card_category_id=purchase.card_category_id,
    )
    db.add(fee)
    sync_transaction_to_balances(db, account.id, purchase.date.date(), -charge)
    db.flush()
    ledger_service.post_transaction(db, fee, owner_user_id=account.owner_user_id)
    return fee


def _reverse_fee(db: Session, fee: models.Transaction) -> None:
    """Undo a fee row completely: its balance impact, its entry, then the row."""
    sync_transaction_to_balances(
        db, fee.account_id, fee.date.date(), dec(fee.amount) * Decimal(str(fee.exchange_rate or 1.0))
    )
    ledger_service.delete_entry_for(db, models.JournalSource.transaction, fee.id)
    db.delete(fee)
    db.flush()


def create_transaction(
    db: Session,
    *,
    account: models.FinancialAccount,
    category: models.Category,
    date: datetime,
    amount: Decimal,
    currency: Optional[str] = None,
    exchange_rate: Optional[float] = None,
    # What the account was actually charged, in its own currency. Defines the
    # rate when given, spread included — see `resolve_rates`.
    amount_charged: Optional[Decimal] = None,
    # What the card added on top, as a percentage. Posted as its own linked row.
    fee_percent: Optional[Decimal] = None,
    description: Optional[str] = None,
    recurring_transaction_id: Optional[uuid.UUID] = None,
    splits: Sequence[tuple[models.Counterparty, Decimal]] = (),
    owner_user_id: Optional[uuid.UUID] = None,
    mcc: Optional[str] = None,
    card_category_id: Optional[uuid.UUID] = None,
) -> models.Transaction:
    """
    Create a transaction and sync it into the account's balance chain.

    ``amount`` is a positive magnitude — the income/expense direction is taken
    from the category, matching ``TransactionBase``. The caller is responsible
    for access checks and for committing.

    ``splits`` records that part of this expense was one or more other people's:
    the full amount still leaves the account, because it did, but only the
    remainder counts as the household's own spending. The split lives in the
    ledger entry rather than in a column, so the two sides can never disagree —
    it is the same entry that puts each share on its counterparty's receivable.
    """
    txn_currency, rate, rate_to_home = resolve_rates(
        db,
        account=account,
        date=date,
        amount=amount,
        currency=currency,
        exchange_rate=exchange_rate,
        amount_charged=amount_charged,
    )

    db_transaction = models.Transaction(
        id=uuid.uuid7(),
        account_id=account.id,
        category_id=category.id,
        date=date,
        amount=amount,
        amount_home_currency=amount * Decimal(str(rate_to_home)),
        currency=txn_currency,
        exchange_rate=rate,
        description=description,
        transaction_type=category.type,  # direction comes from the category
        recurring_transaction_id=recurring_transaction_id,
        mcc=mcc,
        card_category_id=card_category_id,
        fee_percent=fee_percent,
    )
    db.add(db_transaction)

    # Push the signed impact, in the account's own currency, into the chain.
    amount_in_account = amount * Decimal(str(rate))
    is_income = category.type == models.TransactionType.income.value
    delta = amount_in_account if is_income else -amount_in_account
    sync_transaction_to_balances(db, account.id, date.date(), delta)

    # The ledger needs the relationships resolved, and `post_entry` looks for an
    # entry already posted against this row's id.
    db.flush()
    ledger_service.post_transaction(
        db,
        db_transaction,
        splits=splits,
        owner_user_id=owner_user_id,
    )

    # A surcharge is a second row, posted after the purchase it belongs to so it
    # can read the rate that purchase settled at.
    sync_fee_transaction(db, db_transaction, account)

    return db_transaction
