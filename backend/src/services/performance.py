import polars as pl
import numpy as np
import numpy_financial as npf
from datetime import date, datetime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import select, func
import math
import uuid
from typing import List, Optional, Dict

from src.models import Trade, PortfolioSnapshot, Asset, MarketPrice, TradeType, SubPortfolio, Dividend
from src import schemas

# Daily returns are annualized with the usual 252-trading-day convention.
TRADING_DAYS = 252
DAYS_PER_YEAR = 365.25

# Windows shorter than this are reported as period (cumulative) returns rather
# than annualized ones. Compounding a few days of return up to a year turns a
# 2% week into +180%/yr, which is arithmetically correct and completely
# useless as a statement about the portfolio -- see issue #256.
ANNUALIZATION_MIN_DAYS = 365


def _finite(value: Optional[float], fallback: Optional[float] = 0.0) -> Optional[float]:
    """Collapse NaN/inf (from divisions by an empty or zero-valued portfolio)
    into a defined fallback so a single bad day can't poison a whole metric."""
    if value is None:
        return fallback
    try:
        f = float(value)
    except (TypeError, ValueError):
        return fallback
    return f if math.isfinite(f) else fallback


def fetch_rf_and_benchmark_rows(db: Session, benchmark_ticker: str = "SPY"):
    """
    Fetches the risk-free-rate (^IRX) and benchmark price series once so
    callers computing metrics for several sub-portfolios in one request don't
    each re-run the identical query (see get_portfolio_metrics).
    """
    rf_rows = db.execute(
        select(MarketPrice.date, MarketPrice.close_price).where(MarketPrice.ticker == "^IRX")
    ).all()
    bench_rows = db.execute(
        select(MarketPrice.date, MarketPrice.close_price)
        .where(MarketPrice.ticker == benchmark_ticker)
        .order_by(MarketPrice.date)
    ).all()
    return rf_rows, bench_rows


def calculate_performance_metrics(
    db: Session,
    household_id: uuid.UUID,
    sub_portfolio_id: Optional[uuid.UUID] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    risk_free_rate: float = 0.04,
    benchmark_ticker: str = "SPY",
    rf_bench_rows: Optional[tuple] = None,
) -> schemas.PerformanceMetrics:
    """
    Calculates comprehensive performance metrics using Polars and NumPy.

    ``rf_bench_rows``, when given, is the ``(rf_rows, bench_rows)`` pair from
    `fetch_rf_and_benchmark_rows` — pass it when computing metrics for several
    sub-portfolios in the same request so the risk-free-rate and benchmark
    series (identical across all of them) are only queried once.
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

    # 2. Fetch Trades (External Cash Flows)
    #
    # Only trades that move money across the portfolio boundary are cash flows.
    # Two kinds of trade look like flows in the table but are purely internal:
    #   * both legs of a cash-settled trade (`settlement_trade_id` set on each) —
    #     buying stock with the sub-portfolio's own cash reallocates value
    #     inside the portfolio, no money entered or left it;
    #   * the cash pseudo-asset buy that credits an auto-tracked dividend
    #     (`Dividend.cash_trade_id`) — that payout is *return*, and counting it
    #     as a contribution subtracted the portfolio's own income from its
    #     performance.
    dividend_cash_trades = (
        select(Dividend.cash_trade_id)
        .where(Dividend.household_id == household_id)
        .where(Dividend.cash_trade_id.isnot(None))
    )
    trade_query = select(
        func.date(Trade.date).label("date"),
        Trade.trade_type,
        (Trade.quantity * Trade.price * Trade.exchange_rate).label("amount")
    ).where(
        Trade.household_id == household_id,
        Trade.settlement_trade_id.is_(None),
        Trade.id.notin_(dividend_cash_trades),
    )
    
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

    # Calculate Daily Returns for ALL historical data first.
    #
    # df_cf uses the MWR sign convention: buys (external contributions) are
    # NEGATIVE, sells (withdrawals) are POSITIVE, so the external flow into the
    # portfolio on day t is F_t = -amount.
    #
    # The day's return is Modified Dietz with the flow weighted at the START of
    # the day: (V_t - V_t-1 - F_t) / (V_t-1 + F_t). The full weight is not a
    # guess about intraday timing — it is what the snapshot engine already
    # does: a trade is applied to the holdings on its trade date and the whole
    # position is then valued at that day's close, so the contributed money is
    # invested for the day in our own books and has to sit in the denominator
    # too. Dividing by V_t-1 alone (the old formula) levered the gap between a
    # trade's execution price and the same day's close by the ratio of the
    # deposit to the pre-existing balance: injecting 100k into a 1k portfolio
    # turned a 1% intraday drift into a +100% "daily return", which is what
    # made TWR, volatility and every ratio built on them explode.
    #
    # Example: prev=1000, buy=100 (amount=-100), new_val=1110.
    # Return = (1110 - 1000 - 100) / (1000 + 100) = 0.91% — the deposit is not a gain.
    #
    # A day whose base is zero or negative (a portfolio that was empty, or fully
    # withdrawn) has no defined return, so it contributes 0 rather than an
    # infinity that would poison the whole window.
    df_history = df_history.with_columns([
        (pl.col("prev_value") - pl.col("amount")).alias("return_base")
    ]).with_columns([
        pl.when(pl.col("prev_value").is_null() | (pl.col("return_base") <= 0.0))
        .then(0.0)
        .otherwise(
            (pl.col("total_value") - pl.col("prev_value") + pl.col("amount")) / pl.col("return_base")
        )
        .alias("daily_return")
    ]).with_columns([
        pl.when(pl.col("daily_return").is_finite())
        .then(pl.col("daily_return"))
        .otherwise(0.0)
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

    window_start = df_filtered["date"].head(1).item()
    window_end = df_filtered["date"].tail(1).item()

    # --- A. Time-Weighted Return (TWR) ---
    # TWR in the window is the product of (1 + daily_return)
    twr_cumulative = _finite((df_filtered["daily_return"] + 1.0).product() - 1.0)

    # --- B. Annualization ---
    # The first in-window row's return measures growth from the PREVIOUS
    # snapshot date, so when the window starts mid-history the measured period
    # begins there rather than at window_start.
    prior_dates = df_history.filter(pl.col("date") < window_start)["date"]
    measured_start = prior_dates.max() if prior_dates.len() > 0 else window_start
    days_in_window = (window_end - measured_start).days
    years_in_window = days_in_window / DAYS_PER_YEAR if days_in_window > 0 else 0.0

    # Only annualize once the window is long enough for the extrapolation to
    # mean anything; below that the period return is reported as-is and
    # `annualized` tells the clients how to label it.
    annualized = days_in_window >= ANNUALIZATION_MIN_DAYS
    if annualized and years_in_window > 0 and twr_cumulative > -1:
        reported_twr = (1 + twr_cumulative) ** (1 / years_in_window) - 1
    else:
        reported_twr = twr_cumulative
    reported_twr = _finite(reported_twr)

    # --- C. Simple Return ---
    # Total Value / Total Contributions (within window, starting from base value)
    start_val = df_filtered["total_value"].head(1).item()
    end_val = df_filtered["total_value"].tail(1).item()
    # Net contributions in the window (excluding the starting balance).
    # Flows on or before the first snapshot date are already embedded in
    # start_val, so only flows strictly after it count — even when no
    # start_date filter was requested (otherwise the initial investment
    # would be double-counted against the starting balance).
    df_cf_window = df_cf
    if not df_cf.is_empty():
        df_cf_window = df_cf.filter(
            (pl.col("date") > window_start) & (pl.col("date") <= window_end)
        )
    
    net_cf_window = -df_cf_window["amount"].sum() if not df_cf_window.is_empty() else 0.0
    denominator = start_val + net_cf_window
    simple_return = (end_val - denominator) / denominator if denominator > 0 else 0.0
    simple_return = _finite(simple_return)

    # --- D. Money-Weighted Return (MWR / IRR) ---
    mwr_cfs = []
    if not df_cf_window.is_empty():
        mwr_cfs = df_cf_window.to_dicts()
    
    # Initial "outflow" (starting value of portfolio at the beginning of window)
    if start_val > 0:
        mwr_cfs.append({"date": window_start, "amount": -start_val})
    
    # Final "inflow" (ending value of portfolio)
    if end_val > 0:
        mwr_cfs.append({"date": window_end, "amount": end_val})
    
    # _calculate_xirr solves for an ANNUAL rate. Over a two-week window that
    # rate is a wild extrapolation of a couple of days of drift, so for short
    # windows it is converted back to the money-weighted return actually earned
    # over the period — the same basis the TWR above is reported on.
    mwr = _finite(_calculate_xirr(mwr_cfs))
    if not annualized and mwr > -1 and years_in_window > 0:
        mwr = _finite((1 + mwr) ** years_in_window - 1)

    # --- E. Volatility & Risk Ratios ---
    daily_returns_np = df_filtered["daily_return"].to_numpy()
    daily_vol = df_filtered["daily_return"].std()
    annualized_vol = _finite(float(daily_vol) * np.sqrt(TRADING_DAYS) if daily_vol is not None else 0.0)

    # Risk-Free Rate Fetching
    if rf_bench_rows is not None:
        rf_results, bench_rows = rf_bench_rows
    else:
        rf_results = db.execute(
            select(MarketPrice.date, MarketPrice.close_price).where(MarketPrice.ticker == "^IRX")
        ).all()
        bench_rows = None
    effective_rf = 0.02 # Default
    if rf_results:
        df_rf = pl.DataFrame([{"date": r.date, "rf_rate": float(r.close_price)} for r in rf_results])
        df_rf = df_rf.with_columns(pl.col("date").cast(pl.Date))
        df_metrics_rf = df_filtered.join(df_rf, on="date", how="left").fill_null(strategy="forward").fill_null(0.02)
        effective_rf = df_metrics_rf["rf_rate"].mean() if not df_metrics_rf.is_empty() else 0.02
    effective_rf = _finite(effective_rf, 0.02)

    # Risk ratios need an annualized return whatever the window length, but
    # they must not inherit the compounding blow-up: the numerator is the
    # ARITHMETIC annualization of the mean daily return (mean * 252), the
    # standard pairing for a denominator that is std * sqrt(252). Over a full
    # year it lands within a rounding error of the geometric figure; over a
    # week it stays a sane number instead of a five-digit one.
    ann_mean_return = _finite(
        float(np.mean(daily_returns_np)) * TRADING_DAYS if daily_returns_np.size > 0 else 0.0
    )
    excess_return = ann_mean_return - effective_rf

    sharpe = _finite(excess_return / annualized_vol if annualized_vol > 0 else 0.0)

    # Sortino: downside deviation is the root-mean-square of returns below the
    # 0% daily target, taken over ALL observations (not the std-dev of only the
    # negative returns — that would be 0 for a portfolio losing a steady 1%/day).
    downside_sq = np.square(np.minimum(daily_returns_np, 0.0))
    downside_vol = _finite(float(np.sqrt(downside_sq.mean()) * np.sqrt(TRADING_DAYS)) if downside_sq.size > 0 else 0.0)
    if downside_vol > 0:
        sortino = _finite(excess_return / downside_vol)
    else:
        # No losing days in the window: cap rather than divide by zero
        sortino = 100.0 if excess_return > 0 else 0.0

    # --- E2. Benchmark-relative metrics: beta, Treynor ratio, Jensen's alpha ---
    beta: Optional[float] = None
    alpha: Optional[float] = None
    treynor: Optional[float] = None
    if bench_rows is None:
        bench_rows = db.execute(
            select(MarketPrice.date, MarketPrice.close_price)
            .where(MarketPrice.ticker == benchmark_ticker)
            .order_by(MarketPrice.date)
        ).all()
    if bench_rows:
        df_bench_prices = pl.DataFrame([
            {"date": r.date, "bench_price": float(r.close_price)} for r in bench_rows
        ]).with_columns(pl.col("date").cast(pl.Date)).sort("date")
        df_bench = df_bench_prices.with_columns(
            (pl.col("bench_price") / pl.col("bench_price").shift(1) - 1.0).alias("bench_return")
        ).drop_nulls("bench_return")

        # Pair portfolio and benchmark returns on their common dates
        df_joined = df_filtered.select(["date", "daily_return"]).join(
            df_bench.select(["date", "bench_return"]), on="date", how="inner"
        ).sort("date")

        if df_joined.height >= 2:
            port_r = df_joined["daily_return"].to_numpy()
            bench_r = df_joined["bench_return"].to_numpy()
            bench_var = float(np.var(bench_r, ddof=1))
            if bench_var > 0:
                beta = _finite(float(np.cov(port_r, bench_r, ddof=1)[0, 1] / bench_var), None)

            if beta is not None:
                # Both sides are annualized the same arithmetic way, and both
                # over the JOINED dates only — comparing the portfolio across
                # days the benchmark has no return for is what would make alpha
                # non-zero for a portfolio that is literally the benchmark.
                port_ann = _finite(float(np.mean(port_r)) * TRADING_DAYS)
                bench_ann = _finite(float(np.mean(bench_r)) * TRADING_DAYS)
                port_excess = port_ann - effective_rf

                # Jensen's alpha: actual return minus the CAPM-expected return
                alpha = _finite(port_ann - (effective_rf + beta * (bench_ann - effective_rf)), None)
                # Treynor: excess return per unit of systematic (market) risk
                treynor = _finite(port_excess / beta, None) if abs(beta) > 1e-9 else None

    # --- F. Dividend Income & Trailing Yield ---
    # Auto-tracked dividends are credited to sub-portfolio cash, so they DO sit
    # in the equity curve (as the cash pseudo-asset) and are already counted as
    # return above. This is a separate income figure for display, not an
    # addition to the return, so there is nothing double-counted here.
    div_query = select(
        func.coalesce(Dividend.amount_home_currency, Dividend.amount).label("amount")
    ).where(Dividend.household_id == household_id)
    if sub_portfolio_id:
        div_query = div_query.where(Dividend.sub_portfolio_id == sub_portfolio_id)
    if start_date:
        div_query = div_query.where(func.date(Dividend.date) >= start_date)
    if end_date:
        div_query = div_query.where(func.date(Dividend.date) <= end_date)

    dividend_income = sum(float(r.amount) for r in db.execute(div_query).all() if r.amount is not None)
    # Trailing yield on the portfolio's current (window-end) market value.
    dividend_yield = _finite(dividend_income / end_val if end_val > 0 else 0.0)

    return schemas.PerformanceMetrics(
        simple_return=simple_return,
        time_weighted_return=reported_twr,
        money_weighted_return=mwr,
        annualized=annualized,
        volatility=annualized_vol,
        sharpe_ratio=sharpe,
        sortino_ratio=sortino,
        treynor_ratio=treynor,
        alpha=alpha,
        beta=beta,
        dividend_income=dividend_income,
        dividend_yield=dividend_yield
    )

def _empty_metrics() -> schemas.PerformanceMetrics:
    return schemas.PerformanceMetrics(
        simple_return=0.0,
        time_weighted_return=0.0,
        money_weighted_return=0.0,
        annualized=False,
        volatility=0.0,
        sharpe_ratio=0.0,
        sortino_ratio=0.0,
        treynor_ratio=None,
        alpha=None,
        beta=None
    )

# An IRR is only reported when the solver actually lands on a root. Newton's
# method on a short, lopsided flow series (a large late injection, say) can
# wander off and stop at the iteration cap; the old code returned whatever
# iterate it happened to be holding — sometimes the 100.0 clamp, i.e. a
# 10,000% "return" on the dashboard.
_XIRR_RATE_FLOOR = -0.9999
# Deliberately far above any plausible portfolio: an annual rate is what the
# solver works in, and a 3% day is an annual rate of ~4,900,000%. A tight
# ceiling would leave that series unbracketed and report 0% for a real gain.
# Short windows are converted back to their period return by the caller.
_XIRR_RATE_CEILING = 1e6
_XIRR_NPV_TOLERANCE = 1e-6


def _calculate_xirr(cash_flows: List[Dict], guess: float = 0.1) -> float:
    if not cash_flows:
        return 0.0
    
    amounts = [cf["amount"] for cf in cash_flows if abs(cf["amount"]) > 1e-6]
    if not amounts or all(a >= 0 for a in amounts) or all(a <= 0 for a in amounts):
        return 0.0
        
    start_date = min(cf["date"] for cf in cash_flows)
    scale = max(abs(a) for a in amounts)
    
    def npv(rate):
        total = 0.0
        safe_rate = max(rate, _XIRR_RATE_FLOOR)
        for cf in cash_flows:
            d = (cf["date"] - start_date).days
            total += cf["amount"] / (1 + safe_rate)**(d / DAYS_PER_YEAR)
        return total

    def npv_der(rate):
        total = 0.0
        safe_rate = max(rate, _XIRR_RATE_FLOOR)
        for cf in cash_flows:
            d = (cf["date"] - start_date).days
            total += - (d / DAYS_PER_YEAR) * cf["amount"] / (1 + safe_rate)**(d / DAYS_PER_YEAR + 1)
        return total

    def converged(rate) -> bool:
        try:
            return abs(npv(rate)) <= _XIRR_NPV_TOLERANCE * scale
        except (OverflowError, ZeroDivisionError, ValueError):
            return False

    rate = guess
    for _ in range(100):
        try:
            f = npv(rate)
            df = npv_der(rate)
            if df == 0: break
            new_rate = rate - f / df
            new_rate = max(_XIRR_RATE_FLOOR, min(new_rate, _XIRR_RATE_CEILING))
            if abs(new_rate - rate) < 1e-9:
                rate = new_rate
                break
            rate = new_rate
        except (OverflowError, ZeroDivisionError, ValueError):
            break

    if math.isfinite(rate) and converged(rate):
        return rate

    return _bisect_xirr(npv)


def _bisect_xirr(npv) -> float:
    """Fallback root-find over the supported rate band.

    Bisection can't diverge, so a series Newton bailed on still yields the
    right answer whenever one exists in range; if no sign change is bracketed
    the IRR is genuinely undefined for this series and 0.0 is reported rather
    than a fabricated number.
    """
    lo, hi = _XIRR_RATE_FLOOR, _XIRR_RATE_CEILING
    try:
        f_lo, f_hi = npv(lo), npv(hi)
    except (OverflowError, ZeroDivisionError, ValueError):
        return 0.0
    if not (math.isfinite(f_lo) and math.isfinite(f_hi)) or f_lo * f_hi > 0:
        return 0.0

    for _ in range(200):
        mid = (lo + hi) / 2
        try:
            f_mid = npv(mid)
        except (OverflowError, ZeroDivisionError, ValueError):
            return 0.0
        if not math.isfinite(f_mid):
            return 0.0
        if f_lo * f_mid <= 0:
            hi = mid
        else:
            lo, f_lo = mid, f_mid
        if hi - lo < 1e-9:
            break
    return (lo + hi) / 2
