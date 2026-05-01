from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from src.database import get_db
from src import schemas

router = APIRouter(prefix="/accounts", tags=["Financial Accounts"])


@router.post("/", response_model=schemas.AccountResponse)
def create_account(account: schemas.AccountCreate, db: Session = Depends(get_db)):
    raise HTTPException(status_code=501, detail="Creation logic not yet implemented")


@router.get("/household/{household_id}", response_model=List[schemas.AccountResponse])
def get_household_accounts(household_id: int, db: Session = Depends(get_db)):
    raise HTTPException(status_code=501, detail="Fetch logic not yet implemented")


@router.post("/balances", response_model=schemas.BalanceResponse)
def add_account_balance(balance: schemas.BalanceCreate, db: Session = Depends(get_db)):
    raise HTTPException(status_code=501, detail="Balance update not yet implemented")
