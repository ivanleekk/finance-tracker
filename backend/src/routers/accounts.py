from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from src.database import get_db
from src import schemas, models
from src.auth import get_current_user, verify_household_access

router = APIRouter(prefix="/accounts", tags=["Financial Accounts"])


@router.post("/", response_model=schemas.AccountResponse)
def create_account(
    account: schemas.AccountCreate, 
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    # Verify that the current user has access to the household
    verify_household_access(account.household_id, current_user, db)
    
    raise HTTPException(status_code=501, detail="Creation logic not yet implemented")



@router.get("/household/{household_id}", response_model=List[schemas.AccountResponse])
def get_household_accounts(household_id: int, db: Session = Depends(get_db)):
    raise HTTPException(status_code=501, detail="Fetch logic not yet implemented")


@router.put("/{account_id}", response_model=schemas.AccountResponse)
def update_account(
    account_id: int,
    account_update: schemas.AccountUpdate,
    db: Session = Depends(get_db),
):
    raise HTTPException(status_code=501, detail="Update logic not yet implemented")


@router.delete("/{account_id}")
def delete_account(account_id: int, db: Session = Depends(get_db)):
    raise HTTPException(status_code=501, detail="Deletion logic not yet implemented")


@router.post("/accountaccess", response_model=schemas.AccountAccessCreate)
def grant_account_access(
    access: schemas.AccountAccessCreate, db: Session = Depends(get_db)
):
    raise HTTPException(
        status_code=501, detail="Grant access logic not yet implemented"
    )


@router.get(
    "/accountaccess/{account_id}", response_model=List[schemas.AccountAccessResponse]
)
def get_account_access_list(account_id: int, db: Session = Depends(get_db)):
    raise HTTPException(
        status_code=501, detail="Fetch access list logic not yet implemented"
    )


@router.put("/accountaccess/{access_id}", response_model=schemas.AccountAccessUpdate)
def update_account_access(
    access_id: int,
    access_update: schemas.AccountAccessUpdate,
    db: Session = Depends(get_db),
):
    raise HTTPException(
        status_code=501, detail="Update access logic not yet implemented"
    )


@router.delete("/accountaccess/{access_id}")
def revoke_account_access(access_id: int, db: Session = Depends(get_db)):
    raise HTTPException(
        status_code=501, detail="Revoke access logic not yet implemented"
    )


@router.post("/balances", response_model=schemas.BalanceResponse)
def add_account_balance(balance: schemas.BalanceCreate, db: Session = Depends(get_db)):
    raise HTTPException(status_code=501, detail="Balance update not yet implemented")


@router.get(
    "/balances/account/{account_id}", response_model=List[schemas.BalanceResponse]
)
def get_account_balances(account_id: int, db: Session = Depends(get_db)):
    raise HTTPException(status_code=501, detail="Fetch balances not yet implemented")


@router.put("/balances/{balance_id}", response_model=schemas.BalanceResponse)
def update_account_balance(
    balance_id: int,
    balance_update: schemas.BalanceUpdate,
    db: Session = Depends(get_db),
):
    raise HTTPException(status_code=501, detail="Balance update not yet implemented")


@router.delete("/balances/{balance_id}")
def delete_account_balance(balance_id: int, db: Session = Depends(get_db)):
    raise HTTPException(status_code=501, detail="Balance deletion not yet implemented")
