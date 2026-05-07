from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
import uuid

from src.database import get_db
from src import schemas, models
from src.auth import get_current_user, verify_household_access
from src.services.account_service import sync_transaction_to_balances

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

    db_transaction = models.Transaction(
        id=uuid.uuid7(),
        account_id=transaction.account_id,
        category_id=transaction.category_id,
        date=transaction.date,
        amount=transaction.amount,
        description=transaction.description,
        transaction_type=db_category.type,  # Infer type from category
    )
    db.add(db_transaction)
    
    # Sync to account balance
    amount_delta = transaction.amount if db_category.type == models.TransactionType.income.value else -transaction.amount
    sync_transaction_to_balances(db, transaction.account_id, transaction.date.date(), amount_delta)
    
    db.commit()
    db.refresh(db_transaction)
    return db_transaction

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

    # Capture old impact for sync before any modifications
    old_multiplier = 1 if db_transaction.transaction_type == models.TransactionType.income else -1
    old_impact = db_transaction.amount * old_multiplier
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

    # Calculate new impact
    new_multiplier = 1 if db_transaction.transaction_type == models.TransactionType.income else -1
    new_impact = db_transaction.amount * new_multiplier
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

    # Reverse impact
    multiplier = 1 if db_transaction.transaction_type == models.TransactionType.income else -1
    sync_transaction_to_balances(db, db_transaction.account_id, db_transaction.date.date(), -(db_transaction.amount * multiplier))

    db.delete(db_transaction)
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
