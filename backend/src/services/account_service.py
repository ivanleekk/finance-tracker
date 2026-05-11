from sqlalchemy.orm import Session
from sqlalchemy import desc
from decimal import Decimal
from typing import List
from datetime import date
import uuid
from src import models
from src.services.market_data import fetch_and_cache_exchange_rates, fetch_and_cache_exchange_rates_range

def propagate_balance_change(db: Session, account_id: uuid.UUID, start_date: date, amount_delta: Decimal):
    """
    Propagates a balance change forward until hitting a manual checkpoint.
    Includes home currency conversion.
    """
    if not isinstance(amount_delta, Decimal):
        amount_delta = Decimal(str(amount_delta))

    if amount_delta == 0:
        return

    # Get account and household currencies for conversion
    db_account = db.query(models.FinancialAccount).filter(models.FinancialAccount.id == account_id).first()
    if not db_account:
        return
    
    acc_curr = db_account.currency or "USD"
    home_curr = db_account.household.base_currency or "USD"

    subsequent_balances = db.query(models.AccountBalance).filter(
        models.AccountBalance.account_id == account_id,
        models.AccountBalance.date > start_date
    ).order_by(models.AccountBalance.date).all()

    if not subsequent_balances:
        return

    # Fetch rates for the entire range at once for efficiency
    end_date = subsequent_balances[-1].date
    rates_lookup = fetch_and_cache_exchange_rates_range(db, acc_curr, home_curr, start_date, end_date)

    for bal in subsequent_balances:
        if bal.is_manual:
            break # Stop at manual checkpoints
        bal.balance += amount_delta
        
        # Update home currency conversion
        rate = rates_lookup.get((bal.date, acc_curr, home_curr), 1.0)
        bal.balance_home_currency = float(bal.balance) * rate

def sync_transaction_to_balances(db: Session, account_id: uuid.UUID, trans_date: date, amount_delta: Decimal):
    """
    Synchronizes a transaction's effect to the account_balances table.
    Includes home currency conversion.
    """
    if not isinstance(amount_delta, Decimal):
        amount_delta = Decimal(str(amount_delta))

    # Get account and household currencies for conversion
    db_account = db.query(models.FinancialAccount).filter(models.FinancialAccount.id == account_id).first()
    if not db_account:
        return
    
    acc_curr = db_account.currency or "USD"
    home_curr = db_account.household.base_currency or "USD"

    # 1. Find or create AccountBalance for trans_date
    db_balance = db.query(models.AccountBalance).filter(
        models.AccountBalance.account_id == account_id,
        models.AccountBalance.date == trans_date
    ).first()

    if not db_balance:
        # Find the most recent balance BEFORE this date to initialize
        prev_balance = db.query(models.AccountBalance).filter(
            models.AccountBalance.account_id == account_id,
            models.AccountBalance.date < trans_date
        ).order_by(desc(models.AccountBalance.date)).first()
        
        initial_balance = prev_balance.balance if prev_balance else Decimal("0")
        
        db_balance = models.AccountBalance(
            id=uuid.uuid7(),
            account_id=account_id,
            date=trans_date,
            balance=initial_balance,
            is_manual=False
        )
        db.add(db_balance)
        db.flush()

    # 2. Update the balance for this day
    db_balance.balance += amount_delta
    
    # 3. Update home currency conversion for this specific day
    rate = fetch_and_cache_exchange_rates(db, acc_curr, home_curr, trans_date)
    db_balance.balance_home_currency = float(db_balance.balance) * rate

    # 4. Propagate forward through automated balances
    propagate_balance_change(db, account_id, trans_date, amount_delta)
