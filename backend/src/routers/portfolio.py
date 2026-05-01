from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from src.database import get_db
from src import schemas

router = APIRouter(prefix="/portfolio", tags=["Investments & Trades"])


@router.post("/trades", response_model=schemas.TradeResponse)
def execute_trade(trade: schemas.TradeCreate, db: Session = Depends(get_db)):
    raise HTTPException(status_code=501, detail="Trade execution not implemented")


@router.get("/assets", response_model=List[schemas.AssetResponse])
def search_assets(ticker: str = None, db: Session = Depends(get_db)):
    raise HTTPException(status_code=501, detail="Asset lookup not implemented")


# Note: This is where we will eventually put the Polars math endpoints!
@router.get("/household/{household_id}/metrics")
def get_portfolio_metrics(household_id: int, db: Session = Depends(get_db)):
    raise HTTPException(
        status_code=501, detail="Sharpe/Sortino calculation not implemented"
    )
