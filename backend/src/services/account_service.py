from sqlalchemy.orm import Session
from sqlalchemy import desc
from decimal import Decimal
from datetime import date
import uuid
from src import models

def propagate_balance_change(db: Session, account_id: uuid.UUID, start_date: date, amount_delta: Decimal):
    """
    Propagates a balance change forward until hitting a manual checkpoint.
    """
    if amount_delta == 0:
        return

    subsequent_balances = db.query(models.AccountBalance).filter(
        models.AccountBalance.account_id == account_id,
        models.AccountBalance.date > start_date
    ).order_by(models.AccountBalance.date).all()

    for bal in subsequent_balances:
        if bal.is_manual:
            break # Stop at manual checkpoints
        bal.balance += amount_delta

def sync_transaction_to_balances(db: Session, account_id: uuid.UUID, trans_date: date, amount_delta: Decimal):
    """
    Synchronizes a transaction's effect to the account_balances table.
    """
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

    # 3. Propagate forward through automated balances
    propagate_balance_change(db, account_id, trans_date, amount_delta)
