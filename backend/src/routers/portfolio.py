from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid

from src.database import get_db
from src import schemas, models
from src.auth import get_current_user, verify_household_access

router = APIRouter(prefix="/portfolio", tags=["Investments & Trades"])

# --- ASSETS ---

@router.post("/assets", response_model=schemas.AssetResponse, status_code=status.HTTP_201_CREATED)
def create_asset(
    asset: schemas.AssetCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_asset = models.Asset(
        id=asset.id if asset.id else uuid.uuid4(),
        ticker=asset.ticker,
        name=asset.name,
        type=asset.type,
        currency=asset.currency,
    )
    db.add(db_asset)
    db.commit()
    db.refresh(db_asset)
    return db_asset

@router.get("/assets", response_model=List[schemas.AssetResponse])
def search_assets(
    ticker: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    query = db.query(models.Asset)
    if ticker:
        query = query.filter(models.Asset.ticker.ilike(f"%{ticker}%"))
    return query.all()

@router.put("/assets/{asset_id}", response_model=schemas.AssetResponse)
def update_asset(
    asset_id: uuid.UUID,
    asset_update: schemas.AssetUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_asset = db.query(models.Asset).filter(models.Asset.id == asset_id).first()
    if not db_asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    update_data = asset_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_asset, key, value)

    db.commit()
    db.refresh(db_asset)
    return db_asset

@router.delete("/assets/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_asset(
    asset_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_asset = db.query(models.Asset).filter(models.Asset.id == asset_id).first()
    if not db_asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    db.delete(db_asset)
    db.commit()
    return

# --- SUBPORTFOLIOS ---

@router.post("/subportfolios", response_model=schemas.SubPortfolioResponse, status_code=status.HTTP_201_CREATED)
def create_subportfolio(
    subportfolio: schemas.SubPortfolioCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    verify_household_access(subportfolio.household_id, current_user, db)

    db_subportfolio = models.SubPortfolio(
        id=uuid.uuid4(),
        household_id=subportfolio.household_id,
        name=subportfolio.name,
        risk_profile=subportfolio.risk_profile,
        target_date=subportfolio.target_date,
    )
    db.add(db_subportfolio)
    db.commit()
    db.refresh(db_subportfolio)
    return db_subportfolio

@router.get(
    "/subportfolios/household/{household_id}",
    response_model=List[schemas.SubPortfolioResponse],
)
def get_household_subportfolios(
    household_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    verify_household_access(household_id, current_user, db)
    subportfolios = db.query(models.SubPortfolio).filter(models.SubPortfolio.household_id == household_id).all()
    return subportfolios

@router.get(
    "/subportfolios/{subportfolio_id}", response_model=schemas.SubPortfolioResponse
)
def get_subportfolio(
    subportfolio_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_subportfolio = db.query(models.SubPortfolio).filter(models.SubPortfolio.id == subportfolio_id).first()
    if not db_subportfolio:
        raise HTTPException(status_code=404, detail="Sub-portfolio not found")

    verify_household_access(db_subportfolio.household_id, current_user, db)
    return db_subportfolio

@router.put(
    "/subportfolios/{subportfolio_id}", response_model=schemas.SubPortfolioResponse
)
def update_subportfolio(
    subportfolio_id: uuid.UUID,
    subportfolio_update: schemas.SubPortfolioUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_subportfolio = db.query(models.SubPortfolio).filter(models.SubPortfolio.id == subportfolio_id).first()
    if not db_subportfolio:
        raise HTTPException(status_code=404, detail="Sub-portfolio not found")

    verify_household_access(db_subportfolio.household_id, current_user, db)

    update_data = subportfolio_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_subportfolio, key, value)

    db.commit()
    db.refresh(db_subportfolio)
    return db_subportfolio

@router.delete("/subportfolios/{subportfolio_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_subportfolio(
    subportfolio_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_subportfolio = db.query(models.SubPortfolio).filter(models.SubPortfolio.id == subportfolio_id).first()
    if not db_subportfolio:
        raise HTTPException(status_code=404, detail="Sub-portfolio not found")

    verify_household_access(db_subportfolio.household_id, current_user, db)

    db.delete(db_subportfolio)
    db.commit()
    return

# --- TRADES ---

@router.post("/trades", response_model=schemas.TradeResponse, status_code=status.HTTP_201_CREATED)
def execute_trade(
    trade: schemas.TradeCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    verify_household_access(trade.household_id, current_user, db)

    db_trade = models.Trade(
        id=uuid.uuid4(),
        household_id=trade.household_id,
        sub_portfolio_id=trade.sub_portfolio_id,
        asset_id=trade.asset_id,
        account_id=trade.account_id,
        trade_type=trade.type.value,
        date=trade.date,
        quantity=trade.quantity,
        price=trade.price,
        exchange_rate=trade.exchange_rate,
    )
    db.add(db_trade)
    db.commit()
    db.refresh(db_trade)
    # We must construct trade base manually because db column is trade_type while schema uses type
    response = schemas.TradeResponse(
        id=db_trade.id,
        household_id=db_trade.household_id,
        sub_portfolio_id=db_trade.sub_portfolio_id,
        asset_id=db_trade.asset_id,
        account_id=db_trade.account_id,
        type=db_trade.trade_type,
        date=db_trade.date,
        quantity=db_trade.quantity,
        price=db_trade.price,
        exchange_rate=db_trade.exchange_rate,
    )
    return response

@router.get(
    "/trades/household/{household_id}", response_model=List[schemas.TradeResponse]
)
def get_household_trades(
    household_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    verify_household_access(household_id, current_user, db)
    trades = db.query(models.Trade).filter(models.Trade.household_id == household_id).all()
    # transform for schema
    return [
        schemas.TradeResponse(
            id=t.id,
            household_id=t.household_id,
            sub_portfolio_id=t.sub_portfolio_id,
            asset_id=t.asset_id,
            account_id=t.account_id,
            type=t.trade_type,
            date=t.date,
            quantity=t.quantity,
            price=t.price,
            exchange_rate=t.exchange_rate,
        ) for t in trades
    ]

@router.put("/trades/{trade_id}", response_model=schemas.TradeResponse)
def update_trade(
    trade_id: uuid.UUID,
    trade_update: schemas.TradeUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_trade = db.query(models.Trade).filter(models.Trade.id == trade_id).first()
    if not db_trade:
        raise HTTPException(status_code=404, detail="Trade not found")

    verify_household_access(db_trade.household_id, current_user, db)

    update_data = trade_update.model_dump(exclude_unset=True)
    if 'type' in update_data:
        db_trade.trade_type = update_data.pop('type').value

    for key, value in update_data.items():
        setattr(db_trade, key, value)

    db.commit()
    db.refresh(db_trade)
    return schemas.TradeResponse(
        id=db_trade.id,
        household_id=db_trade.household_id,
        sub_portfolio_id=db_trade.sub_portfolio_id,
        asset_id=db_trade.asset_id,
        account_id=db_trade.account_id,
        type=db_trade.trade_type,
        date=db_trade.date,
        quantity=db_trade.quantity,
        price=db_trade.price,
        exchange_rate=db_trade.exchange_rate,
    )

@router.delete("/trades/{trade_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_trade(
    trade_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_trade = db.query(models.Trade).filter(models.Trade.id == trade_id).first()
    if not db_trade:
        raise HTTPException(status_code=404, detail="Trade not found")

    verify_household_access(db_trade.household_id, current_user, db)

    db.delete(db_trade)
    db.commit()
    return

# --- PORTFOLIO ACCESS ---

@router.post(
    "/subportfolios/{subportfolio_id}/access",
    response_model=schemas.PortfolioAccessResponse,
    status_code=status.HTTP_201_CREATED
)
def grant_subportfolio_access(
    subportfolio_id: uuid.UUID,
    access: schemas.PortfolioAccessCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_subportfolio = db.query(models.SubPortfolio).filter(models.SubPortfolio.id == subportfolio_id).first()
    if not db_subportfolio:
        raise HTTPException(status_code=404, detail="Sub-portfolio not found")

    verify_household_access(db_subportfolio.household_id, current_user, db, required_roles=["owner", "admin"])

    db_access = models.PortfolioAccess(
        id=access.id if access.id else uuid.uuid4(),
        sub_portfolio_id=subportfolio_id,
        user_id=access.user_id,
        role=access.role,
    )
    db.add(db_access)
    db.commit()
    db.refresh(db_access)
    return db_access

@router.get(
    "/subportfolios/{subportfolio_id}/access",
    response_model=List[schemas.PortfolioAccessResponse],
)
def get_subportfolio_access_list(
    subportfolio_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_subportfolio = db.query(models.SubPortfolio).filter(models.SubPortfolio.id == subportfolio_id).first()
    if not db_subportfolio:
        raise HTTPException(status_code=404, detail="Sub-portfolio not found")

    verify_household_access(db_subportfolio.household_id, current_user, db)

    access_list = db.query(models.PortfolioAccess).filter(models.PortfolioAccess.sub_portfolio_id == subportfolio_id).all()
    return access_list

@router.put(
    "/subportfolios/access/{access_id}", response_model=schemas.PortfolioAccessResponse
)
def update_subportfolio_access(
    access_id: uuid.UUID,
    access_update: schemas.PortfolioAccessUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_access = db.query(models.PortfolioAccess).filter(models.PortfolioAccess.id == access_id).first()
    if not db_access:
        raise HTTPException(status_code=404, detail="Portfolio access not found")

    db_subportfolio = db.query(models.SubPortfolio).filter(models.SubPortfolio.id == db_access.sub_portfolio_id).first()
    verify_household_access(db_subportfolio.household_id, current_user, db, required_roles=["owner", "admin"])

    if access_update.role:
        db_access.role = access_update.role

    db.commit()
    db.refresh(db_access)
    return db_access

@router.delete("/subportfolios/access/{access_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_subportfolio_access(
    access_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_access = db.query(models.PortfolioAccess).filter(models.PortfolioAccess.id == access_id).first()
    if not db_access:
        raise HTTPException(status_code=404, detail="Portfolio access not found")

    db_subportfolio = db.query(models.SubPortfolio).filter(models.SubPortfolio.id == db_access.sub_portfolio_id).first()
    verify_household_access(db_subportfolio.household_id, current_user, db, required_roles=["owner", "admin"])

    db.delete(db_access)
    db.commit()
    return

# --- SNAPSHOTS ---

@router.post(
    "/subportfolios/{subportfolio_id}/snapshot",
    response_model=schemas.PortfolioSnapshotResponse,
    status_code=status.HTTP_201_CREATED
)
def create_portfolio_snapshot(
    subportfolio_id: uuid.UUID,
    snapshot: schemas.PortfolioSnapshotCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    verify_household_access(snapshot.household_id, current_user, db)

    db_snapshot = models.PortfolioSnapshot(
        id=uuid.uuid4(),
        household_id=snapshot.household_id,
        sub_portfolio_id=subportfolio_id,
        asset_id=snapshot.asset_id,
        date=snapshot.date,
        quantity=snapshot.quantity,
        current_price=snapshot.price,
        exchange_rate_used=snapshot.exchange_rate_used,
        current_value_home_currency=snapshot.current_value_home_currency,
        average_cost_basis=snapshot.averge_cost_basis,
    )
    db.add(db_snapshot)
    db.commit()
    db.refresh(db_snapshot)

    return schemas.PortfolioSnapshotResponse(
        id=db_snapshot.id,
        household_id=db_snapshot.household_id,
        sub_portfolio_id=db_snapshot.sub_portfolio_id,
        asset_id=db_snapshot.asset_id,
        date=db_snapshot.date,
        quantity=db_snapshot.quantity,
        price=db_snapshot.current_price,
        exchange_rate_used=db_snapshot.exchange_rate_used,
        current_value_home_currency=db_snapshot.current_value_home_currency,
        averge_cost_basis=db_snapshot.average_cost_basis,
    )

@router.get(
    "/subportfolios/{subportfolio_id}/snapshot",
    response_model=List[schemas.PortfolioSnapshotResponse],
)
def get_portfolio_snapshots(
    subportfolio_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_subportfolio = db.query(models.SubPortfolio).filter(models.SubPortfolio.id == subportfolio_id).first()
    if not db_subportfolio:
        raise HTTPException(status_code=404, detail="Sub-portfolio not found")

    verify_household_access(db_subportfolio.household_id, current_user, db)

    snapshots = db.query(models.PortfolioSnapshot).filter(models.PortfolioSnapshot.sub_portfolio_id == subportfolio_id).all()

    return [
        schemas.PortfolioSnapshotResponse(
            id=s.id,
            household_id=s.household_id,
            sub_portfolio_id=s.sub_portfolio_id,
            asset_id=s.asset_id,
            date=s.date,
            quantity=s.quantity,
            price=s.current_price,
            exchange_rate_used=s.exchange_rate_used,
            current_value_home_currency=s.current_value_home_currency,
            averge_cost_basis=s.average_cost_basis,
        ) for s in snapshots
    ]

@router.put(
    "/subportfolios/snapshot/{snapshot_id}",
    response_model=schemas.PortfolioSnapshotResponse,
)
def update_portfolio_snapshot(
    snapshot_id: uuid.UUID,
    snapshot_update: schemas.PortfolioSnapshotUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_snapshot = db.query(models.PortfolioSnapshot).filter(models.PortfolioSnapshot.id == snapshot_id).first()
    if not db_snapshot:
        raise HTTPException(status_code=404, detail="Snapshot not found")

    verify_household_access(db_snapshot.household_id, current_user, db)

    update_data = snapshot_update.model_dump(exclude_unset=True)

    # Map schema fields to db model fields
    field_mapping = {
        'price': 'current_price',
        'averge_cost_basis': 'average_cost_basis'
    }

    for schema_key, value in update_data.items():
        db_key = field_mapping.get(schema_key, schema_key)
        setattr(db_snapshot, db_key, value)

    db.commit()
    db.refresh(db_snapshot)

    return schemas.PortfolioSnapshotResponse(
        id=db_snapshot.id,
        household_id=db_snapshot.household_id,
        sub_portfolio_id=db_snapshot.sub_portfolio_id,
        asset_id=db_snapshot.asset_id,
        date=db_snapshot.date,
        quantity=db_snapshot.quantity,
        price=db_snapshot.current_price,
        exchange_rate_used=db_snapshot.exchange_rate_used,
        current_value_home_currency=db_snapshot.current_value_home_currency,
        averge_cost_basis=db_snapshot.average_cost_basis,
    )

@router.delete("/subportfolios/snapshot/{snapshot_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_portfolio_snapshot(
    snapshot_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_snapshot = db.query(models.PortfolioSnapshot).filter(models.PortfolioSnapshot.id == snapshot_id).first()
    if not db_snapshot:
        raise HTTPException(status_code=404, detail="Snapshot not found")

    verify_household_access(db_snapshot.household_id, current_user, db)

    db.delete(db_snapshot)
    db.commit()
    return

# --- DIVIDENDS ---

@router.post("/dividends", response_model=schemas.DividendResponse, status_code=status.HTTP_201_CREATED)
def log_dividend(
    dividend: schemas.DividendCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    verify_household_access(dividend.household_id, current_user, db)

    db_dividend = models.Dividend(
        id=uuid.uuid4(),
        household_id=dividend.household_id,
        sub_portfolio_id=dividend.sub_portfolio_id,
        asset_id=dividend.asset_id,
        account_id=dividend.account_id,
        date=dividend.date,
        amount=dividend.amount,
        exchange_rate=dividend.exchange_rate,
    )
    db.add(db_dividend)
    db.commit()
    db.refresh(db_dividend)
    return db_dividend

@router.get(
    "/dividends/household/{household_id}",
    response_model=List[schemas.DividendResponse],
)
def get_household_dividends(
    household_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    verify_household_access(household_id, current_user, db)
    dividends = db.query(models.Dividend).filter(models.Dividend.household_id == household_id).all()
    return dividends

@router.put("/dividends/{dividend_id}", response_model=schemas.DividendResponse)
def update_dividend(
    dividend_id: uuid.UUID,
    dividend_update: schemas.DividendUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_dividend = db.query(models.Dividend).filter(models.Dividend.id == dividend_id).first()
    if not db_dividend:
        raise HTTPException(status_code=404, detail="Dividend not found")

    verify_household_access(db_dividend.household_id, current_user, db)

    update_data = dividend_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_dividend, key, value)

    db.commit()
    db.refresh(db_dividend)
    return db_dividend

@router.delete("/dividends/{dividend_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_dividend(
    dividend_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_dividend = db.query(models.Dividend).filter(models.Dividend.id == dividend_id).first()
    if not db_dividend:
        raise HTTPException(status_code=404, detail="Dividend not found")

    verify_household_access(db_dividend.household_id, current_user, db)

    db.delete(db_dividend)
    db.commit()
    return

# --- EXCHANGE RATES ---

@router.post("/exchangerates", response_model=schemas.ExchangeRateResponse, status_code=status.HTTP_201_CREATED)
def log_exchange_rate(
    exchange_rate: schemas.ExchangeRateCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_rate = models.ExchangeRate(
        id=exchange_rate.id if exchange_rate.id else uuid.uuid4(),
        base_currency=exchange_rate.base_currency,
        target_currency=exchange_rate.target_currency,
        date=exchange_rate.date,
        rate=exchange_rate.rate,
    )
    db.add(db_rate)
    db.commit()
    db.refresh(db_rate)
    return db_rate

@router.get("/exchangerates", response_model=List[schemas.ExchangeRateResponse])
def get_exchange_rates(
    base_currency: Optional[str] = None,
    target_currency: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    query = db.query(models.ExchangeRate)
    if base_currency:
        query = query.filter(models.ExchangeRate.base_currency == base_currency)
    if target_currency:
        query = query.filter(models.ExchangeRate.target_currency == target_currency)
    return query.all()

@router.put(
    "/exchangerates/{exchange_rate_id}", response_model=schemas.ExchangeRateResponse
)
def update_exchange_rate(
    exchange_rate_id: uuid.UUID,
    exchange_rate_update: schemas.ExchangeRateUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_rate = db.query(models.ExchangeRate).filter(models.ExchangeRate.id == exchange_rate_id).first()
    if not db_rate:
        raise HTTPException(status_code=404, detail="Exchange rate not found")

    update_data = exchange_rate_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_rate, key, value)

    db.commit()
    db.refresh(db_rate)
    return db_rate

@router.delete("/exchangerates/{exchange_rate_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_exchange_rate(
    exchange_rate_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_rate = db.query(models.ExchangeRate).filter(models.ExchangeRate.id == exchange_rate_id).first()
    if not db_rate:
        raise HTTPException(status_code=404, detail="Exchange rate not found")

    db.delete(db_rate)
    db.commit()
    return


# Note: This is where we will eventually put the Polars math endpoints!
@router.get("/household/{household_id}/metrics")
def get_portfolio_metrics(household_id: int, db: Session = Depends(get_db)):
    raise HTTPException(
        status_code=501, detail="Sharpe/Sortino calculation not implemented"
    )
