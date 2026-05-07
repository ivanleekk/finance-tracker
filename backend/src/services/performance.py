import polars as pl
import numpy as np
import numpy_financial as npf
from datetime import date, datetime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import select, func
import uuid
from typing import List, Optional, Dict

from src.models import Trade, PortfolioSnapshot, Asset, MarketPrice, TradeType, SubPortfolio
from src import schemas

def calculate_performance_metrics(
    db: Session, 
    household_id: uuid.UUID, 
    sub_portfolio_id: Optional[uuid.UUID] = None,
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
    
    # Process cash flows: Buy = Outflow (Negative for MWR perspective), Sell = Inflow (Positive)
    # Actually, for IRR: Contributions are negative, Distributions/Ending Value are positive.
    cash_flows = []
    for t in trades:
        # amount is positive here.
        # If I buy, I'm contributing cash TO the portfolio.
        # If I sell, I'm withdrawing cash FROM the portfolio.
        # MWR CF convention: Negative = Investment (Outflow from wallet), Positive = Withdrawal (Inflow to wallet)
        cf_amount = -float(t.amount) if t.trade_type == TradeType.buy else float(t.amount)
        cash_flows.append({"date": t.date, "amount": cf_amount})

    df_cf = pl.DataFrame(cash_flows) if cash_flows else pl.DataFrame(schema={"date": pl.Date, "amount": pl.Float64})
    if not df_cf.is_empty():
        df_cf = df_cf.with_columns(pl.col("date").cast(pl.Date)).group_by("date").agg(pl.sum("amount"))

    # --- Metrics Calculation ---
    
    # A. Simple Return
    # Simple Return = (Ending Value - Net Contributions) / Net Contributions
    ending_value = df_snapshots["total_value"].tail(1).item()
    net_contributions = -df_cf["amount"].sum() if not df_cf.is_empty() else 0.0
    
    # Handle edge case where net_contributions is 0
    simple_return = (ending_value - net_contributions) / net_contributions if net_contributions > 0 else 0.0

    # B. Time-Weighted Return (TWR)
    # TWR = Product of (End_Value / (Start_Value + CF)) - 1
    # We join snapshots and cash flows
    df_combined = df_snapshots.join(df_cf, on="date", how="left").fill_null(0.0)
    
    # Calculate daily returns
    # return_i = (V_i) / (V_{i-1} + CF_i)
    df_twr = df_combined.with_columns([
        pl.col("total_value").shift(1).alias("prev_value")
    ]).fill_null(0.0)
    
    # If it's the first day, return is 0 or based on first CF
    df_twr = df_twr.with_columns(
        daily_return = (pl.col("total_value")) / (pl.col("prev_value") - pl.col("amount"))
    ).fill_null(1.0)
    
    # Chain link
    twr_cumulative = df_twr["daily_return"].product() - 1.0

    # C. Money-Weighted Return (MWR / IRR)
    # Add terminal value as a final positive cash flow
    mwr_cfs = cash_flows.copy()
    mwr_cfs.append({"date": df_snapshots["date"].tail(1).item(), "amount": ending_value})
    
    # Sort by date
    mwr_cfs.sort(key=lambda x: x["date"])
    
    # Convert to daily IRR
    # XIRR implementation is needed for non-periodic. 
    # For now, let's use a simplified version or a search for daily IRR.
    mwr = _calculate_xirr(mwr_cfs)

    # D. Volatility & Ratios
    # Daily returns (not TWR style, just % change in equity adjusted for CF)
    df_metrics = df_twr.with_columns(
        pct_change = (pl.col("total_value") - pl.col("amount") - pl.col("prev_value")) / pl.col("prev_value")
    ).fill_null(0.0).filter(pl.col("prev_value") > 0)
    
    daily_vol = df_metrics["pct_change"].std() if not df_metrics.is_empty() else 0.0
    annualized_vol = daily_vol * np.sqrt(252)
    
    # Fetch actual historical risk-free rates (^IRX)
    rf_query = select(MarketPrice.date, MarketPrice.close_price).where(MarketPrice.ticker == "^IRX")
    rf_results = db.execute(rf_query).all()
    if rf_results:
        df_rf = pl.DataFrame([{"date": r.date, "rf_rate": float(r.close_price)} for r in rf_results])
        df_rf = df_rf.with_columns(pl.col("date").cast(pl.Date))
        # Join with metrics to get RF for the specific period
        df_metrics_rf = df_metrics.join(df_rf, on="date", how="left").fill_null(strategy="forward").fill_null(0.04)
        effective_rf = df_metrics_rf["rf_rate"].mean() if not df_metrics_rf.is_empty() else 0.04
    else:
        effective_rf = 0.04 # Fallback
    
    # Annualized Returns
    days = (df_snapshots["date"].max() - df_snapshots["date"].min()).days
    years = days / 365.25 if days > 0 else 0
    
    ann_twr = (1 + twr_cumulative)**(1/years) - 1 if years > 0 and twr_cumulative > -1 else twr_cumulative
    
    sharpe = (ann_twr - effective_rf) / annualized_vol if annualized_vol > 0 else 0.0
    
    # Sortino (Downside deviation)
    downside_returns = df_metrics.filter(pl.col("pct_change") < 0)["pct_change"]
    downside_vol = downside_returns.std() * np.sqrt(252) if not downside_returns.is_empty() else 0.0
    sortino = (ann_twr - effective_rf) / downside_vol if downside_vol > 0 else 0.0
 
    # E. Beta & Treynor
    beta = 1.0 # Default
    treynor = (ann_twr - effective_rf) / beta if beta != 0 else 0.0

    return schemas.PerformanceMetrics(
        simple_return=simple_return,
        time_weighted_return=ann_twr, # Return annualized TWR
        money_weighted_return=mwr,
        volatility=annualized_vol,
        sharpe_ratio=sharpe,
        sortino_ratio=sortino,
        treynor_ratio=treynor,
        beta=beta
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
    """
    Simplified XIRR implementation using Newton's method.
    """
    if not cash_flows:
        return 0.0
        
    start_date = min(cf["date"] for cf in cash_flows)
    
    def npv(rate):
        total = 0.0
        for cf in cash_flows:
            d = (cf["date"] - start_date).days
            total += cf["amount"] / (1 + rate)**(d / 365.25)
        return total

    def npv_der(rate):
        total = 0.0
        for cf in cash_flows:
            d = (cf["date"] - start_date).days
            total += - (d / 365.25) * cf["amount"] / (1 + rate)**(d / 365.25 + 1)
        return total

    # Newton's method
    rate = guess
    for _ in range(100):
        f = npv(rate)
        df = npv_der(rate)
        if df == 0:
            break
        new_rate = rate - f / df
        if abs(new_rate - rate) < 1e-6:
            return new_rate
        rate = new_rate
        
    return rate # Fallback to best guess
