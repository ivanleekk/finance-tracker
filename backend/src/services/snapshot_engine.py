import logging
import uuid
from datetime import date
from sqlalchemy.orm import Session
from sqlalchemy import func, select, desc

from src.models import Trade, PortfolioSnapshot, Asset, MarketPrice, TradeType, SubPortfolio
from src.services.market_data import fetch_and_cache_market_prices

logger = logging.getLogger(__name__)

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
