from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from src.database import get_db
from src import schemas

router = APIRouter(prefix="/cashflow", tags=["Income & Expenses"])


@router.post("/transactions", response_model=schemas.TransactionResponse)
def log_transaction(
    transaction: schemas.TransactionCreate, db: Session = Depends(get_db)
):
    raise HTTPException(status_code=501, detail="Transaction logging not implemented")


@router.get(
    "/transactions/household/{household_id}",
    response_model=List[schemas.TransactionResponse],
)
def get_household_transactions(household_id: int, db: Session = Depends(get_db)):
    raise HTTPException(status_code=501, detail="Fetch transactions not implemented")
