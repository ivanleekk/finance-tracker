from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session
from sqlalchemy import select, func
from typing import List, Optional
import uuid
from datetime import datetime, date

from src.database import get_db, SessionLocal
from src import schemas, models
from src.auth import get_current_user, verify_household_access, verify_private_owner_visibility, visible_sub_portfolio_ids, accessible_household_ids
from src.services.snapshot_engine import run_snapshot_range
from src.services.dividend_engine import sync_dividends_range, materialize_scheduled_dividends
from src.services.account_service import sync_transaction_to_balances
from src.services import ledger_service
from src.services.performance import calculate_performance_metrics, fetch_rf_and_benchmark_rows
from src.services.market_data import fetch_and_cache_treasury_rates, fetch_and_cache_exchange_rates, fetch_and_cache_market_prices_range
from src.services.cash_service import get_or_create_cash_asset, get_subportfolio_cash_balance, settle_trade_from_cash
from src.services.asset_service import asset_edit_replay_range, migrate_market_prices, normalize_asset_edit
from src.services.cache import cache_get_or_compute
from datetime import date
import yfinance as yf
from datetime import datetime, timedelta
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
        models.Category.name == models.SYSTEM_CATEGORY_INVESTMENT
    ).first()

    if not investment_category:
        investment_category = models.Category(
            id=uuid.uuid7(),
            household_id=db_trade.household_id,
            name=models.SYSTEM_CATEGORY_INVESTMENT,
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

    # Trades created without an explicit currency inherit the asset's currency
    if not db_trade.currency:
        db_trade.currency = (asset.currency if asset else None) or "USD"
    trade_type_str = db_trade.trade_type.value if hasattr(db_trade.trade_type, "value") else str(db_trade.trade_type)
    if asset and asset.type == models.CASH_ASSET_TYPE:
        verb = "deposit" if trans_type == models.TransactionType.expense else "withdrawal"
        description = f"Cash {verb}: {db_trade.quantity:g} {asset.currency}"
    else:
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

            # The trade's *cash* movement, mirrored into the ledger. `post_entry`
            # replaces the entry this row already had, so an edited trade cannot
            # leave a stale half behind.
            db.flush()
            ledger_service.post_transaction(db, db_transaction)

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

    # The trade's *cash* movement, mirrored into the ledger. A buy debits the
    # Investment category and credits the funding account, exactly as the
    # transaction it mirrors says; the holding itself stays valued by
    # snapshot_engine and is deliberately absent from the journal.
    db.flush()
    ledger_service.post_transaction(db, db_transaction)

    return db_transaction

# --- ASSETS ---

@router.post("/assets", response_model=schemas.AssetResponse, status_code=status.HTTP_201_CREATED)
def create_asset(
    asset: schemas.AssetCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    # Try to enrich with yfinance data if name is default or currency is missing.
    # Manual-priced assets (unlisted bonds, SSBs) have no market listing to enrich from.
    ticker_name = asset.name
    ticker_currency = asset.currency

    if asset.pricing_mode != models.PRICING_MODE_MANUAL and ("Equity" in asset.name or not asset.currency):
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
        pricing_mode=asset.pricing_mode,
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
        if asset.pricing_mode == models.PRICING_MODE_MANUAL:
            continue
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
    """
    Correct an asset's identity -- the ticker it was created under, its name,
    type, currency or pricing mode.

    Getting the currency wrong at creation (a .SI listing entered as USD) is the
    motivating case, and it is not a cosmetic edit: every home-currency value in
    ``portfolio_snapshots`` was converted with it. So the ripple is handled here
    rather than left to the next nightly run -- the cached prices follow the
    ticker (or are dropped, for market-priced assets, and refetched under the new
    symbol) and each holding household's snapshots replay from its first trade.
    See ``services/asset_service.py``.
    """
    db_asset = db.query(models.Asset).filter(models.Asset.id == asset_id).first()
    if not db_asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    # Cash (CASH.<CUR>) and earmarked-account (ACCT.<uuid>) pseudo-assets derive
    # their ticker, name and currency from the thing they stand for; editing the
    # row here would just be overwritten by the next get-or-create.
    if db_asset.type in models.PSEUDO_ASSET_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Cash and earmarked-account holdings can't be edited directly. Change the account or sub-portfolio instead.",
        )

    holdings = asset_edit_replay_range(db, asset_id)
    holder_ids = {household_id for household_id, _ in holdings}
    if holder_ids and not (holder_ids & set(accessible_household_ids(db, current_user))):
        raise HTTPException(status_code=403, detail="This asset is only held by another household")

    changes = normalize_asset_edit(asset_update.model_dump(exclude_unset=True))

    new_ticker = changes.get("ticker", db_asset.ticker)
    if "ticker" in changes and not new_ticker:
        raise HTTPException(status_code=400, detail="Ticker cannot be empty")
    if "currency" in changes and not changes.get("currency"):
        raise HTTPException(status_code=400, detail="Currency cannot be empty")
    if changes.get("type") in models.PSEUDO_ASSET_TYPES:
        raise HTTPException(status_code=400, detail=f"'{changes['type']}' is reserved for system-generated holdings")

    if new_ticker != db_asset.ticker:
        clash = (
            db.query(models.Asset)
            .filter(models.Asset.ticker == new_ticker, models.Asset.id != asset_id)
            .first()
        )
        if clash:
            raise HTTPException(
                status_code=409,
                detail=f"Ticker {new_ticker} already exists. Trade that asset instead of renaming this one.",
            )

    old_ticker = db_asset.ticker
    old_currency = db_asset.currency

    for key, value in changes.items():
        setattr(db_asset, key, value)

    migrate_market_prices(
        db,
        old_ticker=old_ticker,
        new_ticker=db_asset.ticker,
        old_currency=old_currency,
        new_currency=db_asset.currency,
        pricing_mode=db_asset.pricing_mode,
    )

    db.commit()
    db.refresh(db_asset)

    # A name/type-only edit changes nothing a snapshot depends on.
    if db_asset.ticker != old_ticker or (db_asset.currency or "") != (old_currency or ""):
        today = date.today()
        for household_id, first_trade_date in holdings:
            run_snapshot_range(db, household_id, first_trade_date, today)

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


@router.post("/assets/{asset_id}/price", response_model=schemas.ManualPriceResponse, status_code=status.HTTP_201_CREATED)
def record_manual_price(
    asset_id: uuid.UUID,
    manual_price: schemas.ManualPriceCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Record a price observation for a manually-priced asset (unlisted bonds,
    Singapore Savings Bonds, ...). Upserts into market_prices — the snapshot
    engine forward-fills from the latest recorded price — then re-runs the
    household's snapshots from that date so valuations update immediately.
    """
    verify_household_access(manual_price.household_id, current_user, db)

    db_asset = db.query(models.Asset).filter(models.Asset.id == asset_id).first()
    if not db_asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    if db_asset.pricing_mode != models.PRICING_MODE_MANUAL:
        raise HTTPException(status_code=400, detail="Prices can only be recorded for manually-priced assets")
    if manual_price.date > date.today():
        raise HTTPException(status_code=400, detail="Price date cannot be in the future")

    existing = db.query(models.MarketPrice).filter(
        models.MarketPrice.ticker == db_asset.ticker,
        models.MarketPrice.date == manual_price.date,
    ).first()
    if existing:
        existing.close_price = manual_price.price
        existing.currency = db_asset.currency
    else:
        db.add(models.MarketPrice(
            id=uuid.uuid7(),
            ticker=db_asset.ticker,
            date=manual_price.date,
            close_price=manual_price.price,
            currency=db_asset.currency,
        ))
    db.commit()

    # Re-run snapshots synchronously (same pattern as /household/{id}/sync) so
    # valuations reflect the new price as soon as the response returns.
    run_snapshot_range(db, manual_price.household_id, manual_price.date, date.today())

    return schemas.ManualPriceResponse(
        ticker=db_asset.ticker,
        date=manual_price.date,
        price=manual_price.price,
        currency=db_asset.currency,
    )

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
        owner_user_id=subportfolio.owner_user_id,
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
    subportfolios = db.query(models.SubPortfolio).filter(
        models.SubPortfolio.household_id == household_id,
        (models.SubPortfolio.owner_user_id.is_(None)) | (models.SubPortfolio.owner_user_id == current_user.id)
    ).all()
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
    verify_private_owner_visibility(sp.owner_user_id, current_user)
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
    verify_private_owner_visibility(db_sp.owner_user_id, current_user)

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
    verify_private_owner_visibility(db_subportfolio.owner_user_id, current_user)

    db.delete(db_subportfolio)
    db.commit()
    return

# --- SUBPORTFOLIO CASH ---

@router.post(
    "/subportfolios/{subportfolio_id}/cash",
    response_model=schemas.TradeResponse,
    status_code=status.HTTP_201_CREATED,
)
def move_subportfolio_cash(
    subportfolio_id: uuid.UUID,
    cash: schemas.SubPortfolioCashCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Deposit cash into or withdraw cash from a sub-portfolio. Recorded as a
    buy/sell trade of the currency's cash pseudo-asset at a price of 1.0, so it
    flows through the same transaction, balance, snapshot, and performance
    pipelines as any other trade.
    """
    db_sp = db.query(models.SubPortfolio).filter(models.SubPortfolio.id == subportfolio_id).first()
    if not db_sp:
        raise HTTPException(status_code=404, detail="Sub-portfolio not found")
    if db_sp.household_id != cash.household_id:
        raise HTTPException(status_code=400, detail="Sub-portfolio does not belong to this household")

    verify_household_access(cash.household_id, current_user, db)
    verify_private_owner_visibility(db_sp.owner_user_id, current_user)

    db_account = db.query(models.FinancialAccount).filter(
        models.FinancialAccount.id == cash.account_id,
        models.FinancialAccount.household_id == cash.household_id,
    ).first()
    if not db_account:
        raise HTTPException(status_code=404, detail="Funding account not found in this household")

    asset = get_or_create_cash_asset(db, cash.currency)

    amount = float(cash.amount)
    if cash.direction == "withdraw":
        balance = get_subportfolio_cash_balance(db, subportfolio_id, asset.id, cash.date.date())
        if balance + 1e-6 < amount:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient cash: {balance:.2f} {asset.currency} available on {cash.date.date()}",
            )

    db_trade = models.Trade(
        id=uuid.uuid7(),
        household_id=cash.household_id,
        sub_portfolio_id=subportfolio_id,
        asset_id=asset.id,
        account_id=cash.account_id,
        trade_type=models.TradeType.buy if cash.direction == "deposit" else models.TradeType.sell,
        date=cash.date,
        quantity=amount,
        price=Decimal("1"),
        currency=asset.currency,
        exchange_rate=cash.exchange_rate,
        description=cash.description,
    )
    db.add(db_trade)
    db.flush()
    sync_trade_transaction(db, db_trade)
    db.commit()
    db.refresh(db_trade)

    # Cash never changes share counts, so no dividend re-sync is needed.
    run_snapshot_range(db, cash.household_id, cash.date.date(), date.today())

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
        description=db_trade.description,
    )

# --- TRADES ---

@router.post("/trades", response_model=schemas.TradeResponse, status_code=status.HTTP_201_CREATED)
def execute_trade(
    trade: schemas.TradeCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    verify_household_access(trade.household_id, current_user, db)

    # Prevent cross-household stitching: a trade may only reference a sub-portfolio
    # and funding account that live in the same household, and the sub-portfolio
    # must be visible to the caller (not another member's private goal). Without
    # this, a user could post a trade whose account_id/sub_portfolio_id belong to
    # a household they can't see, writing transactions into someone else's books.
    sub_portfolio = db.query(models.SubPortfolio).filter(
        models.SubPortfolio.id == trade.sub_portfolio_id,
        models.SubPortfolio.household_id == trade.household_id,
    ).first()
    if not sub_portfolio:
        raise HTTPException(status_code=404, detail="Sub-portfolio not found in this household")
    verify_private_owner_visibility(sub_portfolio.owner_user_id, current_user)

    funding_account = db.query(models.FinancialAccount).filter(
        models.FinancialAccount.id == trade.account_id,
        models.FinancialAccount.household_id == trade.household_id,
    ).first()
    if not funding_account:
        raise HTTPException(status_code=404, detail="Funding account not found in this household")
    verify_private_owner_visibility(funding_account.owner_user_id, current_user)

    if not db.get(models.Asset, trade.asset_id):
        raise HTTPException(status_code=404, detail="Asset not found")

    if trade.settle_from_cash:
        asset = db.query(models.Asset).filter(models.Asset.id == trade.asset_id).first()
        if asset and asset.type == models.CASH_ASSET_TYPE:
            raise HTTPException(status_code=400, detail="Cannot settle a cash movement from cash.")
        if trade.type == models.TradeType.buy:
            account = db.query(models.FinancialAccount).filter(models.FinancialAccount.id == trade.account_id).first()
            if not account:
                raise HTTPException(status_code=404, detail="Funding account not found")
            acc_curr = account.currency or "USD"
            cash_asset = get_or_create_cash_asset(db, acc_curr)
            amount_in_acc = float(Decimal(str(trade.quantity)) * trade.price * Decimal(str(trade.exchange_rate)))
            balance = get_subportfolio_cash_balance(db, trade.sub_portfolio_id, cash_asset.id, trade.date.date())
            if balance + 1e-6 < amount_in_acc:
                raise HTTPException(
                    status_code=400,
                    detail=f"Insufficient cash: {balance:.2f} {acc_curr} available on {trade.date.date()}",
                )

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
        description=trade.description,
    )
    db.add(db_trade)
    db.flush() # Ensure trade is available for sync

    if trade.settle_from_cash:
        settle_trade_from_cash(db, db_trade)
    else:
        sync_trade_transaction(db, db_trade)

    db.commit()
    db.refresh(db_trade)

    # Sync snapshots synchronously for serverless reliability
    run_snapshot_range(db, trade.household_id, trade.date.date(), date.today())
    # Refresh auto-tracked dividends for the affected range (snapshots must be fresh first)
    sync_dividends_range(db, trade.household_id, trade.date.date(), date.today())
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
        settlement_trade_id=db_trade.settlement_trade_id,
        description=db_trade.description,
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
    # Sub-portfolio scoping: a private goal's trades reveal what another member holds.
    trades = db.query(models.Trade).filter(
        models.Trade.household_id == household_id,
        models.Trade.sub_portfolio_id.in_(
            visible_sub_portfolio_ids(db, household_id, current_user)
        ),
    ).all()
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
            settlement_trade_id=t.settlement_trade_id,
            description=t.description,
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

    # A trade that was created cash-settled stays cash-settled; we keep its
    # companion trade in sync rather than exposing settlement mode as editable.
    if db_trade.settlement_trade_id:
        settle_trade_from_cash(db, db_trade)
    else:
        sync_trade_transaction(db, db_trade)

    db.commit()
    db.refresh(db_trade)

    # Sync snapshots synchronously for serverless reliability
    run_snapshot_range(db, db_trade.household_id, recalc_start_date, date.today())
    # Refresh auto-tracked dividends for the affected range
    sync_dividends_range(db, db_trade.household_id, recalc_start_date, date.today())

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
        settlement_trade_id=db_trade.settlement_trade_id,
        description=db_trade.description,
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

    # A cash-settled trade always has a companion leg; delete both together
    # so the sub-portfolio's cash and holdings stay consistent.
    trades_to_delete = [db_trade]
    if db_trade.settlement_trade_id:
        companion = db.query(models.Trade).filter(models.Trade.id == db_trade.settlement_trade_id).first()
        if companion:
            trade_date = min(trade_date, companion.date.date())
            trades_to_delete.append(companion)

    # Break the mutual settlement link before deleting either row.
    for t in trades_to_delete:
        t.settlement_trade_id = None
    db.flush()

    for t in trades_to_delete:
        # Also delete the associated transaction and reverse its impact
        if t.transaction_id:
            db_transaction = db.query(models.Transaction).filter(models.Transaction.id == t.transaction_id).first()
            if db_transaction:
                multiplier = 1 if db_transaction.transaction_type == models.TransactionType.income else -1
                sync_transaction_to_balances(db, db_transaction.account_id, db_transaction.date.date(), -(db_transaction.amount * multiplier))
                ledger_service.delete_entry_for(
                    db, models.JournalSource.transaction, db_transaction.id
                )
                db.delete(db_transaction)
        db.delete(t)

    db.commit()

    # Sync snapshots synchronously for serverless reliability
    run_snapshot_range(db, household_id, trade_date, date.today())
    # Refresh auto-tracked dividends for the affected range
    sync_dividends_range(db, household_id, trade_date, date.today())
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

    sub_portfolio = db.query(models.SubPortfolio).filter(
        models.SubPortfolio.id == subportfolio_id,
        models.SubPortfolio.household_id == snapshot.household_id,
    ).first()
    if not sub_portfolio:
        raise HTTPException(status_code=404, detail="Sub-portfolio not found in this household")
    verify_private_owner_visibility(sub_portfolio.owner_user_id, current_user)

    if not db.get(models.Asset, snapshot.asset_id):
        raise HTTPException(status_code=404, detail="Asset not found")

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
        average_cost_basis=snapshot.average_cost_basis,
        average_cost_basis_home_currency=snapshot.average_cost_basis_home_currency
        if snapshot.average_cost_basis_home_currency is not None
        else (
            snapshot.average_cost_basis * Decimal(str(snapshot.exchange_rate_used))
            if snapshot.average_cost_basis is not None
            else None
        ),
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
        average_cost_basis=db_snapshot.average_cost_basis,
        average_cost_basis_home_currency=db_snapshot.average_cost_basis_home_currency,
    )

def _filter_by_date_range(query, start_date: Optional[date], end_date: Optional[date]):
    if start_date:
        query = query.filter(models.PortfolioSnapshot.date >= start_date)
    if end_date:
        query = query.filter(models.PortfolioSnapshot.date <= end_date)
    return query


def _restrict_to_latest_date(query):
    """Narrows an already-filtered PortfolioSnapshot query to just its own max date."""
    max_date = query.with_entities(func.max(models.PortfolioSnapshot.date)).scalar()
    if max_date is None:
        return query  # already empty — nothing to further restrict
    return query.filter(models.PortfolioSnapshot.date == max_date)


@router.get(
    "/snapshots/household/{household_id}",
    response_model=List[schemas.PortfolioSnapshotResponse],
)
def get_household_portfolio_snapshots(
    household_id: uuid.UUID,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    # Restricts to the single most recent date in the (optionally range-filtered) result set —
    # the shape every "current holdings" consumer actually needs (web Portfolio/Dividends,
    # mobile, iOS DashboardView/PortfolioView/SubPortfolioDetailView) instead of full history.
    latest_only: bool = False,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    verify_household_access(household_id, current_user, db)

    # Scope to sub-portfolios this user may see -- filtering on household alone hands back
    # another member's private holdings (quantities, cost basis and current value).
    query = db.query(models.PortfolioSnapshot).filter(
        models.PortfolioSnapshot.household_id == household_id,
        models.PortfolioSnapshot.sub_portfolio_id.in_(
            visible_sub_portfolio_ids(db, household_id, current_user)
        ),
    )
    query = _filter_by_date_range(query, start_date, end_date)
    if latest_only:
        query = _restrict_to_latest_date(query)

    snapshots = query.all()

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
    "/snapshots/household/{household_id}/timeseries",
    response_model=List[schemas.PortfolioTimeseriesPoint],
)
def get_household_portfolio_timeseries(
    household_id: uuid.UUID,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Pre-aggregated (date, sub_portfolio_id) -> total value, for chart/projection consumers
    (net worth trend, equity curve, goal pace) that don't need per-asset rows. Returns
    O(dates x sub_portfolios) instead of the raw endpoint's O(dates x sub_portfolios x assets).
    """
    verify_household_access(household_id, current_user, db)

    query = db.query(
        models.PortfolioSnapshot.date,
        models.PortfolioSnapshot.sub_portfolio_id,
        func.coalesce(func.sum(models.PortfolioSnapshot.current_value_home_currency), 0).label("total_value_home_currency"),
    ).filter(
        models.PortfolioSnapshot.household_id == household_id,
        models.PortfolioSnapshot.sub_portfolio_id.in_(
            visible_sub_portfolio_ids(db, household_id, current_user)
        ),
    )
    query = _filter_by_date_range(query, start_date, end_date)
    rows = query.group_by(models.PortfolioSnapshot.date, models.PortfolioSnapshot.sub_portfolio_id).all()

    return [
        schemas.PortfolioTimeseriesPoint(
            date=row.date,
            sub_portfolio_id=row.sub_portfolio_id,
            total_value_home_currency=row.total_value_home_currency,
        ) for row in rows
    ]


@router.get(
    "/subportfolios/{subportfolio_id}/snapshot",
    response_model=List[schemas.PortfolioSnapshotResponse],
)
def get_portfolio_snapshots(
    subportfolio_id: uuid.UUID,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    latest_only: bool = False,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_subportfolio = db.query(models.SubPortfolio).filter(models.SubPortfolio.id == subportfolio_id).first()
    if not db_subportfolio:
        raise HTTPException(status_code=404, detail="Sub-portfolio not found")

    verify_household_access(db_subportfolio.household_id, current_user, db)

    query = db.query(models.PortfolioSnapshot).filter(models.PortfolioSnapshot.sub_portfolio_id == subportfolio_id)
    query = _filter_by_date_range(query, start_date, end_date)
    if latest_only:
        query = _restrict_to_latest_date(query)

    snapshots = query.all()

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
        average_cost_basis=db_snapshot.average_cost_basis,
        average_cost_basis_home_currency=db_snapshot.average_cost_basis_home_currency,
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

    sub_portfolio = db.query(models.SubPortfolio).filter(
        models.SubPortfolio.id == dividend.sub_portfolio_id,
        models.SubPortfolio.household_id == dividend.household_id,
    ).first()
    if not sub_portfolio:
        raise HTTPException(status_code=404, detail="Sub-portfolio not found in this household")
    verify_private_owner_visibility(sub_portfolio.owner_user_id, current_user)

    account = db.query(models.FinancialAccount).filter(
        models.FinancialAccount.id == dividend.account_id,
        models.FinancialAccount.household_id == dividend.household_id,
    ).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found in this household")

    if not db.get(models.Asset, dividend.asset_id):
        raise HTTPException(status_code=404, detail="Asset not found")

    db_dividend = models.Dividend(
        id=uuid.uuid7(),
        household_id=dividend.household_id,
        sub_portfolio_id=dividend.sub_portfolio_id,
        asset_id=dividend.asset_id,
        account_id=dividend.account_id,
        date=dividend.date,
        amount=dividend.amount,
        exchange_rate=dividend.exchange_rate,
        is_manual=True,
    )
    db.add(db_dividend)
    db.commit()
    db.refresh(db_dividend)
    return db_dividend


@router.post("/household/{household_id}/dividends/sync", response_model=schemas.DividendSyncResponse, status_code=status.HTTP_200_OK)
def sync_household_dividends(
    household_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Manually trigger an automatic dividend sync for the household. Recomputes
    snapshots from the earliest trade so holdings are current, then records any
    dividends whose ex-dividend date has passed. Idempotent and safe to re-run.
    """
    verify_household_access(household_id, current_user, db)

    sync_start_date = db.execute(
        select(func.min(func.date(models.Trade.date)))
        .where(models.Trade.household_id == household_id)
    ).scalar()

    if not sync_start_date:
        return schemas.DividendSyncResponse(status="no_data", count=0, from_date=None, to_date=None)

    today = date.today()
    # Ensure snapshot holdings are fresh before deriving dividends.
    run_snapshot_range(db, household_id, sync_start_date, today)
    count = sync_dividends_range(db, household_id, sync_start_date, today)
    count += materialize_scheduled_dividends(db, household_id)

    return schemas.DividendSyncResponse(status="success", count=count, from_date=sync_start_date, to_date=today)

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
    # Materialize any coupon/scheduled payments that have come due, so the list
    # is current whenever the Dividends or Portfolio page is opened. Cheap no-op
    # (one indexed query) when nothing is due.
    materialize_scheduled_dividends(db, household_id)
    # Sub-portfolio scoping: payouts disclose the positions behind them.
    dividends = db.query(models.Dividend).filter(
        models.Dividend.household_id == household_id,
        models.Dividend.sub_portfolio_id.in_(
            visible_sub_portfolio_ids(db, household_id, current_user)
        ),
    ).all()
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

# --- SCHEDULED DIVIDENDS (bond coupons, SSB step-up schedules) ---

@router.post(
    "/scheduled-dividends",
    response_model=List[schemas.ScheduledDividendResponse],
    status_code=status.HTTP_201_CREATED,
)
def create_scheduled_dividends(
    items: List[schemas.ScheduledDividendCreate],
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Create one or more scheduled dividend payments (a bond's whole coupon
    calendar in one call — amounts may differ per row for step-up coupons).
    Any rows whose payment date has already passed are materialized immediately.
    """
    if not items:
        raise HTTPException(status_code=400, detail="No scheduled dividends provided")

    household_ids = {item.household_id for item in items}
    if len(household_ids) > 1:
        raise HTTPException(status_code=400, detail="All scheduled dividends must belong to one household")
    household_id = items[0].household_id
    verify_household_access(household_id, current_user, db)

    # Validate referenced entities once (all rows in a batch typically share them).
    for sp_id in {item.sub_portfolio_id for item in items}:
        sp = db.query(models.SubPortfolio).filter(
            models.SubPortfolio.id == sp_id,
            models.SubPortfolio.household_id == household_id,
        ).first()
        if not sp:
            raise HTTPException(status_code=404, detail="Sub-portfolio not found in this household")
    for acc_id in {item.account_id for item in items}:
        acc = db.query(models.FinancialAccount).filter(
            models.FinancialAccount.id == acc_id,
            models.FinancialAccount.household_id == household_id,
        ).first()
        if not acc:
            raise HTTPException(status_code=404, detail="Account not found in this household")
    for asset_id in {item.asset_id for item in items}:
        if not db.get(models.Asset, asset_id):
            raise HTTPException(status_code=404, detail="Asset not found")

    created = []
    for item in items:
        row = models.ScheduledDividend(
            id=uuid.uuid7(),
            household_id=item.household_id,
            sub_portfolio_id=item.sub_portfolio_id,
            asset_id=item.asset_id,
            account_id=item.account_id,
            date=item.date,
            amount=item.amount,
            description=item.description,
        )
        db.add(row)
        created.append(row)
    db.commit()
    for row in created:
        db.refresh(row)

    # Back-dated rows (e.g. a bond bought years ago) become dividends right away.
    materialize_scheduled_dividends(db, household_id)
    for row in created:
        db.refresh(row)
    return created


@router.get(
    "/scheduled-dividends/household/{household_id}",
    response_model=List[schemas.ScheduledDividendResponse],
)
def get_household_scheduled_dividends(
    household_id: uuid.UUID,
    include_materialized: bool = False,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    verify_household_access(household_id, current_user, db)
    query = db.query(models.ScheduledDividend).filter(
        models.ScheduledDividend.household_id == household_id
    )
    if not include_materialized:
        query = query.filter(models.ScheduledDividend.materialized_at.is_(None))
    return query.order_by(models.ScheduledDividend.date.asc()).all()


@router.put("/scheduled-dividends/{scheduled_dividend_id}", response_model=schemas.ScheduledDividendResponse)
def update_scheduled_dividend(
    scheduled_dividend_id: uuid.UUID,
    update: schemas.ScheduledDividendUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    row = db.query(models.ScheduledDividend).filter(models.ScheduledDividend.id == scheduled_dividend_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Scheduled dividend not found")
    verify_household_access(row.household_id, current_user, db)
    if row.materialized_at is not None:
        raise HTTPException(status_code=400, detail="Already paid out — edit the dividend itself instead")

    update_data = update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/scheduled-dividends/{scheduled_dividend_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_scheduled_dividend(
    scheduled_dividend_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    row = db.query(models.ScheduledDividend).filter(models.ScheduledDividend.id == scheduled_dividend_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Scheduled dividend not found")
    verify_household_access(row.household_id, current_user, db)
    db.delete(row)
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


METRICS_BENCHMARK_TICKER = "SPY"

def _refresh_metrics_market_data(db: Session, household_id: uuid.UUID):
    """Best-effort refresh of the risk-free rate (^IRX) and benchmark (SPY)
    series used by performance metrics. Runs as a BackgroundTask (see callers)
    so a stale-cache yfinance round trip never blocks a metrics response."""
    last_rf = db.query(models.MarketPrice).filter(models.MarketPrice.ticker == "^IRX").order_by(models.MarketPrice.date.desc()).first()
    if not last_rf or last_rf.date < date.today() - timedelta(days=2):
        try:
            fetch_and_cache_treasury_rates(db)
        except Exception as e:
            print(f"Failed to fetch treasury rates: {e}")

    last_bench = db.query(models.MarketPrice).filter(models.MarketPrice.ticker == METRICS_BENCHMARK_TICKER).order_by(models.MarketPrice.date.desc()).first()
    if not last_bench or last_bench.date < date.today() - timedelta(days=2):
        try:
            earliest_snapshot = db.query(func.min(models.PortfolioSnapshot.date)).filter(
                models.PortfolioSnapshot.household_id == household_id
            ).scalar()
            if earliest_snapshot:
                fetch_and_cache_market_prices_range(
                    db, [METRICS_BENCHMARK_TICKER], earliest_snapshot, date.today()
                )
        except Exception as e:
            print(f"Failed to fetch benchmark prices: {e}")


def _refresh_metrics_market_data_background(household_id: uuid.UUID):
    """
    BackgroundTasks entry point: opens its own DB session since the
    request-scoped session from `Depends(get_db)` is already closed by the
    time a background task runs (it executes after the response is sent).
    """
    db = SessionLocal()
    try:
        _refresh_metrics_market_data(db, household_id)
    finally:
        db.close()


# Note: This is where we will eventually put the Polars math endpoints!
@router.get("/household/{household_id}/metrics", response_model=schemas.PortfolioMetricsResponse)
def get_portfolio_metrics(
    household_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    verify_household_access(household_id, current_user, db)

    # Best-effort ^IRX/SPY refresh happens off the request path — it only
    # matters once a day and must never add a yfinance round trip to a page load.
    background_tasks.add_task(_refresh_metrics_market_data_background, household_id)

    def compute() -> schemas.PortfolioMetricsResponse:
        # Fetched once and shared across the overall + every sub-portfolio
        # calculation below instead of once per call (same query, same result).
        rf_bench_rows = fetch_rf_and_benchmark_rows(db, METRICS_BENCHMARK_TICKER)

        overall = calculate_performance_metrics(
            db, household_id, start_date=start_date, end_date=end_date, rf_bench_rows=rf_bench_rows
        )

        sub_portfolios = db.query(models.SubPortfolio).filter(models.SubPortfolio.household_id == household_id).all()
        sub_metrics = []
        for sp in sub_portfolios:
            metrics = calculate_performance_metrics(
                db, household_id, sub_portfolio_id=sp.id, start_date=start_date, end_date=end_date,
                rf_bench_rows=rf_bench_rows,
            )
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

    cache_key = f"household:{household_id}:metrics:{start_date}:{end_date}"
    return cache_get_or_compute(cache_key, compute)

@router.get("/subportfolios/{subportfolio_id}/metrics", response_model=schemas.PerformanceMetrics)
def get_subportfolio_metrics(
    subportfolio_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_subportfolio = db.query(models.SubPortfolio).filter(models.SubPortfolio.id == subportfolio_id).first()
    if not db_subportfolio:
        raise HTTPException(status_code=404, detail="Sub-portfolio not found")

    verify_household_access(db_subportfolio.household_id, current_user, db)

    background_tasks.add_task(_refresh_metrics_market_data_background, db_subportfolio.household_id)

    cache_key = f"household:{db_subportfolio.household_id}:subportfolio_metrics:{subportfolio_id}:{start_date}:{end_date}"
    metrics = cache_get_or_compute(cache_key, lambda: calculate_performance_metrics(
        db,
        db_subportfolio.household_id,
        sub_portfolio_id=subportfolio_id,
        start_date=start_date,
        end_date=end_date
    ))
    return metrics
