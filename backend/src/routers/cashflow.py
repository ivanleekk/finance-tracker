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


@router.put(
    "/transactions/{transaction_id}", response_model=schemas.TransactionResponse
)
def update_transaction(
    transaction_id: int,
    transaction_update: schemas.TransactionUpdate,
    db: Session = Depends(get_db),
):
    raise HTTPException(status_code=501, detail="Transaction update not implemented")


@router.delete("/transactions/{transaction_id}")
def delete_transaction(transaction_id: int, db: Session = Depends(get_db)):
    raise HTTPException(status_code=501, detail="Transaction deletion not implemented")


@router.post(
    "/categories/household{household_id}", response_model=schemas.CategoryResponse
)
def create_category(category: schemas.CategoryCreate, db: Session = Depends(get_db)):
    raise HTTPException(status_code=501, detail="Category creation not implemented")


@router.get(
    "/categories/household/{household_id}",
    response_model=List[schemas.CategoryResponse],
)
def get_household_categories(household_id: int, db: Session = Depends(get_db)):
    raise HTTPException(status_code=501, detail="Fetch categories not implemented")


@router.put("/categories/{category_id}", response_model=schemas.CategoryResponse)
def update_category(
    category_id: int,
    category_update: schemas.CategoryUpdate,
    db: Session = Depends(get_db),
):
    raise HTTPException(status_code=501, detail="Category update not implemented")


@router.delete("/categories/{category_id}")
def delete_category(category_id: int, db: Session = Depends(get_db)):
    raise HTTPException(status_code=501, detail="Category deletion not implemented")
