import logging
import uuid
from datetime import date, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import func, select, desc, delete

from src.models import (
    Trade, PortfolioSnapshot, Asset, MarketPrice, TradeType, SubPortfolio, 
    Household, FinancialAccount, AccountBalance
)
from src.services.market_data import (
    fetch_and_cache_market_prices, 
    fetch_and_cache_market_prices_range,
    fetch_and_cache_exchange_rates
)

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
        run_daily_snapshot_targeted(db, household_id, current_date)
        current_date += timedelta(days=1)

def run_daily_snapshot_targeted(db: Session, household_id: uuid.UUID, target_date: date):
    """
    Calculates snapshots for a specific household on a specific date.
    Now includes currency conversion for all assets and cash balances.
    """
    # 0. Get Household Base Currency
    household = db.get(Household, household_id)
    if not household:
        return
    home_curr = household.base_currency or "USD"

    # 1. Update Account Balances Home Currency Value
    accounts = db.execute(
        select(FinancialAccount)
        .where(FinancialAccount.household_id == household_id)
    ).scalars().all()

    for acc in accounts:
        # Find the balance record for this date (or most recent)
        balance_rec = db.execute(
            select(AccountBalance)
            .where(AccountBalance.account_id == acc.id)
            .where(AccountBalance.date <= target_date)
            .order_by(desc(AccountBalance.date))
            .limit(1)
        ).scalar_one_or_none()

        if balance_rec:
            acc_curr = acc.currency or "USD"
            rate = fetch_and_cache_exchange_rates(db, acc_curr, home_curr, target_date)
            balance_rec.balance_home_currency = float(balance_rec.balance) * rate

    # 2. Portfolio Snapshots
    # Load market prices for target_date
    market_prices = dict(
        db.execute(
            select(MarketPrice.ticker, MarketPrice.close_price)
            .where(MarketPrice.date <= target_date)
            .order_by(MarketPrice.ticker, desc(MarketPrice.date))
            .distinct(MarketPrice.ticker)
        ).all()
    )
    
    # Identify sub-portfolios for this household
    sub_portfolios = db.execute(
        select(SubPortfolio.id)
        .where(SubPortfolio.household_id == household_id)
    ).scalars().all()
    
    asset_map = {a.id: a for a in db.execute(select(Asset)).scalars().all()}

    for sp_id in sub_portfolios:
        # Get all assets ever traded in this sub-portfolio up to target_date
        sp_assets = db.execute(
            select(Trade.asset_id)
            .where(Trade.sub_portfolio_id == sp_id)
            .where(func.date(Trade.date) <= target_date)
            .distinct()
        ).scalars().all()
        
        for asset_id in sp_assets:
            asset = asset_map[asset_id]
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
            
            if current_quantity == 0:
                has_history = db.execute(
                    select(PortfolioSnapshot)
                    .where(PortfolioSnapshot.sub_portfolio_id == sp_id)
                    .where(PortfolioSnapshot.asset_id == asset_id)
                    .where(PortfolioSnapshot.quantity > 0)
                    .limit(1)
                ).scalar_one_or_none()
                if not has_history:
                    continue

            current_price = float(market_prices.get(asset.ticker, 0.0))
            
            # Currency Conversion for Portfolio
            asset_curr = asset.currency or "USD"
            rate = fetch_and_cache_exchange_rates(db, asset_curr, home_curr, target_date)
            current_value_home = current_quantity * current_price * rate
            
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
                existing.exchange_rate_used = rate
                existing.current_value_home_currency = current_value_home
                existing.average_cost_basis = avg_cost_basis
                existing.average_cost_basis_home_currency = avg_cost_basis * rate
            else:
                db.add(PortfolioSnapshot(
                    id=uuid.uuid7(),
                    household_id=household_id,
                    sub_portfolio_id=sp_id,
                    asset_id=asset_id,
                    date=target_date,
                    quantity=current_quantity,
                    current_price=current_price,
                    exchange_rate_used=rate,
                    current_value_home_currency=current_value_home,
                    average_cost_basis=avg_cost_basis,
                    average_cost_basis_home_currency=avg_cost_basis * rate
                ))
    
    db.commit()

def run_daily_snapshot(db: Session, target_date: date):
    """
    Calculates and stores the daily portfolio snapshots for all sub-portfolios.
    Standardized to use the targeted logic per household to handle currency conversion.
    """
    logger.info(f"Starting global daily snapshot engine for {target_date}")
    
    # Identify all households with at least one trade or balance
    households = db.execute(select(Household.id)).scalars().all()
    
    for household_id in households:
        try:
            run_daily_snapshot_targeted(db, household_id, target_date)
        except Exception as e:
            logger.error(f"Failed to run daily snapshot for household {household_id}: {e}")
            
    logger.info(f"Completed global daily snapshot engine for {target_date}")
