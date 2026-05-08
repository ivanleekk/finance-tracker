from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from src.database import get_db
from src import schemas, models
from src.auth import get_current_user, verify_household_access
from src.services.account_service import propagate_balance_change, sync_transaction_to_balances
from src.services.market_data import fetch_and_cache_exchange_rates
from sqlalchemy import desc
from decimal import Decimal
from datetime import datetime, timezone
import uuid

router = APIRouter(prefix="/accounts", tags=["Financial Accounts"])


@router.post("", response_model=schemas.AccountResponse, status_code=status.HTTP_201_CREATED)
def create_account(
    account: schemas.AccountCreate, 
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    # Verify that the current user has access to the household
    verify_household_access(account.household_id, current_user, db)
    
    db_account = models.FinancialAccount(
        id=uuid.uuid7(),
        household_id=account.household_id,
        name=account.name,
        liquidity=account.liquidity,
        tax_status=account.tax_status,
        currency=account.currency,
    )
    db.add(db_account)
    db.commit()
    db.refresh(db_account)
    return db_account


@router.get("/household/{household_id}", response_model=List[schemas.AccountResponse])
def get_household_accounts(
    household_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    verify_household_access(household_id, current_user, db)
    accounts = db.query(models.FinancialAccount).filter(models.FinancialAccount.household_id == household_id).all()
    return accounts


@router.put("/{account_id}", response_model=schemas.AccountResponse)
def update_account(
    account_id: uuid.UUID,
    account_update: schemas.AccountUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_account = db.query(models.FinancialAccount).filter(models.FinancialAccount.id == account_id).first()
    if not db_account:
        raise HTTPException(status_code=404, detail="Account not found")

    verify_household_access(db_account.household_id, current_user, db)

    update_data = account_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_account, key, value)

    db.commit()
    db.refresh(db_account)
    return db_account


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(
    account_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_account = db.query(models.FinancialAccount).filter(models.FinancialAccount.id == account_id).first()
    if not db_account:
        raise HTTPException(status_code=404, detail="Account not found")

    verify_household_access(db_account.household_id, current_user, db)

    db.delete(db_account)
    db.commit()
    return


@router.post("/accountaccess", response_model=schemas.AccountAccessResponse, status_code=status.HTTP_201_CREATED)
def grant_account_access(
    access: schemas.AccountAccessCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_account = db.query(models.FinancialAccount).filter(models.FinancialAccount.id == access.account_id).first()
    if not db_account:
        raise HTTPException(status_code=404, detail="Account not found")

    verify_household_access(db_account.household_id, current_user, db, required_roles=[models.HouseholdRoleType.owner, models.HouseholdRoleType.editor])

    db_access = models.AccountAccess(
        id=access.id if access.id else uuid.uuid7(),
        account_id=access.account_id,
        user_id=access.user_id,
        role=access.role,
    )
    db.add(db_access)
    db.commit()
    db.refresh(db_access)
    return db_access


@router.get(
    "/accountaccess/{account_id}", response_model=List[schemas.AccountAccessResponse]
)
def get_account_access_list(
    account_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_account = db.query(models.FinancialAccount).filter(models.FinancialAccount.id == account_id).first()
    if not db_account:
        raise HTTPException(status_code=404, detail="Account not found")

    verify_household_access(db_account.household_id, current_user, db)

    access_list = db.query(models.AccountAccess).filter(models.AccountAccess.account_id == account_id).all()
    return access_list


@router.put("/accountaccess/{access_id}", response_model=schemas.AccountAccessResponse)
def update_account_access(
    access_id: uuid.UUID,
    access_update: schemas.AccountAccessUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_access = db.query(models.AccountAccess).filter(models.AccountAccess.id == access_id).first()
    if not db_access:
        raise HTTPException(status_code=404, detail="Account access not found")

    db_account = db.query(models.FinancialAccount).filter(models.FinancialAccount.id == db_access.account_id).first()
    verify_household_access(db_account.household_id, current_user, db, required_roles=[models.HouseholdRoleType.owner, models.HouseholdRoleType.editor])

    if access_update.role:
        db_access.role = access_update.role

    db.commit()
    db.refresh(db_access)
    return db_access


@router.delete("/accountaccess/{access_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_account_access(
    access_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_access = db.query(models.AccountAccess).filter(models.AccountAccess.id == access_id).first()
    if not db_access:
        raise HTTPException(status_code=404, detail="Account access not found")

    db_account = db.query(models.FinancialAccount).filter(models.FinancialAccount.id == db_access.account_id).first()
    verify_household_access(db_account.household_id, current_user, db, required_roles=[models.HouseholdRoleType.owner, models.HouseholdRoleType.editor])

    db.delete(db_access)
    db.commit()
    return


@router.post("/balances", response_model=schemas.BalanceResponse, status_code=status.HTTP_201_CREATED)
def add_account_balance(
    balance: schemas.BalanceCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_account = db.query(models.FinancialAccount).filter(models.FinancialAccount.id == balance.account_id).first()
    if not db_account:
        raise HTTPException(status_code=404, detail="Account not found")

    verify_household_access(db_account.household_id, current_user, db)

    # Check if a balance already exists for this date
    db_balance = db.query(models.AccountBalance).filter(
        models.AccountBalance.account_id == balance.account_id,
        models.AccountBalance.date == balance.date
    ).first()

    # Calculate delta for propagation if there's already a balance chain
    # What would the balance have been on this date?
    if db_balance:
        expected_balance = db_balance.balance
    else:
        prev_balance_rec = db.query(models.AccountBalance).filter(
            models.AccountBalance.account_id == balance.account_id,
            models.AccountBalance.date < balance.date
        ).order_by(desc(models.AccountBalance.date)).first()
        expected_balance = prev_balance_rec.balance if prev_balance_rec else Decimal("0")
    
    delta = balance.balance - expected_balance

    # Handle Currency Conversion for manual balance
    home_curr = db.query(models.Household).filter(models.Household.id == db_account.household_id).first().base_currency or "USD"
    acc_curr = db_account.currency or "USD"
    rate = fetch_and_cache_exchange_rates(db, acc_curr, home_curr, balance.date)

    if db_balance:
        db_balance.balance = balance.balance
        db_balance.balance_home_currency = float(balance.balance) * rate
        db_balance.is_manual = True
    else:
        db_balance = models.AccountBalance(
            id=uuid.uuid7(),
            account_id=balance.account_id,
            date=balance.date,
            balance=balance.balance,
            balance_home_currency=float(balance.balance) * rate,
            is_manual=True
        )
        db.add(db_balance)
    
    db.flush()

    # If there's a difference, create a reconciliation transaction
    if delta != 0:
        # Find or create "Adjustment" category
        adjustment_cat = db.query(models.Category).filter(
            models.Category.household_id == db_account.household_id,
            models.Category.name == "Balance Adjustment"
        ).first()
        
        if not adjustment_cat:
            adjustment_cat = models.Category(
                id=uuid.uuid7(),
                household_id=db_account.household_id,
                name="Balance Adjustment",
                type=models.TransactionType.income.value if delta > 0 else models.TransactionType.expense.value
            )
            db.add(adjustment_cat)
            db.flush()
        
        # Create transaction
        # Convert date to datetime for the Transaction model
        trans_datetime = datetime.combine(balance.date, datetime.min.time()).replace(tzinfo=timezone.utc)
        
        adj_transaction = models.Transaction(
            id=uuid.uuid7(),
            account_id=balance.account_id,
            category_id=adjustment_cat.id,
            date=trans_datetime,
            amount=abs(delta),
            description=f"Automated reconciliation for {balance.date}",
            transaction_type=models.TransactionType.income if delta > 0 else models.TransactionType.expense
        )
        db.add(adj_transaction)
    
    # Propagate the "correction" forward through automated records
    propagate_balance_change(db, balance.account_id, balance.date, delta)
    
    db.commit()
    db.refresh(db_balance)
    return db_balance


@router.get(
    "/balances/account/{account_id}", response_model=List[schemas.BalanceResponse]
)
def get_account_balances(
    account_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_account = db.query(models.FinancialAccount).filter(models.FinancialAccount.id == account_id).first()
    if not db_account:
        raise HTTPException(status_code=404, detail="Account not found")

    verify_household_access(db_account.household_id, current_user, db)

    balances = db.query(models.AccountBalance).filter(models.AccountBalance.account_id == account_id).all()
    return balances


@router.put("/balances/{balance_id}", response_model=schemas.BalanceResponse)
def update_account_balance(
    balance_id: uuid.UUID,
    balance_update: schemas.BalanceUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_balance = db.query(models.AccountBalance).filter(models.AccountBalance.id == balance_id).first()
    if not db_balance:
        raise HTTPException(status_code=404, detail="Balance not found")

    db_account = db.query(models.FinancialAccount).filter(models.FinancialAccount.id == db_balance.account_id).first()
    verify_household_access(db_account.household_id, current_user, db)

    update_data = balance_update.model_dump(exclude_unset=True)
    
    if 'balance' in update_data:
        delta = Decimal(str(update_data['balance'])) - db_balance.balance
        propagate_balance_change(db, db_balance.account_id, db_balance.date, delta)
        
        # Update home currency balance
        home_curr = db.query(models.Household).filter(models.Household.id == db_account.household_id).first().base_currency or "USD"
        acc_curr = db_account.currency or "USD"
        rate = fetch_and_cache_exchange_rates(db, acc_curr, home_curr, db_balance.date)
        db_balance.balance_home_currency = float(update_data['balance']) * rate

    for key, value in update_data.items():
        if key != 'balance': # already handled
            setattr(db_balance, key, value)

    db.commit()
    db.refresh(db_balance)
    return db_balance


@router.delete("/balances/{balance_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_account_balance(
    balance_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_balance = db.query(models.AccountBalance).filter(models.AccountBalance.id == balance_id).first()
    if not db_balance:
        raise HTTPException(status_code=404, detail="Balance not found")

    db_account = db.query(models.FinancialAccount).filter(models.FinancialAccount.id == db_balance.account_id).first()
    verify_household_access(db_account.household_id, current_user, db)

    if db_balance.is_manual:
        # 1. Find the reconciliation transaction
        adj_transaction = db.query(models.Transaction).filter(
            models.Transaction.account_id == db_balance.account_id,
            func.date(models.Transaction.date) == db_balance.date,
            models.Transaction.description == f"Automated reconciliation for {db_balance.date}"
        ).first()

        if adj_transaction:
            # 2. Calculate the delta that was introduced
            delta = adj_transaction.amount if adj_transaction.transaction_type == models.TransactionType.income else -adj_transaction.amount
            
            # 3. Propagate the negative delta forward
            propagate_balance_change(db, db_balance.account_id, db_balance.date, -delta)
            
            # 4. Delete the transaction
            db.delete(adj_transaction)

    # 5. Delete the balance record
    db.delete(db_balance)
    db.commit()
    return
