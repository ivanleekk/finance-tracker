from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session
from sqlalchemy import select, func
from typing import List, Optional
import uuid
from datetime import datetime, date

from src.database import get_db
from src import schemas, models
from src.auth import get_current_user, verify_household_access
from src.services.snapshot_engine import run_snapshot_range
from src.services.account_service import sync_transaction_to_balances
from src.services.performance import calculate_performance_metrics
from src.services.market_data import fetch_and_cache_treasury_rates, fetch_and_cache_exchange_rates
import yfinance as yf
from datetime import timedelta
import logging
from decimal import Decimal

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/portfolio", tags=["Investments & Trades"])


@router.get("/price", response_model=schemas.TickerPriceResponse)
def get_ticker_price(
    ticker: str,
    date: str,
    current_user: models.User = Depends(get_current_user)
):
    """
    Fetch the historical closing price of a ticker using yfinance.
    If the exact date is not available (e.g., weekend), it returns the most recent prior closing price.
    """
    try:
        start_dt = datetime.strptime(date, "%Y-%m-%d")
        # We look back up to 7 days to handle weekends/holidays
        lookback_start = start_dt - timedelta(days=7)
        end_dt = start_dt + timedelta(days=1)
        
        df = yf.download(
            ticker, 
            start=lookback_start.strftime("%Y-%m-%d"), 
            end=end_dt.strftime("%Y-%m-%d"), 
            progress=False
        )
        
        if df.empty:
            raise HTTPException(status_code=404, detail=f"No price data found for ticker: {ticker}")
            
        # The dataframe index is the date. We want the closing price closest to the target date.
        # Since we downloaded up to target_date + 1, the last row is the closest available.
        price = float(df['Close'].iloc[-1].item())
        actual_date = df.index[-1].date()
        
        # Fetch currency - info can be slow, but we'll try it
        ticker_obj = yf.Ticker(ticker)
        currency = ticker_obj.info.get('currency', 'USD')
        
        return schemas.TickerPriceResponse(ticker=ticker.upper(), price=price, date=actual_date, currency=currency)
    except Exception as e:
        print(f"yfinance error: {str(e)}")
        raise HTTPException(status_code=400, detail=f"Failed to fetch price for {ticker}: {str(e)}")

def sync_trade_transaction(db: Session, db_trade: models.Trade):
    """
    Creates or updates a Transaction corresponding to a Trade.
    """
    # 1. Find or create the "Investment" category for this household
    investment_category = db.query(models.Category).filter(
        models.Category.household_id == db_trade.household_id,
        models.Category.name == "Investment"
    ).first()

    if not investment_category:
        investment_category = models.Category(
            id=uuid.uuid7(),
            household_id=db_trade.household_id,
            name="Investment",
            type=models.TransactionType.expense.value
        )
        db.add(investment_category)
        db.flush()

    # 2. Calculate amount
    # Store amount in the original trade currency
    amount = Decimal(str(db_trade.quantity)) * db_trade.price
    amount_in_acc = amount * Decimal(str(db_trade.exchange_rate))
    
    # 3. Determine transaction type
    # A buy trade is an expense (cash out), a sell trade is income (cash in)
    if db_trade.trade_type == models.TradeType.buy or db_trade.trade_type == "buy":
        trans_type = models.TransactionType.expense
    else:
        trans_type = models.TransactionType.income

    # 4. Get asset ticker for description
    asset = db.query(models.Asset).filter(models.Asset.id == db_trade.asset_id).first()
    ticker = asset.ticker if asset else "Unknown"
    trade_type_str = db_trade.trade_type.value if hasattr(db_trade.trade_type, "value") else str(db_trade.trade_type)
    description = f"Trade: {trade_type_str.capitalize()} {db_trade.quantity} {ticker}"

    if db_trade.transaction_id:
        db_transaction = db.query(models.Transaction).filter(models.Transaction.id == db_trade.transaction_id).first()
        if db_transaction:
            # Capture old impact for balance sync
            old_multiplier = 1 if db_transaction.transaction_type == models.TransactionType.income else -1
            old_exchange_rate = db_transaction.exchange_rate if db_transaction.exchange_rate else 1.0
            old_impact = (db_transaction.amount * Decimal(str(old_exchange_rate))) * old_multiplier
            old_date = db_transaction.date.date()

            # Update transaction fields
            db_transaction.account_id = db_trade.account_id
            db_transaction.category_id = investment_category.id
            db_transaction.date = db_trade.date
            db_transaction.amount = amount
            db_transaction.description = description
            db_transaction.transaction_type = trans_type
            db_transaction.currency = db_trade.currency
            db_transaction.exchange_rate = db_trade.exchange_rate

            # Calculate amount_home_currency
            db_account = db.query(models.FinancialAccount).filter(models.FinancialAccount.id == db_trade.account_id).first()
            home_curr = db_account.household.base_currency if db_account and db_account.household else "USD"
            rate_to_home = fetch_and_cache_exchange_rates(db, db_transaction.currency, home_curr, db_trade.date.date())
            db_transaction.amount_home_currency = amount * Decimal(str(rate_to_home))

            # New impact for balance sync
            new_multiplier = 1 if trans_type == models.TransactionType.income else -1
            new_impact = amount_in_acc * new_multiplier
            new_date = db_trade.date.date()

            if old_date == new_date:
                sync_transaction_to_balances(db, db_trade.account_id, new_date, new_impact - old_impact)
            else:
                sync_transaction_to_balances(db, db_trade.account_id, old_date, -old_impact)
                sync_transaction_to_balances(db, db_trade.account_id, new_date, new_impact)

            return db_transaction

    db_account = db.query(models.FinancialAccount).filter(models.FinancialAccount.id == db_trade.account_id).first()
    home_curr = db_account.household.base_currency if db_account and db_account.household else "USD"
    rate_to_home = fetch_and_cache_exchange_rates(db, db_trade.currency, home_curr, db_trade.date.date())
    amount_home_currency = amount * Decimal(str(rate_to_home))

    db_transaction = models.Transaction(
        id=uuid.uuid7(),
        account_id=db_trade.account_id,
        category_id=investment_category.id,
        date=db_trade.date,
        amount=amount,
        amount_home_currency=amount_home_currency,
        currency=db_trade.currency, # Inherit trade currency
        exchange_rate=db_trade.exchange_rate,
        description=description,
        transaction_type=trans_type
    )
    db.add(db_transaction)
    db.flush()
    db_trade.transaction_id = db_transaction.id

    # Sync to account balance for new transaction
    new_multiplier = 1 if trans_type == models.TransactionType.income else -1
    sync_transaction_to_balances(db, db_trade.account_id, db_trade.date.date(), amount_in_acc * new_multiplier)

    return db_transaction

# --- ASSETS ---

@router.post("/assets", response_model=schemas.AssetResponse, status_code=status.HTTP_201_CREATED)
def create_asset(
    asset: schemas.AssetCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    # Try to enrich with yfinance data if name is default or currency is missing
    ticker_name = asset.name
    ticker_currency = asset.currency

    if "Equity" in asset.name or not asset.currency:
        try:
            t = yf.Ticker(asset.ticker)
            info = t.info
            if info:
                if "Equity" in asset.name:
                    ticker_name = info.get('shortName') or info.get('longName') or asset.name
                ticker_currency = info.get('currency') or asset.currency or "USD"
        except Exception as e:
            logger.warning(f"Failed to enrich asset {asset.ticker} from yfinance: {e}")

    db_asset = models.Asset(
        id=asset.id if asset.id else uuid.uuid7(),
        ticker=asset.ticker.upper(),
        name=ticker_name,
        type=asset.type,
        currency=ticker_currency.upper() if ticker_currency else "USD",
    )
    db.add(db_asset)
    db.commit()
    db.refresh(db_asset)
    return db_asset

@router.post("/assets/fix", status_code=status.HTTP_200_OK)
def fix_all_asset_currencies(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    One-time maintenance endpoint to fix asset currencies and names using yfinance.
    """
    assets = db.query(models.Asset).all()
    updated_count = 0
    for asset in assets:
        try:
            t = yf.Ticker(asset.ticker)
            info = t.info
            if not info:
                continue
            
            new_curr = info.get('currency')
            new_name = info.get('shortName') or info.get('longName')
            
            changed = False
            if new_curr and new_curr.upper() != asset.currency.upper():
                asset.currency = new_curr.upper()
                changed = True
            
            if new_name and ("Equity" in asset.name or not asset.name):
                asset.name = new_name
                changed = True
            
            if changed:
                updated_count += 1
        except Exception as e:
            logger.error(f"Error fixing asset {asset.ticker}: {e}")
            continue
    
    db.commit()
    return {"status": "success", "updated_assets": updated_count}

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
        id=uuid.uuid7(),
        household_id=subportfolio.household_id,
        name=subportfolio.name,
        risk_profile=subportfolio.risk_profile,
        target_date=subportfolio.target_date,
        target_amount=subportfolio.target_amount,
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

@router.get("/subportfolios/{subportfolio_id}", response_model=schemas.SubPortfolioResponse)
def get_subportfolio(
    subportfolio_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    sp = db.query(models.SubPortfolio).filter(models.SubPortfolio.id == subportfolio_id).first()
    if not sp:
        raise HTTPException(status_code=404, detail="SubPortfolio not found")
    verify_household_access(sp.household_id, current_user, db)
    return sp

@router.patch("/subportfolios/{subportfolio_id}", response_model=schemas.SubPortfolioResponse)
def update_subportfolio(
    subportfolio_id: uuid.UUID,
    update: schemas.SubPortfolioUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_sp = db.query(models.SubPortfolio).filter(models.SubPortfolio.id == subportfolio_id).first()
    if not db_sp:
        raise HTTPException(status_code=404, detail="SubPortfolio not found")
    
    verify_household_access(db_sp.household_id, current_user, db)

    update_data = update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_sp, key, value)

    db.commit()
    db.refresh(db_sp)
    return db_sp

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
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    verify_household_access(trade.household_id, current_user, db)

    db_trade = models.Trade(
        id=uuid.uuid7(),
        household_id=trade.household_id,
        sub_portfolio_id=trade.sub_portfolio_id,
        asset_id=trade.asset_id,
        account_id=trade.account_id,
        trade_type=trade.type.value,
        date=trade.date,
        quantity=trade.quantity,
        price=trade.price,
        currency=trade.currency,
        exchange_rate=trade.exchange_rate,
    )
    db.add(db_trade)
    db.flush() # Ensure trade is available for sync
    sync_trade_transaction(db, db_trade)
    db.commit()
    db.refresh(db_trade)

    # Sync snapshots synchronously for serverless reliability
    run_snapshot_range(db, trade.household_id, trade.date.date(), date.today())
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
        currency=db_trade.currency,
        exchange_rate=db_trade.exchange_rate,
        transaction_id=db_trade.transaction_id,
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
            currency=t.currency,
            exchange_rate=t.exchange_rate,
            transaction_id=t.transaction_id,
        ) for t in trades
    ]

@router.put("/trades/{trade_id}", response_model=schemas.TradeResponse)
def update_trade(
    trade_id: uuid.UUID,
    trade_update: schemas.TradeUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_trade = db.query(models.Trade).filter(models.Trade.id == trade_id).first()
    if not db_trade:
        raise HTTPException(status_code=404, detail="Trade not found")

    verify_household_access(db_trade.household_id, current_user, db)

    # Record the earliest date affected by this update
    original_date = db_trade.date.date()
    new_date = trade_update.date.date() if trade_update.date else original_date
    recalc_start_date = min(original_date, new_date)

    update_data = trade_update.model_dump(exclude_unset=True)
    if 'type' in update_data:
        db_trade.trade_type = update_data.pop('type').value

    for key, value in update_data.items():
        setattr(db_trade, key, value)

    sync_trade_transaction(db, db_trade)
    db.commit()
    db.refresh(db_trade)

    # Sync snapshots synchronously for serverless reliability
    run_snapshot_range(db, db_trade.household_id, recalc_start_date, date.today())

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
        currency=db_trade.currency,
        exchange_rate=db_trade.exchange_rate,
        transaction_id=db_trade.transaction_id,
    )

@router.delete("/trades/{trade_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_trade(
    trade_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_trade = db.query(models.Trade).filter(models.Trade.id == trade_id).first()
    if not db_trade:
        raise HTTPException(status_code=404, detail="Trade not found")

    verify_household_access(db_trade.household_id, current_user, db)

    household_id = db_trade.household_id
    trade_date = db_trade.date.date()

    # Also delete the associated transaction and reverse its impact
    if db_trade.transaction_id:
        db_transaction = db.query(models.Transaction).filter(models.Transaction.id == db_trade.transaction_id).first()
        if db_transaction:
            multiplier = 1 if db_transaction.transaction_type == models.TransactionType.income else -1
            sync_transaction_to_balances(db, db_transaction.account_id, db_transaction.date.date(), -(db_transaction.amount * multiplier))
            db.delete(db_transaction)

    db.delete(db_trade)
    db.commit()

    # Sync snapshots synchronously for serverless reliability
    run_snapshot_range(db, household_id, trade_date, date.today())
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

    verify_household_access(db_subportfolio.household_id, current_user, db, required_roles=[models.HouseholdRoleType.owner, models.HouseholdRoleType.editor])

    db_access = models.PortfolioAccess(
        id=access.id if access.id else uuid.uuid7(),
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
    verify_household_access(db_subportfolio.household_id, current_user, db, required_roles=[models.HouseholdRoleType.owner, models.HouseholdRoleType.editor])

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
    verify_household_access(db_subportfolio.household_id, current_user, db, required_roles=[models.HouseholdRoleType.owner, models.HouseholdRoleType.editor])

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
        id=uuid.uuid7(),
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
    "/snapshots/household/{household_id}",
    response_model=List[schemas.PortfolioSnapshotResponse],
)
def get_household_portfolio_snapshots(
    household_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    verify_household_access(household_id, current_user, db)

    snapshots = db.query(models.PortfolioSnapshot).filter(models.PortfolioSnapshot.household_id == household_id).all()

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
            average_cost_basis=s.average_cost_basis,
            average_cost_basis_home_currency=s.average_cost_basis_home_currency,
        ) for s in snapshots
    ]


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
            average_cost_basis=s.average_cost_basis,
            average_cost_basis_home_currency=s.average_cost_basis_home_currency,
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

@router.post("/household/{household_id}/sync", status_code=status.HTTP_202_ACCEPTED)
def sync_portfolio_snapshots(
    household_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Manually trigger a portfolio snapshot sync for the specified household.
    This will catch up snapshots from the last recorded date until today.
    """
    verify_household_access(household_id, current_user, db)
    
    # Always sync from the earliest trade date to ensure full historical accuracy
    # when manually triggered.
    sync_start_date = db.execute(
        select(func.min(func.date(models.Trade.date)))
        .where(models.Trade.household_id == household_id)
    ).scalar()
    
    print(f"DEBUG: Sync Triggered. Earliest Trade Date in DB: {sync_start_date}")
        
    if sync_start_date:
        print(f"DEBUG: Initiating full sync from {sync_start_date} to {date.today()}")
        # Sync snapshots synchronously for serverless reliability
        run_snapshot_range(db, household_id, sync_start_date, date.today())
        
        return {"status": "success", "message": f"Full sync completed from {sync_start_date}", "from": sync_start_date, "to": date.today()}
    else:
        print(f"DEBUG: Sync aborted: No trades found for household {household_id}")
        return {"status": "no_data", "message": "No trades found to generate snapshots."}

# --- DIVIDENDS ---

@router.post("/dividends", response_model=schemas.DividendResponse, status_code=status.HTTP_201_CREATED)
def log_dividend(
    dividend: schemas.DividendCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    verify_household_access(dividend.household_id, current_user, db)

    db_dividend = models.Dividend(
        id=uuid.uuid7(),
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
        id=exchange_rate.id if exchange_rate.id else uuid.uuid7(),
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
@router.get("/household/{household_id}/metrics", response_model=schemas.PortfolioMetricsResponse)
def get_portfolio_metrics(
    household_id: uuid.UUID, 
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    verify_household_access(household_id, current_user, db)
    
    # Ensure fresh risk-free rate data (^IRX)
    last_rf = db.query(models.MarketPrice).filter(models.MarketPrice.ticker == "^IRX").order_by(models.MarketPrice.date.desc()).first()
    if not last_rf or last_rf.date < date.today() - timedelta(days=2):
        try:
            fetch_and_cache_treasury_rates(db)
        except Exception as e:
            # Don't block metrics calculation if yfinance fails
            print(f"Failed to fetch treasury rates: {e}")
    
    # 1. Calculate overall metrics
    overall = calculate_performance_metrics(db, household_id, start_date=start_date, end_date=end_date)
    
    # 2. Calculate metrics for each sub-portfolio
    sub_portfolios = db.query(models.SubPortfolio).filter(models.SubPortfolio.household_id == household_id).all()
    sub_metrics = []
    
    for sp in sub_portfolios:
        metrics = calculate_performance_metrics(db, household_id, sub_portfolio_id=sp.id, start_date=start_date, end_date=end_date)
        sub_metrics.append(schemas.SubPortfolioMetricsResponse(
            sub_portfolio_id=sp.id,
            name=sp.name,
            metrics=metrics
        ))
        
    return schemas.PortfolioMetricsResponse(
        household_id=household_id,
        overall_metrics=overall,
        sub_portfolio_metrics=sub_metrics
    )

@router.get("/subportfolios/{subportfolio_id}/metrics", response_model=schemas.PerformanceMetrics)
def get_subportfolio_metrics(
    subportfolio_id: uuid.UUID,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_subportfolio = db.query(models.SubPortfolio).filter(models.SubPortfolio.id == subportfolio_id).first()
    if not db_subportfolio:
        raise HTTPException(status_code=404, detail="Sub-portfolio not found")

    verify_household_access(db_subportfolio.household_id, current_user, db)
    
    # Ensure fresh risk-free rate data (^IRX)
    last_rf = db.query(models.MarketPrice).filter(models.MarketPrice.ticker == "^IRX").order_by(models.MarketPrice.date.desc()).first()
    if not last_rf or last_rf.date < date.today() - timedelta(days=2):
        try:
            fetch_and_cache_treasury_rates(db)
        except Exception as e:
            print(f"Failed to fetch treasury rates: {e}")

    metrics = calculate_performance_metrics(
        db, 
        db_subportfolio.household_id, 
        sub_portfolio_id=subportfolio_id,
        start_date=start_date,
        end_date=end_date
    )
    return metrics
