from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from src.database import get_db
from src import schemas, models
from src.auth import get_current_user, verify_household_access
import uuid

router = APIRouter(prefix="/accounts", tags=["Financial Accounts"])


@router.post("/", response_model=schemas.AccountResponse, status_code=status.HTTP_201_CREATED)
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

    db_balance = models.AccountBalance(
        id=uuid.uuid7(),
        account_id=balance.account_id,
        date=balance.date,
        balance=balance.balance,
    )
    db.add(db_balance)
    db.commit()
    db.refresh(db_balance)
    return db_balance


@router.get(
    "/balances/household/{household_id}", response_model=List[schemas.BalanceResponse]
)
def get_household_balances(
    household_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    verify_household_access(household_id, current_user, db)

    accounts = db.query(models.FinancialAccount).filter(models.FinancialAccount.household_id == household_id).all()
    account_ids = [account.id for account in accounts]

    if not account_ids:
        return []

    balances = db.query(models.AccountBalance).filter(models.AccountBalance.account_id.in_(account_ids)).all()
    return balances


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
    for key, value in update_data.items():
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

    db.delete(db_balance)
    db.commit()
    return
