import logging
import uuid
from datetime import date, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import func, select, desc, delete

from src.models import Trade, PortfolioSnapshot, Asset, MarketPrice, TradeType, SubPortfolio
from src.services.market_data import fetch_and_cache_market_prices, fetch_and_cache_market_prices_range

logger = logging.getLogger(__name__)

def run_snapshot_range(db: Session, household_id: uuid.UUID, start_date: date, end_date: date):
    """
    Calculates and stores daily snapshots for all sub-portfolios in a household over a date range.
    """
    logger.info(f"Running snapshot range for household {household_id} from {start_date} to {end_date}")
    
    # 1. Identify all tickers in the household
    assets_traded = db.execute(
        select(Asset.ticker)
        .join(Trade, Trade.asset_id == Asset.id)
        .where(Trade.household_id == household_id)
        .distinct()
    ).scalars().all()
    
    if not assets_traded:
        return

    # 2. Bulk fetch market data for the range
    fetch_and_cache_market_prices_range(db, list(assets_traded), start_date, end_date)
    
    # 3. Process each day in the range
    current_date = start_date
    while current_date <= end_date:
        # We can reuse the single-day logic, but optimized:
        # Since we are running in sequence, we can keep track of quantities in memory
        # however for simplicity and robustness (handling manual edits), 
        # we'll just iterate and call run_daily_snapshot or similar logic.
        # But wait, run_daily_snapshot processes ALL households.
        # Let's create a targeted version for a specific sub-portfolio/household.
        run_daily_snapshot_targeted(db, household_id, current_date)
        current_date += timedelta(days=1)

def run_daily_snapshot_targeted(db: Session, household_id: uuid.UUID, target_date: date):
    """
    Calculates snapshots for a specific household on a specific date.
    """
    # Load market prices for target_date
    market_prices = dict(
        db.execute(
            select(MarketPrice.ticker, MarketPrice.close_price)
            .where(MarketPrice.date <= target_date)
            .order_by(MarketPrice.ticker, desc(MarketPrice.date))
            .distinct(MarketPrice.ticker) # Get most recent available price up to target_date
        ).all()
    )
    
    # Identify sub-portfolios for this household
    sub_portfolios = db.execute(
        select(SubPortfolio.id)
        .where(SubPortfolio.household_id == household_id)
    ).scalars().all()
    
    asset_id_map = dict(db.execute(select(Asset.id, Asset.ticker)).all())

    for sp_id in sub_portfolios:
        # Get all assets ever traded in this sub-portfolio up to target_date
        sp_assets = db.execute(
            select(Trade.asset_id)
            .where(Trade.sub_portfolio_id == sp_id)
            .where(func.date(Trade.date) <= target_date)
            .distinct()
        ).scalars().all()
        
        for asset_id in sp_assets:
            # Calculate quantity by summing all trades up to target_date
            trades = db.execute(
                select(Trade)
                .where(Trade.sub_portfolio_id == sp_id)
                .where(Trade.asset_id == asset_id)
                .where(func.date(Trade.date) <= target_date)
                .order_by(Trade.date)
            ).scalars().all()
            
            current_quantity = 0.0
            total_cost = 0.0
            avg_cost_basis = 0.0
            
            for t in trades:
                q = float(t.quantity)
                p = float(t.price)
                if t.trade_type == TradeType.buy:
                    current_quantity += q
                    total_cost += q * p
                elif t.trade_type == TradeType.sell:
                    current_quantity -= q
                    total_cost -= q * avg_cost_basis
                
                if current_quantity > 0:
                    avg_cost_basis = total_cost / current_quantity
                else:
                    avg_cost_basis = 0.0
                    total_cost = 0.0
            
            # If position is 0 and was 0, skip (unless it was non-zero before today)
            # Actually, to be safe and provide a clean curve, we only skip if it has NEVER been non-zero.
            if current_quantity == 0:
                # Check if there were previous snapshots with quantity > 0
                has_history = db.execute(
                    select(PortfolioSnapshot)
                    .where(PortfolioSnapshot.sub_portfolio_id == sp_id)
                    .where(PortfolioSnapshot.asset_id == asset_id)
                    .where(PortfolioSnapshot.quantity > 0)
                    .limit(1)
                ).scalar_one_or_none()
                if not has_history:
                    continue

            ticker = asset_id_map[asset_id]
            current_price = float(market_prices.get(ticker, 0.0))
            current_value = current_quantity * current_price
            
            # Upsert snapshot
            existing = db.execute(
                select(PortfolioSnapshot)
                .where(PortfolioSnapshot.sub_portfolio_id == sp_id)
                .where(PortfolioSnapshot.asset_id == asset_id)
                .where(PortfolioSnapshot.date == target_date)
            ).scalar_one_or_none()
            
            if existing:
                existing.quantity = current_quantity
                existing.current_price = current_price
                existing.current_value_home_currency = current_value
                existing.average_cost_basis = avg_cost_basis
            else:
                db.add(PortfolioSnapshot(
                    id=uuid.uuid7(),
                    household_id=household_id,
                    sub_portfolio_id=sp_id,
                    asset_id=asset_id,
                    date=target_date,
                    quantity=current_quantity,
                    current_price=current_price,
                    exchange_rate_used=1.0,
                    current_value_home_currency=current_value,
                    average_cost_basis=avg_cost_basis
                ))
    
    db.commit()

def run_daily_snapshot(db: Session, target_date: date):
    """
    Calculates and stores the daily portfolio snapshots for all sub-portfolios.
    It derives the exact current quantity of assets based on trades and previous snapshots,
    fetches the latest market prices, and records the current value.
    """
    logger.info(f"Starting daily snapshot engine for {target_date}")
    
    # 1. Identify all unique assets traded up to target_date
    assets_traded = db.execute(
        select(Asset.id, Asset.ticker)
        .join(Trade, Trade.asset_id == Asset.id)
        .where(func.date(Trade.date) <= target_date)
        .distinct()
    ).all()
    
    if not assets_traded:
        logger.info("No trades found. Skipping snapshot.")
        return

    tickers = [asset.ticker for asset in assets_traded]
    asset_id_map = {asset.id: asset.ticker for asset in assets_traded}
    
    # 2. Call Market Data Service to cache today's global prices
    try:
        fetch_and_cache_market_prices(db, tickers, target_date)
    except Exception as e:
        logger.error(f"Failed to fetch market prices: {e}")
        # Proceeding anyway as some prices might already be cached or we use 0
        
    # Load market prices for target_date
    market_prices = dict(
        db.execute(
            select(MarketPrice.ticker, MarketPrice.close_price)
            .where(MarketPrice.date == target_date)
        ).all()
    )
    
    # 3. For each sub-portfolio, calculate the current quantity
    sub_portfolios = db.execute(
        select(SubPortfolio.id, SubPortfolio.household_id)
        .join(Trade, Trade.sub_portfolio_id == SubPortfolio.id)
        .distinct()
    ).all()
    
    for sp_id, household_id in sub_portfolios:
        try:
            # Wrap each sub-portfolio calculation in a nested transaction (SAVEPOINT)
            # so if one fails, it rolls back just this sub-portfolio without breaking the entire run.
            with db.begin_nested():
                # Get distinct assets in this sub-portfolio
                sp_assets = db.execute(
                    select(Trade.asset_id)
                    .where(Trade.sub_portfolio_id == sp_id)
                    .where(func.date(Trade.date) <= target_date)
                    .distinct()
                ).scalars().all()
                
                for asset_id in sp_assets:
                    # Find the most recent snapshot prior to target_date
                    last_snapshot = db.execute(
                        select(PortfolioSnapshot)
                        .where(PortfolioSnapshot.sub_portfolio_id == sp_id)
                        .where(PortfolioSnapshot.asset_id == asset_id)
                        .where(PortfolioSnapshot.date < target_date)
                        .order_by(desc(PortfolioSnapshot.date))
                        .limit(1)
                    ).scalar_one_or_none()
                    
                    last_date = last_snapshot.date if last_snapshot else date.min
                    start_quantity = last_snapshot.quantity if last_snapshot else 0.0
                    start_cost_basis = float(last_snapshot.average_cost_basis) if last_snapshot else 0.0
                    
                    # Get trades since last_date up to target_date
                    trades = db.execute(
                        select(Trade)
                        .where(Trade.sub_portfolio_id == sp_id)
                        .where(Trade.asset_id == asset_id)
                        .where(func.date(Trade.date) > last_date)
                        .where(func.date(Trade.date) <= target_date)
                        .order_by(Trade.date)
                    ).scalars().all()
                    
                    current_quantity = start_quantity
                    total_cost = start_quantity * start_cost_basis
                    
                    # Calculate new quantity and cost basis
                    for t in trades:
                        q = float(t.quantity)
                        p = float(t.price)
                        if t.trade_type == TradeType.buy:
                            current_quantity += q
                            total_cost += q * p
                        elif t.trade_type == TradeType.sell:
                            current_quantity -= q
                            # Cost basis doesn't change on sell, just proportionally remove cost
                            total_cost -= q * start_cost_basis
                            
                        # Recalculate average cost basis if we hold shares
                        if current_quantity > 0:
                            start_cost_basis = total_cost / current_quantity
                        else:
                            start_cost_basis = 0.0
                            total_cost = 0.0
                            
                    ticker = asset_id_map[asset_id]
                    current_price = float(market_prices.get(ticker, 0.0))
                    
                    # If the position is 0 and was already 0 in the last snapshot, skip inserting
                    if current_quantity == 0 and start_quantity == 0:
                        continue
                        
                    current_value = current_quantity * current_price
                    
                    # Insert or update snapshot for target_date
                    existing_snapshot = db.execute(
                        select(PortfolioSnapshot)
                        .where(PortfolioSnapshot.sub_portfolio_id == sp_id)
                        .where(PortfolioSnapshot.asset_id == asset_id)
                        .where(PortfolioSnapshot.date == target_date)
                    ).scalar_one_or_none()
                    
                    if existing_snapshot:
                        existing_snapshot.quantity = current_quantity
                        existing_snapshot.current_price = current_price
                        existing_snapshot.current_value_home_currency = current_value
                        existing_snapshot.average_cost_basis = start_cost_basis
                    else:
                        new_snapshot = PortfolioSnapshot(
                            id=uuid.uuid7(),
                            household_id=household_id,
                            sub_portfolio_id=sp_id,
                            asset_id=asset_id,
                            date=target_date,
                            quantity=current_quantity,
                            current_price=current_price,
                            exchange_rate_used=1.0,
                            current_value_home_currency=current_value,
                            average_cost_basis=start_cost_basis
                        )
                        db.add(new_snapshot)
        except Exception as e:
            logger.error(f"Error processing sub-portfolio {sp_id}: {e}")
            # db.begin_nested() context manager handles rollback to savepoint automatically
            
    try:
        db.commit()
        logger.info(f"Successfully completed daily snapshot engine for {target_date}")
    except Exception as e:
        db.rollback()
        logger.error(f"Database error during final commit of snapshot engine: {e}")
        raise
