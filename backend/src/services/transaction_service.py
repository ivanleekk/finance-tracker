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

    return db_transaction
