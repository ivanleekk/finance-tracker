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
from typing import Optional
import uuid

from sqlalchemy.orm import Session

from src import models
from src.services.account_service import sync_transaction_to_balances
from src.services.market_data import fetch_and_cache_exchange_rates


def create_transaction(
    db: Session,
    *,
    account: models.FinancialAccount,
    category: models.Category,
    date: datetime,
    amount: Decimal,
    currency: Optional[str] = None,
    exchange_rate: Optional[float] = None,
    description: Optional[str] = None,
    recurring_transaction_id: Optional[uuid.UUID] = None,
) -> models.Transaction:
    """
    Create a transaction and sync it into the account's balance chain.

    ``amount`` is a positive magnitude — the income/expense direction is taken
    from the category, matching ``TransactionBase``. The caller is responsible
    for access checks and for committing.
    """
    acc_currency = account.currency or "USD"
    txn_currency = currency or acc_currency

    rate = exchange_rate
    if not rate:
        rate = fetch_and_cache_exchange_rates(db, txn_currency, acc_currency, date.date())

    home_currency = account.household.base_currency or "USD"
    rate_to_home = fetch_and_cache_exchange_rates(db, txn_currency, home_currency, date.date())

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
    )
    db.add(db_transaction)

    # Push the signed impact, in the account's own currency, into the chain.
    amount_in_account = amount * Decimal(str(rate))
    is_income = category.type == models.TransactionType.income.value
    delta = amount_in_account if is_income else -amount_in_account
    sync_transaction_to_balances(db, account.id, date.date(), delta)

    return db_transaction
