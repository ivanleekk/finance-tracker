from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from decimal import Decimal
import uuid

from src.database import get_db
from src import schemas, models
from src.auth import get_current_user, verify_household_access, verify_private_owner_visibility
from src.services.account_service import sync_transaction_to_balances
from src.services.market_data import fetch_and_cache_exchange_rates

router = APIRouter(prefix="/cashflow", tags=["Income & Expenses"])

# --- TRANSACTIONS ---

@router.post("/transactions", response_model=schemas.TransactionResponse, status_code=status.HTTP_201_CREATED)
def log_transaction(
    transaction: schemas.TransactionCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_account = db.query(models.FinancialAccount).filter(models.FinancialAccount.id == transaction.account_id).first()
    if not db_account:
        raise HTTPException(status_code=404, detail="Account not found")

    db_category = db.query(models.Category).filter(models.Category.id == transaction.category_id).first()
    if not db_category:
        raise HTTPException(status_code=404, detail="Category not found")

    if db_account.household_id != db_category.household_id:
        raise HTTPException(status_code=400, detail="Account and Category must belong to the same household")

    verify_household_access(db_account.household_id, current_user, db)
    verify_private_owner_visibility(db_account.owner_user_id, current_user)

    # 4. Handle Currency Conversion
    acc_curr = db_account.currency or "USD"
    trans_curr = transaction.currency or acc_curr
    
    rate = transaction.exchange_rate
    if not rate:
        rate = fetch_and_cache_exchange_rates(db, trans_curr, acc_curr, transaction.date.date())

    home_curr = db_account.household.base_currency or "USD"
    rate_to_home = fetch_and_cache_exchange_rates(db, trans_curr, home_curr, transaction.date.date())
    amount_home_currency = transaction.amount * Decimal(str(rate_to_home))

    db_transaction = models.Transaction(
        id=uuid.uuid7(),
        account_id=transaction.account_id,
        category_id=transaction.category_id,
        date=transaction.date,
        amount=transaction.amount,
        amount_home_currency=amount_home_currency,
        currency=trans_curr,
        exchange_rate=rate,
        description=transaction.description,
        transaction_type=db_category.type,  # Infer type from category
    )
    db.add(db_transaction)
    
    # 5. Sync to account balance (Convert to account currency)
    amount_in_acc = transaction.amount * Decimal(str(rate))
    amount_delta = amount_in_acc if db_category.type == models.TransactionType.income.value else -amount_in_acc
    sync_transaction_to_balances(db, transaction.account_id, transaction.date.date(), amount_delta)
    
    db.commit()
    db.refresh(db_transaction)
    return db_transaction

@router.post("/transfers", response_model=List[schemas.TransactionResponse], status_code=status.HTTP_201_CREATED)
def create_transfer(
    transfer: schemas.TransferCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    # 1. Verify access to both accounts
    from_account = db.query(models.FinancialAccount).filter(models.FinancialAccount.id == transfer.from_account_id).first()
    to_account = db.query(models.FinancialAccount).filter(models.FinancialAccount.id == transfer.to_account_id).first()
    
    if not from_account or not to_account:
        raise HTTPException(status_code=404, detail="One or both accounts not found")
    
    verify_household_access(from_account.household_id, current_user, db)
    verify_household_access(to_account.household_id, current_user, db)
    verify_private_owner_visibility(from_account.owner_user_id, current_user)
    verify_private_owner_visibility(to_account.owner_user_id, current_user)

    if from_account.household_id != to_account.household_id:
        raise HTTPException(status_code=400, detail="Transfer must be within the same household")

    if from_account.id == to_account.id:
        raise HTTPException(status_code=400, detail="Cannot transfer to the same account")

    # 2. Find/Create "Transfer" category
    transfer_cat = db.query(models.Category).filter(
        models.Category.household_id == from_account.household_id,
        models.Category.name == "Transfer"
    ).first()
    
    if not transfer_cat:
        transfer_cat = models.Category(
            id=uuid.uuid7(),
            household_id=from_account.household_id,
            name="Transfer",
            type="expense" # Base type for the category table, but we override in transaction
        )
        db.add(transfer_cat)
        db.flush()

    # 3. Handle Cross-Currency Transfer
    from_curr = from_account.currency or "USD"
    to_curr = to_account.currency or "USD"
    home_curr = from_account.household.base_currency or "USD"
    
    rate = 1.0
    if from_curr != to_curr:
        rate = fetch_and_cache_exchange_rates(db, from_curr, to_curr, transfer.date.date())

    rate_from_to_home = fetch_and_cache_exchange_rates(db, from_curr, home_curr, transfer.date.date())
    rate_to_to_home = fetch_and_cache_exchange_rates(db, to_curr, home_curr, transfer.date.date())

    transfer_id = uuid.uuid7()
    
    # Withdrawal from source account (in source currency)
    withdrawal = models.Transaction(
        id=uuid.uuid7(),
        account_id=transfer.from_account_id,
        category_id=transfer_cat.id,
        date=transfer.date,
        amount=transfer.amount,
        amount_home_currency=transfer.amount * Decimal(str(rate_from_to_home)),
        currency=from_curr,
        exchange_rate=1.0, # Source account is the reference
        description=transfer.description or f"Transfer to {to_account.name}",
        transaction_type=models.TransactionType.expense,
        transfer_id=transfer_id
    )
    
    # Deposit to destination account (converted to destination currency)
    deposit_amount = float(transfer.amount) * rate
    deposit = models.Transaction(
        id=uuid.uuid7(),
        account_id=transfer.to_account_id,
        category_id=transfer_cat.id,
        date=transfer.date,
        amount=Decimal(str(deposit_amount)),
        amount_home_currency=Decimal(str(deposit_amount)) * Decimal(str(rate_to_to_home)),
        currency=to_curr,
        exchange_rate=1.0, 
        description=transfer.description or f"Transfer from {from_account.name}",
        transaction_type=models.TransactionType.income,
        transfer_id=transfer_id
    )
    
    db.add(withdrawal)
    db.add(deposit)
    db.flush()
    
    # 5. Sync balances
    sync_transaction_to_balances(db, transfer.from_account_id, transfer.date.date(), -transfer.amount)
    sync_transaction_to_balances(db, transfer.to_account_id, transfer.date.date(), Decimal(str(deposit_amount)))
    
    db.commit()
    db.refresh(withdrawal)
    db.refresh(deposit)
    
    return [withdrawal, deposit]


@router.get(
    "/transactions/household/{household_id}",
    response_model=List[schemas.TransactionResponse],
)
def get_household_transactions(
    household_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    verify_household_access(household_id, current_user, db)

    # Get all accounts for this household
    accounts = db.query(models.FinancialAccount).filter(models.FinancialAccount.household_id == household_id).all()
    account_ids = [account.id for account in accounts]

    if not account_ids:
        return []

    transactions = db.query(models.Transaction).filter(models.Transaction.account_id.in_(account_ids)).all()
    return transactions

@router.put(
    "/transactions/{transaction_id}", response_model=schemas.TransactionResponse
)
def update_transaction(
    transaction_id: uuid.UUID,
    transaction_update: schemas.TransactionUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_transaction = db.query(models.Transaction).filter(models.Transaction.id == transaction_id).first()
    if not db_transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")

    db_account = db.query(models.FinancialAccount).filter(models.FinancialAccount.id == db_transaction.account_id).first()
    verify_household_access(db_account.household_id, current_user, db)
    verify_private_owner_visibility(db_account.owner_user_id, current_user)

    # Capture old impact for sync before any modifications
    # Capture old impact for sync before any modifications
    old_multiplier = 1 if db_transaction.transaction_type == models.TransactionType.income else -1
    old_exchange_rate = db_transaction.exchange_rate if db_transaction.exchange_rate else 1.0
    old_impact = (db_transaction.amount * Decimal(str(old_exchange_rate))) * old_multiplier
    old_date = db_transaction.date.date()

    if transaction_update.account_id:
        new_account = db.query(models.FinancialAccount).filter(models.FinancialAccount.id == transaction_update.account_id).first()
        if not new_account:
            raise HTTPException(status_code=404, detail="New account not found")
        if new_account.household_id != db_account.household_id:
            raise HTTPException(status_code=400, detail="New account must belong to the same household")

    if transaction_update.category_id:
        new_category = db.query(models.Category).filter(models.Category.id == transaction_update.category_id).first()
        if not new_category:
            raise HTTPException(status_code=404, detail="New category not found")
        if new_category.household_id != db_account.household_id:
            raise HTTPException(status_code=400, detail="New category must belong to the same household")
        db_transaction.transaction_type = new_category.type

    update_data = transaction_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_transaction, key, value)

    # Recalculate amount_home_currency if needed
    if any(k in update_data for k in ('amount', 'currency', 'date', 'account_id')):
        target_account = db_account
        if transaction_update.account_id:
            target_account = db.query(models.FinancialAccount).filter(models.FinancialAccount.id == transaction_update.account_id).first()
        
        home_curr = target_account.household.base_currency or "USD"
        trans_curr = db_transaction.currency or target_account.currency or "USD"
        rate_to_home = fetch_and_cache_exchange_rates(db, trans_curr, home_curr, db_transaction.date.date())
        db_transaction.amount_home_currency = db_transaction.amount * Decimal(str(rate_to_home))

    # Calculate new impact
    # Calculate new impact
    new_multiplier = 1 if db_transaction.transaction_type == models.TransactionType.income else -1
    new_exchange_rate = db_transaction.exchange_rate if db_transaction.exchange_rate else 1.0
    new_impact = (db_transaction.amount * Decimal(str(new_exchange_rate))) * new_multiplier
    new_date = db_transaction.date.date()

    if old_date == new_date:
        sync_transaction_to_balances(db, db_transaction.account_id, new_date, new_impact - old_impact)
    else:
        sync_transaction_to_balances(db, db_transaction.account_id, old_date, -old_impact)
        sync_transaction_to_balances(db, db_transaction.account_id, new_date, new_impact)

    db.commit()
    db.refresh(db_transaction)
    return db_transaction

@router.delete("/transactions/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(
    transaction_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_transaction = db.query(models.Transaction).filter(models.Transaction.id == transaction_id).first()
    if not db_transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")

    db_account = db.query(models.FinancialAccount).filter(models.FinancialAccount.id == db_transaction.account_id).first()
    verify_household_access(db_account.household_id, current_user, db)
    verify_private_owner_visibility(db_account.owner_user_id, current_user)

    # Reverse impact
    # Reverse impact
    multiplier = 1 if db_transaction.transaction_type == models.TransactionType.income else -1
    exchange_rate = db_transaction.exchange_rate if db_transaction.exchange_rate else 1.0
    sync_transaction_to_balances(db, db_transaction.account_id, db_transaction.date.date(), -(db_transaction.amount * Decimal(str(exchange_rate)) * multiplier))
    
    transfer_id = db_transaction.transfer_id
    db.delete(db_transaction)

    # If transfer, delete counterpart
    if transfer_id:
        counterpart = db.query(models.Transaction).filter(
            models.Transaction.transfer_id == transfer_id,
            models.Transaction.id != transaction_id
        ).first()
        if counterpart:
            counterpart_multiplier = 1 if counterpart.transaction_type == models.TransactionType.income else -1
            counterpart_exchange = counterpart.exchange_rate if counterpart.exchange_rate else 1.0
            sync_transaction_to_balances(db, counterpart.account_id, counterpart.date.date(), -(counterpart.amount * Decimal(str(counterpart_exchange)) * counterpart_multiplier))
            db.delete(counterpart)

    db.commit()
    return

# --- CATEGORIES ---

@router.post(
    "/categories", response_model=schemas.CategoryResponse, status_code=status.HTTP_201_CREATED
)
def create_category(
    category: schemas.CategoryCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    verify_household_access(category.household_id, current_user, db)

    db_category = models.Category(
        id=uuid.uuid7(),
        household_id=category.household_id,
        name=category.name,
        type=category.type.value,
    )
    db.add(db_category)
    db.commit()
    db.refresh(db_category)
    return db_category

@router.get(
    "/categories/household/{household_id}",
    response_model=List[schemas.CategoryResponse],
)
def get_household_categories(
    household_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    verify_household_access(household_id, current_user, db)
    categories = db.query(models.Category).filter(models.Category.household_id == household_id).all()
    return categories

@router.put("/categories/{category_id}", response_model=schemas.CategoryResponse)
def update_category(
    category_id: uuid.UUID,
    category_update: schemas.CategoryUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_category = db.query(models.Category).filter(models.Category.id == category_id).first()
    if not db_category:
        raise HTTPException(status_code=404, detail="Category not found")

    verify_household_access(db_category.household_id, current_user, db)

    update_data = category_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_category, key, value)

    db.commit()
    db.refresh(db_category)
    return db_category

@router.delete("/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(
    category_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_category = db.query(models.Category).filter(models.Category.id == category_id).first()
    if not db_category:
        raise HTTPException(status_code=404, detail="Category not found")

    verify_household_access(db_category.household_id, current_user, db)

    db.delete(db_category)
    db.commit()
    return
