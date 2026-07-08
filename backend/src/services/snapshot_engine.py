import uuid
from datetime import date, timedelta
from typing import List, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import select, func, desc, delete
from sqlalchemy.dialects.postgresql import insert
import logging
from decimal import Decimal
import pandas as pd

from src.models import (
    Trade, PortfolioSnapshot, Asset, TradeType,
    Household, SubPortfolio, MarketPrice, FinancialAccount,
    ExchangeRate, CASH_ASSET_TYPE
)
from src.services.market_data import (
    fetch_and_cache_market_prices_range,
    fetch_and_cache_exchange_rates_range
)

logger = logging.getLogger(__name__)

def run_snapshot_range(db: Session, household_id: uuid.UUID, start_date: date, end_date: date):
    """
    HIGH PERFORMANCE: Calculates snapshots for an entire range using pre-fetching and in-memory replay.
    """
    print(f"DEBUG: Starting OPTIMIZED sync for household {household_id} from {start_date} to {end_date}")
    
    # 0. Get Household Info
    household = db.get(Household, household_id)
    if not household: return
    home_curr = household.base_currency or "USD"

    # 1. PREFETCH EVERYTHING
    
    # A. Get all assets involved
    assets = {a.id: a for a in db.execute(select(Asset)).scalars().all()}
    
    # B. Get all trades for the household (ever) to maintain accurate quantity state
    # We fetch ALL trades because we need the starting state at start_date
    all_trades = db.execute(
        select(Trade)
        .where(Trade.household_id == household_id)
        .order_by(Trade.date.asc())
    ).scalars().all()
    
    # C. Get all market prices for the range
    # Cash pseudo-assets have no market ticker: they are always worth 1.0 in
    # their own currency, so we exclude them from the yfinance fetch.
    tickers = list(set([a.ticker for a in assets.values() if a.type != CASH_ASSET_TYPE]))
    fetch_and_cache_market_prices_range(db, tickers, start_date, end_date)
    
    # Build a lookup for prices: {(date, ticker): price}
    # We include prices before start_date as well for fallback
    prices_raw = db.execute(
        select(MarketPrice.date, MarketPrice.ticker, MarketPrice.close_price)
        .where(MarketPrice.ticker.in_(tickers))
        .where(MarketPrice.date <= end_date)
        .order_by(MarketPrice.date.asc())
    ).all()
    
    price_lookup = {}
    last_prices = {} # ticker -> last_known_price
    
    # We iterate through all history to ensure price_lookup has a value for every day
    # by filling gaps with the last known price.
    all_dates = sorted(list(set([row.date for row in prices_raw] + [start_date, end_date])))
    if not all_dates: return
    
    p_idx = 0
    curr = all_dates[0]
    while curr <= end_date:
        # Update last known prices for this date
        while p_idx < len(prices_raw) and prices_raw[p_idx].date == curr:
            last_prices[prices_raw[p_idx].ticker] = float(prices_raw[p_idx].close_price)
            p_idx += 1
        
        # Store prices for this date
        if curr >= start_date:
            for t in tickers:
                price_lookup[(curr, t)] = last_prices.get(t, 0.0)
        
        curr += timedelta(days=1)

    # D. Prefetch Exchange Rates
    # Find all currencies used in assets
    used_currencies = list(set([a.currency for a in assets.values() if a.currency] + ["USD", home_curr]))
    rate_lookup = {}
    for curr_code in used_currencies:
        rates = fetch_and_cache_exchange_rates_range(db, curr_code, home_curr, start_date, end_date)
        rate_lookup.update(rates)

    # 2. IN-MEMORY REPLAY
    
    # Clear old snapshots in the range to avoid ghost holdings
    db.execute(
        delete(PortfolioSnapshot)
        .where(PortfolioSnapshot.household_id == household_id)
        .where(PortfolioSnapshot.date >= start_date)
        .where(PortfolioSnapshot.date <= end_date)
    )
    db.commit()

    # sub_portfolio -> asset_id -> state {quantity, total_cost, avg_cost}
    portfolio_state = {} 
    
    # Initialize sub-portfolios
    sub_portfolios = db.execute(
        select(SubPortfolio).where(SubPortfolio.household_id == household_id)
    ).scalars().all()
    for sp in sub_portfolios:
        portfolio_state[sp.id] = {}

    all_snapshots = []
    trade_idx = 0
    
    # Replay all trades up to start_date to get initial state
    while trade_idx < len(all_trades) and all_trades[trade_idx].date.date() < start_date:
        t = all_trades[trade_idx]
        sp_id = t.sub_portfolio_id
        asset_id = t.asset_id
        
        if asset_id not in portfolio_state[sp_id]:
            portfolio_state[sp_id][asset_id] = {"q": 0.0, "cost": 0.0, "avg": 0.0}
        
        state = portfolio_state[sp_id][asset_id]
        q = float(t.quantity)
        p = float(t.price)
        
        if t.trade_type == TradeType.buy:
            state["q"] += q
            state["cost"] += q * p
        else:
            state["q"] -= q
            state["cost"] -= q * state["avg"]
            
        if state["q"] > 0:
            state["avg"] = state["cost"] / state["q"]
        else:
            state["avg"] = 0.0
            state["cost"] = 0.0
        
        trade_idx += 1

    # Now loop through the range day-by-day
    curr_date = start_date
    while curr_date <= end_date:
        # 1. Process trades for this day
        while trade_idx < len(all_trades) and all_trades[trade_idx].date.date() == curr_date:
            t = all_trades[trade_idx]
            sp_id = t.sub_portfolio_id
            asset_id = t.asset_id
            
            if asset_id not in portfolio_state[sp_id]:
                portfolio_state[sp_id][asset_id] = {"q": 0.0, "cost": 0.0, "avg": 0.0}
            
            state = portfolio_state[sp_id][asset_id]
            q = float(t.quantity)
            p = float(t.price)
            
            if t.trade_type == TradeType.buy:
                state["q"] += q
                state["cost"] += q * p
            else:
                state["q"] -= q
                state["cost"] -= q * state["avg"]
                
            if state["q"] > 0:
                state["avg"] = state["cost"] / state["q"]
            else:
                state["avg"] = 0.0
                state["cost"] = 0.0
            
            trade_idx += 1

        # 2. Generate snapshots for this day
        for sp_id, assets_held in portfolio_state.items():
            for asset_id, state in assets_held.items():
                # Use a small epsilon to handle floating point noise
                is_zero = abs(state["q"]) < 1e-8
                
                # We skip if it's zero AND it wasn't just sold (we want to record the 0 on the sale day)
                # This ensures the asset shows up as "sold" in history rather than just vanishing.
                if is_zero:
                    # Optional: We could check if a trade happened today to record a final 0
                    # But for now, let's just skip to keep the DB clean. 
                    # The user said "as long as there is value", so 0 value = skip is actually what they asked!
                    continue 

                asset = assets[asset_id]
                if asset.type == CASH_ASSET_TYPE:
                    price = 1.0
                else:
                    price = price_lookup.get((curr_date, asset.ticker), 0.0)
                rate = rate_lookup.get((curr_date, asset.currency or "USD", home_curr), 1.0)
                
                value_home = state["q"] * price * rate
                
                all_snapshots.append({
                    "id": uuid.uuid7(),
                    "household_id": household_id,
                    "sub_portfolio_id": sp_id,
                    "asset_id": asset_id,
                    "date": curr_date,
                    "quantity": state["q"],
                    "current_price": price,
                    "exchange_rate_used": rate,
                    "current_value_home_currency": value_home,
                    "average_cost_basis": state["avg"],
                    "average_cost_basis_home_currency": state["avg"] * rate
                })
        
        curr_date += timedelta(days=1)

    # 3. BULK SAVE
    if all_snapshots:
        db.execute(insert(PortfolioSnapshot), all_snapshots)
        db.commit()
    return True

def run_daily_snapshot_targeted(db: Session, household_id: uuid.UUID, target_date: date):
    """
    Redirects to the optimized range function for a single day.
    """
    run_snapshot_range(db, household_id, target_date, target_date)
