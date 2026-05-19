import polars as pl
import numpy as np
from datetime import date
from sqlalchemy.orm import Session
from sqlalchemy import select, func
import uuid
from typing import List, Optional, Dict

from src.models import Trade, PortfolioSnapshot, MarketPrice, TradeType
from src import schemas

def calculate_performance_metrics(
    db: Session, 
    household_id: uuid.UUID, 
    sub_portfolio_id: Optional[uuid.UUID] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    risk_free_rate: float = 0.04,
    benchmark_ticker: str = "SPY"
) -> schemas.PerformanceMetrics:
    """
    Calculates comprehensive performance metrics using Polars and NumPy.
    """
    
    # 1. Fetch Snapshots (Daily Equity Curve)
    snapshot_query = select(
        PortfolioSnapshot.date,
        func.sum(PortfolioSnapshot.current_value_home_currency).label("total_value")
    ).where(PortfolioSnapshot.household_id == household_id)
    
    if sub_portfolio_id:
        snapshot_query = snapshot_query.where(PortfolioSnapshot.sub_portfolio_id == sub_portfolio_id)
    
    snapshot_query = snapshot_query.group_by(PortfolioSnapshot.date).order_by(PortfolioSnapshot.date)
    
    snapshots = db.execute(snapshot_query).all()
    if not snapshots:
        return _empty_metrics()

    df_snapshots = pl.DataFrame([
        {"date": s.date, "total_value": float(s.total_value)} for s in snapshots
    ]).with_columns(pl.col("date").cast(pl.Date))

    # 2. Fetch Trades (Cash Flows)
    trade_query = select(
        func.date(Trade.date).label("date"),
        Trade.trade_type,
        (Trade.quantity * Trade.price * Trade.exchange_rate).label("amount")
    ).where(Trade.household_id == household_id)
    
    if sub_portfolio_id:
        trade_query = trade_query.where(Trade.sub_portfolio_id == sub_portfolio_id)
        
    trades = db.execute(trade_query).all()
    
    cash_flows = []
    for t in trades:
        # MWR CF convention: Negative = Investment (Outflow from wallet), Positive = Withdrawal (Inflow to wallet)
        cf_amount = -float(t.amount) if t.trade_type == TradeType.buy else float(t.amount)
        cash_flows.append({"date": t.date, "amount": cf_amount})

    df_cf = pl.DataFrame(cash_flows) if cash_flows else pl.DataFrame(schema={"date": pl.Date, "amount": pl.Float64})
    if not df_cf.is_empty():
        df_cf = df_cf.with_columns(pl.col("date").cast(pl.Date)).group_by("date").agg(pl.sum("amount"))

    # --- Calculation Engine ---

    # Join snapshots and cash flows for the full history
    # This is crucial for calculating returns for the "first day" of a filtered window
    df_history = df_snapshots.join(df_cf, on="date", how="left").fill_null(0.0)
    df_history = df_history.with_columns([
        pl.col("total_value").shift(1).alias("prev_value")
    ])

    # Calculate Daily Returns for ALL historical data first
    # return_t = (Value_t + CF_t) / Value_t-1
    # Note: df_cf amount is negative for Buys (contributions), so we subtract it to get gain
    # Actually, if amount is -100 (Buy), then Value_t includes that 100.
    # To get performance: (Value_t - amount) / Value_t-1
    # Example: prev=1000, buy=100, new_val=1110. Return = (1110 - 100) / 1000 = 1.01 (1%)
    df_history = df_history.with_columns([
        ((pl.col("total_value") - pl.col("amount")) / pl.col("prev_value") - 1.0)
        .fill_null(0.0)
        .alias("daily_return")
    ])

    # Now filter by the requested timeframe
    df_filtered = df_history
    if start_date:
        df_filtered = df_filtered.filter(pl.col("date") >= start_date)
    if end_date:
        df_filtered = df_filtered.filter(pl.col("date") <= end_date)

    if df_filtered.is_empty():
        return _empty_metrics()

    # --- A. Time-Weighted Return (TWR) ---
    # TWR in the window is the product of (1 + daily_return)
    twr_cumulative = (df_filtered["daily_return"] + 1.0).product() - 1.0

    # --- B. Annualized TWR ---
    days_in_window = (df_filtered["date"].max() - df_filtered["date"].min()).days
    years_in_window = days_in_window / 365.25 if days_in_window > 0 else 0
    
    # If timeframe is very short (< 1 day), we just show the cumulative return
    if years_in_window > 0 and twr_cumulative > -1:
        ann_twr = (1 + twr_cumulative)**(1 / years_in_window) - 1
    else:
        ann_twr = twr_cumulative

    # --- C. Simple Return ---
    # Total Value / Total Contributions (within window, starting from base value)
    start_val = df_filtered["total_value"].head(1).item()
    end_val = df_filtered["total_value"].tail(1).item()
    # Net contributions in the window (excluding the starting balance)
    # Filter cf to the window
    df_cf_window = df_cf
    if start_date:
        df_cf_window = df_cf_window.filter(pl.col("date") > start_date) # Only CFs *after* the start date
    if end_date:
        df_cf_window = df_cf_window.filter(pl.col("date") <= end_date)
    
    net_cf_window = -df_cf_window["amount"].sum() if not df_cf_window.is_empty() else 0.0
    denominator = start_val + net_cf_window
    simple_return = (end_val - denominator) / denominator if denominator > 0 else 0.0

    # --- D. Money-Weighted Return (MWR / IRR) ---
    mwr_cfs = []
    if not df_cf_window.is_empty():
        mwr_cfs = df_cf_window.to_dicts()
    
    # Initial "outflow" (starting value of portfolio at the beginning of window)
    if start_val > 0:
        mwr_cfs.append({"date": df_filtered["date"].head(1).item(), "amount": -start_val})
    
    # Final "inflow" (ending value of portfolio)
    if end_val > 0:
        mwr_cfs.append({"date": df_filtered["date"].tail(1).item(), "amount": end_val})
    
    mwr = _calculate_xirr(mwr_cfs)

    # --- E. Volatility & Risk Ratios ---
    daily_vol = df_filtered["daily_return"].std()
    annualized_vol = float(daily_vol) * np.sqrt(252) if daily_vol is not None else 0.0

    # Risk-Free Rate Fetching
    rf_query = select(MarketPrice.date, MarketPrice.close_price).where(MarketPrice.ticker == "^IRX")
    rf_results = db.execute(rf_query).all()
    effective_rf = 0.02 # Default
    if rf_results:
        df_rf = pl.DataFrame([{"date": r.date, "rf_rate": float(r.close_price)} for r in rf_results])
        df_rf = df_rf.with_columns(pl.col("date").cast(pl.Date))
        df_metrics_rf = df_filtered.join(df_rf, on="date", how="left").fill_null(strategy="forward").fill_null(0.02)
        effective_rf = df_metrics_rf["rf_rate"].mean() if not df_metrics_rf.is_empty() else 0.02

    sharpe = (ann_twr - effective_rf) / annualized_vol if annualized_vol > 0 else 0.0

    # Sortino
    downside_returns = df_filtered.filter(pl.col("daily_return") < 0)["daily_return"]
    ds_std = downside_returns.std()
    downside_vol = float(ds_std) * np.sqrt(252) if ds_std is not None else 0.0
    sortino = (ann_twr - effective_rf) / downside_vol if downside_vol > 0 else (0.0 if (ann_twr - effective_rf) <= 0 else 100.0)

    return schemas.PerformanceMetrics(
        simple_return=simple_return,
        time_weighted_return=ann_twr,
        money_weighted_return=mwr,
        volatility=annualized_vol,
        sharpe_ratio=sharpe,
        sortino_ratio=sortino,
        treynor_ratio=(ann_twr - effective_rf) / 1.0, # Default beta=1
        beta=1.0
    )

def _empty_metrics() -> schemas.PerformanceMetrics:
    return schemas.PerformanceMetrics(
        simple_return=0.0,
        time_weighted_return=0.0,
        money_weighted_return=0.0,
        volatility=0.0,
        sharpe_ratio=0.0,
        sortino_ratio=0.0,
        treynor_ratio=0.0,
        beta=1.0
    )

def _calculate_xirr(cash_flows: List[Dict], guess: float = 0.1) -> float:
    if not cash_flows:
        return 0.0
    
    amounts = [cf["amount"] for cf in cash_flows if abs(cf["amount"]) > 1e-6]
    if not amounts or all(a >= 0 for a in amounts) or all(a <= 0 for a in amounts):
        return 0.0
        
    start_date = min(cf["date"] for cf in cash_flows)
    
    def npv(rate):
        total = 0.0
        safe_rate = max(rate, -0.999)
        for cf in cash_flows:
            d = (cf["date"] - start_date).days
            total += cf["amount"] / (1 + safe_rate)**(d / 365.25)
        return total

    def npv_der(rate):
        total = 0.0
        safe_rate = max(rate, -0.999)
        for cf in cash_flows:
            d = (cf["date"] - start_date).days
            total += - (d / 365.25) * cf["amount"] / (1 + safe_rate)**(d / 365.25 + 1)
        return total

    rate = guess
    for _ in range(100):
        try:
            f = npv(rate)
            df = npv_der(rate)
            if df == 0: break
            new_rate = rate - f / df
            new_rate = max(-0.99, min(new_rate, 100.0))
            if abs(new_rate - rate) < 1e-6:
                return new_rate
            rate = new_rate
        except (OverflowError, ZeroDivisionError):
            return 0.0
            
    return rate
