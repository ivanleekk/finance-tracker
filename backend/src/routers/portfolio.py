from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from src.database import get_db
from src import schemas

router = APIRouter(prefix="/portfolio", tags=["Investments & Trades"])


@router.post("/trades", response_model=schemas.TradeResponse)
def execute_trade(trade: schemas.TradeCreate, db: Session = Depends(get_db)):
    raise HTTPException(status_code=501, detail="Trade execution not implemented")


@router.get(
    "/trades/household/{household_id}", response_model=List[schemas.TradeResponse]
)
def get_household_trades(household_id: int, db: Session = Depends(get_db)):
    raise HTTPException(status_code=501, detail="Fetch trades not implemented")


@router.put("/trades/{trade_id}", response_model=schemas.TradeResponse)
def update_trade(
    trade_id: int,
    trade_update: schemas.TradeUpdate,
    db: Session = Depends(get_db),
):
    raise HTTPException(status_code=501, detail="Trade update not implemented")


@router.delete("/trades/{trade_id}")
def delete_trade(trade_id: int, db: Session = Depends(get_db)):
    raise HTTPException(status_code=501, detail="Trade deletion not implemented")


@router.post("/assets", response_model=schemas.AssetResponse)
def create_asset(asset: schemas.AssetCreate, db: Session = Depends(get_db)):
    raise HTTPException(status_code=501, detail="Asset creation not implemented")


@router.get("/assets", response_model=List[schemas.AssetResponse])
def search_assets(ticker: str = None, db: Session = Depends(get_db)):
    raise HTTPException(status_code=501, detail="Asset lookup not implemented")


@router.put("/assets/{asset_id}", response_model=schemas.AssetResponse)
def update_asset(
    asset_id: int,
    asset_update: schemas.AssetUpdate,
    db: Session = Depends(get_db),
):
    raise HTTPException(status_code=501, detail="Asset update not implemented")


@router.delete("/assets/{asset_id}")
def delete_asset(asset_id: int, db: Session = Depends(get_db)):
    raise HTTPException(status_code=501, detail="Asset deletion not implemented")


@router.post("/subportfolios", response_model=schemas.SubPortfolioResponse)
def create_subportfolio(
    subportfolio: schemas.SubPortfolioCreate, db: Session = Depends(get_db)
):
    raise HTTPException(
        status_code=501, detail="Sub-portfolio creation not implemented"
    )


@router.get(
    "/subportfolios/household/{household_id}",
    response_model=List[schemas.SubPortfolioResponse],
)
def get_household_subportfolios(household_id: int, db: Session = Depends(get_db)):
    raise HTTPException(status_code=501, detail="Fetch sub-portfolios not implemented")


@router.get(
    "/subportfolios/{subportfolio_id}", response_model=schemas.SubPortfolioResponse
)
def get_subportfolio(subportfolio_id: int, db: Session = Depends(get_db)):
    raise HTTPException(status_code=501, detail="Fetch sub-portfolio not implemented")


@router.put(
    "/subportfolios/{subportfolio_id}", response_model=schemas.SubPortfolioResponse
)
def update_subportfolio(
    subportfolio_id: int,
    subportfolio_update: schemas.SubPortfolioBase,
    db: Session = Depends(get_db),
):
    raise HTTPException(status_code=501, detail="Sub-portfolio update not implemented")


@router.delete("/subportfolios/{subportfolio_id}")
def delete_subportfolio(subportfolio_id: int, db: Session = Depends(get_db)):
    raise HTTPException(
        status_code=501, detail="Sub-portfolio deletion not implemented"
    )


@router.post(
    "/subportfolios/{subportfolio_id}/snapshot",
    response_model=schemas.PortfolioSnapshotResponse,
)
def create_portfolio_snapshot(subportfolio_id: int, db: Session = Depends(get_db)):
    raise HTTPException(
        status_code=501, detail="Portfolio snapshot creation not implemented"
    )


@router.get(
    "/subportfolios/{subportfolio_id}/snapshot",
    response_model=List[schemas.PortfolioSnapshotResponse],
)
def get_portfolio_snapshots(subportfolio_id: int, db: Session = Depends(get_db)):
    raise HTTPException(
        status_code=501, detail="Fetch portfolio snapshots not implemented"
    )


@router.put(
    "/subportfolios/{subportfolio_id}/snapshot/{snapshot_id}",
    response_model=schemas.PortfolioSnapshotResponse,
)
def update_portfolio_snapshot(snapshot_id: int, db: Session = Depends(get_db)):
    raise HTTPException(
        status_code=501, detail="Portfolio snapshot update not implemented"
    )


@router.delete("/subportfolios/{subportfolio_id}/snapshot/{snapshot_id}")
def delete_portfolio_snapshot(snapshot_id: int, db: Session = Depends(get_db)):
    raise HTTPException(
        status_code=501, detail="Portfolio snapshot deletion not implemented"
    )


@router.post(
    "/subportfolios/{subportfolio_id}/access",
    response_model=schemas.PortfolioAccessResponse,
)
def grant_subportfolio_access(
    subportfolio_id: int,
    access: schemas.PortfolioAccessCreate,
    db: Session = Depends(get_db),
):
    raise HTTPException(
        status_code=501, detail="Grant sub-portfolio access not implemented"
    )


@router.get(
    "/subportfolios/{subportfolio_id}/access",
    response_model=List[schemas.PortfolioAccessResponse],
)
def get_subportfolio_access_list(subportfolio_id: int, db: Session = Depends(get_db)):
    raise HTTPException(
        status_code=501, detail="Fetch sub-portfolio access list not implemented"
    )


@router.put(
    "/subportfolios/access/{access_id}", response_model=schemas.PortfolioAccessUpdate
)
def update_subportfolio_access(
    access_id: int,
    access_update: schemas.PortfolioAccessUpdate,
    db: Session = Depends(get_db),
):
    raise HTTPException(
        status_code=501, detail="Update sub-portfolio access not implemented"
    )


@router.delete("/subportfolios/access/{access_id}")
def revoke_subportfolio_access(access_id: int, db: Session = Depends(get_db)):
    raise HTTPException(
        status_code=501, detail="Revoke sub-portfolio access not implemented"
    )


@router.post("/dividends", response_model=schemas.DividendResponse)
def log_dividend(dividend: schemas.DividendCreate, db: Session = Depends(get_db)):
    raise HTTPException(status_code=501, detail="Dividend logging not implemented")


@router.get(
    "/dividends/household/{household_id}",
    response_model=List[schemas.DividendResponse],
)
def get_household_dividends(household_id: int, db: Session = Depends(get_db)):
    raise HTTPException(status_code=501, detail="Fetch dividends not implemented")


@router.put("/dividends/{dividend_id}", response_model=schemas.DividendResponse)
def update_dividend(
    dividend_id: int,
    dividend_update: schemas.DividendUpdate,
    db: Session = Depends(get_db),
):
    raise HTTPException(status_code=501, detail="Dividend update not implemented")


@router.delete("/dividends/{dividend_id}")
def delete_dividend(dividend_id: int, db: Session = Depends(get_db)):
    raise HTTPException(status_code=501, detail="Dividend deletion not implemented")


@router.post("/exchangerates", response_model=schemas.ExchangeRateResponse)
def log_exchange_rate(
    exchange_rate: schemas.ExchangeRateCreate, db: Session = Depends(get_db)
):
    raise HTTPException(status_code=501, detail="Exchange rate logging not implemented")


@router.get("/exchangerates", response_model=List[schemas.ExchangeRateResponse])
def get_exchange_rates(
    base_currency: str = None,
    target_currency: str = None,
    db: Session = Depends(get_db),
):
    raise HTTPException(status_code=501, detail="Fetch exchange rates not implemented")


@router.put(
    "/exchangerates/{exchange_rate_id}", response_model=schemas.ExchangeRateResponse
)
def update_exchange_rate(
    exchange_rate_id: int,
    exchange_rate_update: schemas.ExchangeRateUpdate,
    db: Session = Depends(get_db),
):
    raise HTTPException(status_code=501, detail="Exchange rate update not implemented")


@router.delete("/exchangerates/{exchange_rate_id}")
def delete_exchange_rate(exchange_rate_id: int, db: Session = Depends(get_db)):
    raise HTTPException(
        status_code=501, detail="Exchange rate deletion not implemented"
    )


# Note: This is where we will eventually put the Polars math endpoints!
@router.get("/household/{household_id}/metrics")
def get_portfolio_metrics(household_id: int, db: Session = Depends(get_db)):
    raise HTTPException(
        status_code=501, detail="Sharpe/Sortino calculation not implemented"
    )
