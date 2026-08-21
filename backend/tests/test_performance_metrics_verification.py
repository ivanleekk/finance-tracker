"""Numerical verification of performance metrics against textbook formulas.

Each test seeds a synthetic equity curve (and, where relevant, benchmark and
cash-flow data) whose metrics can be derived independently from first
principles, then asserts calculate_performance_metrics matches.
"""
import uuid
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pytest

from src import models
from src.services.performance import calculate_performance_metrics, _calculate_xirr

TRADING_DAYS = 252
DAYS_PER_YEAR = 365.25

# 6-day equity curve with known daily returns and no cash flows
VALUES = [10_000.0, 10_100.0, 10_050.0, 10_200.0, 10_150.0, 10_300.0]
START = date(2024, 1, 1)
DATES = [START + timedelta(days=i) for i in range(len(VALUES))]

# The first day of history has no previous value, so its return is 0.0
DAILY_RETURNS = [0.0] + [VALUES[i] / VALUES[i - 1] - 1.0 for i in range(1, len(VALUES))]

# No ^IRX rows are seeded, so the service falls back to its 2% default
RISK_FREE = 0.02


def annualize(cumulative: float, days: int) -> float:
    return (1.0 + cumulative) ** (DAYS_PER_YEAR / days) - 1.0


def arith_annualize(daily_returns) -> float:
    """Risk-ratio numerator: mean daily return * 252.

    Risk ratios pair an annualized return with an annualized (std * sqrt(252))
    denominator, so the return is annualized arithmetically. Compounding a
    handful of days up to a year instead is what made every ratio explode on
    short windows (issue #256).
    """
    return float(np.mean(daily_returns)) * TRADING_DAYS


@pytest.fixture
def seeded(db_session):
    user = models.User(
        id=uuid.uuid7(), email="perfv@example.com", name="PerfV",
        salted_hashed_password="x", salt="x",
    )
    db_session.add(user)
    db_session.flush()
    household = models.Household(
        id=uuid.uuid7(), name="PerfV HH", base_currency="USD", country_code="US", owner_id=user.id,
    )
    db_session.add(household)
    db_session.flush()
    sp = models.SubPortfolio(id=uuid.uuid7(), household_id=household.id, name="PerfV SP", risk_profile="Moderate")
    account = models.FinancialAccount(
        id=uuid.uuid7(), household_id=household.id, name="Acc",
        liquidity="liquid", tax_status="taxable", currency="USD",
    )
    asset = models.Asset(id=uuid.uuid7(), ticker="PERFV", name="PerfV Asset", type="stock", currency="USD")
    db_session.add_all([sp, account, asset])
    db_session.commit()
    return household, sp, account, asset


def _snapshot(db, household, sp, asset, d, value, quantity=100):
    db.add(models.PortfolioSnapshot(
        id=uuid.uuid7(), household_id=household.id, sub_portfolio_id=sp.id,
        asset_id=asset.id, date=d, quantity=quantity,
        current_price=value / quantity, exchange_rate_used=1.0,
        current_value_home_currency=value, average_cost_basis=100,
        average_cost_basis_home_currency=100,
    ))


def _seed_curve(db, household, sp, asset, values=VALUES, dates=DATES):
    for d, v in zip(dates, values):
        _snapshot(db, household, sp, asset, d, v)
    db.commit()


def _seed_benchmark(db, returns, dates, start_price=100.0):
    """Seed SPY prices whose daily returns are exactly `returns` on dates[1:]."""
    price = start_price
    db.add(models.MarketPrice(id=uuid.uuid7(), ticker="SPY", date=dates[0], close_price=price, currency="USD"))
    for d, r in zip(dates[1:], returns):
        price *= 1.0 + r
        db.add(models.MarketPrice(id=uuid.uuid7(), ticker="SPY", date=d, close_price=price, currency="USD"))
    db.commit()


def _trade(db, household, sp, account, asset, dt, trade_type, quantity, price):
    db.add(models.Trade(
        id=uuid.uuid7(), household_id=household.id, sub_portfolio_id=sp.id,
        asset_id=asset.id, account_id=account.id, trade_type=trade_type,
        date=dt, quantity=quantity, price=price, exchange_rate=1.0,
    ))
    db.commit()


# --------------------------------------------------------------------------
# Overall (simple) return and TWR
# --------------------------------------------------------------------------

def test_simple_return_and_cumulative_twr_no_flows(db_session, seeded):
    """With no flows, simple return and cumulative TWR both equal V_end/V_start - 1."""
    household, sp, account, asset = seeded
    _seed_curve(db_session, household, sp, asset)

    m = calculate_performance_metrics(db_session, household.id, start_date=DATES[0], end_date=DATES[-1])

    expected_cum = VALUES[-1] / VALUES[0] - 1.0  # 3%
    assert m.simple_return == pytest.approx(expected_cum, rel=1e-9)
    # A 5-day window is reported as the period return, not annualized
    assert m.annualized is False
    assert m.time_weighted_return == pytest.approx(expected_cum, rel=1e-6)


def test_twr_ignores_mid_window_deposit(db_session, seeded):
    """TWR chain-links flow-adjusted daily returns: a deposit is not performance."""
    household, sp, account, asset = seeded
    # 10k flat, deposit 5k on day 5 (value jumps to 15k), then +2% on day 8
    values, dates = [], []
    for i in range(10):
        v = 10_000.0 if i < 5 else 15_000.0
        if i >= 8:
            v = 15_300.0
        values.append(v)
        dates.append(START + timedelta(days=i))
    _seed_curve(db_session, household, sp, asset, values, dates)
    _trade(db_session, household, sp, account, asset,
           datetime(2024, 1, 6, tzinfo=timezone.utc), "buy", 50, 100)

    m = calculate_performance_metrics(db_session, household.id, start_date=dates[0], end_date=dates[-1])

    # Only real performance: 15000 -> 15300 = +2%
    expected_cum = 15_300.0 / 15_000.0 - 1.0
    assert m.time_weighted_return == pytest.approx(expected_cum, rel=1e-6)
    # Simple return: gain of 300 over (10000 start + 5000 contributed)
    assert m.simple_return == pytest.approx(300.0 / 15_000.0, rel=1e-9)


# --------------------------------------------------------------------------
# IRR / MWR
# --------------------------------------------------------------------------

def test_mwr_equals_twr_when_no_flows(db_session, seeded):
    household, sp, account, asset = seeded
    _seed_curve(db_session, household, sp, asset)

    m = calculate_performance_metrics(db_session, household.id, start_date=DATES[0], end_date=DATES[-1])

    expected = VALUES[-1] / VALUES[0] - 1.0
    assert m.money_weighted_return == pytest.approx(expected, rel=1e-3)
    assert m.money_weighted_return == pytest.approx(m.time_weighted_return, rel=1e-3)


def test_mwr_initial_investment_not_double_counted(db_session, seeded):
    """A buy on the first snapshot date is already embedded in the starting value.

    Regression: without a start_date filter the initial trade used to be added
    to the flow list on top of the starting balance, wrecking the IRR.
    """
    household, sp, account, asset = seeded
    _seed_curve(db_session, household, sp, asset)
    _trade(db_session, household, sp, account, asset,
           datetime(2024, 1, 1, tzinfo=timezone.utc), "buy", 100, 100)  # the 10k that bought the curve

    m = calculate_performance_metrics(db_session, household.id)  # no start_date on purpose

    expected = VALUES[-1] / VALUES[0] - 1.0
    assert m.money_weighted_return == pytest.approx(expected, rel=1e-3)


def test_mwr_with_mid_window_withdrawal_is_flat(db_session, seeded):
    """Flat portfolio with a withdrawal: no performance, MWR ~ 0."""
    household, sp, account, asset = seeded
    values, dates = [], []
    for i in range(6):
        values.append(10_000.0 if i < 3 else 9_500.0)
        dates.append(START + timedelta(days=i))
    _seed_curve(db_session, household, sp, asset, values, dates)
    _trade(db_session, household, sp, account, asset,
           datetime(2024, 1, 4, tzinfo=timezone.utc), "sell", 5, 100)  # 500 withdrawal on day 3

    m = calculate_performance_metrics(db_session, household.id, start_date=dates[0], end_date=dates[-1])

    assert m.money_weighted_return == pytest.approx(0.0, abs=1e-4)
    assert m.time_weighted_return == pytest.approx(0.0, abs=1e-6)


def test_xirr_two_flow_closed_form():
    """-1000 at t0, +1100 one year later: IRR is exactly 10%."""
    flows = [
        {"date": date(2023, 1, 1), "amount": -1000.0},
        {"date": date(2024, 1, 1), "amount": 1100.0},
    ]
    assert _calculate_xirr(flows) == pytest.approx(0.10, abs=1e-4)


def test_xirr_three_flow_quadratic_solution():
    """-1000 at t0, -1000 at ~6 months, +2200 at 1 year.

    With u = (1+r)^-0.5 the NPV is a quadratic 2200u^2 - 1000u - 1000 = 0,
    giving r ~= 13.47%.
    """
    flows = [
        {"date": date(2023, 1, 1), "amount": -1000.0},
        {"date": date(2023, 7, 2), "amount": -1000.0},
        {"date": date(2024, 1, 1), "amount": 2200.0},
    ]
    assert _calculate_xirr(flows) == pytest.approx(0.1347, abs=0.01)


# --------------------------------------------------------------------------
# Sharpe ratio
# --------------------------------------------------------------------------

def test_sharpe_matches_formula(db_session, seeded):
    """Sharpe = (annualized TWR - rf) / (stdev of daily returns * sqrt(252))."""
    household, sp, account, asset = seeded
    _seed_curve(db_session, household, sp, asset)

    m = calculate_performance_metrics(db_session, household.id, start_date=DATES[0], end_date=DATES[-1])

    ann_return = arith_annualize(DAILY_RETURNS)
    expected_vol = float(np.std(DAILY_RETURNS, ddof=1)) * np.sqrt(TRADING_DAYS)
    assert m.volatility == pytest.approx(expected_vol, rel=1e-9)
    assert m.sharpe_ratio == pytest.approx((ann_return - RISK_FREE) / expected_vol, rel=1e-6)


def test_sharpe_zero_for_flat_portfolio(db_session, seeded):
    household, sp, account, asset = seeded
    _seed_curve(db_session, household, sp, asset, [10_000.0] * 6, DATES)

    m = calculate_performance_metrics(db_session, household.id, start_date=DATES[0], end_date=DATES[-1])

    assert m.volatility == pytest.approx(0.0, abs=1e-12)
    assert m.sharpe_ratio == 0.0


# --------------------------------------------------------------------------
# Sortino ratio
# --------------------------------------------------------------------------

def test_sortino_uses_downside_deviation(db_session, seeded):
    """Sortino denominator is sqrt(mean(min(r,0)^2)) * sqrt(252) over ALL days."""
    household, sp, account, asset = seeded
    _seed_curve(db_session, household, sp, asset)

    m = calculate_performance_metrics(db_session, household.id, start_date=DATES[0], end_date=DATES[-1])

    ann_return = arith_annualize(DAILY_RETURNS)
    downside = np.minimum(np.array(DAILY_RETURNS), 0.0)
    expected_dd = float(np.sqrt(np.mean(downside**2)) * np.sqrt(TRADING_DAYS))
    assert m.sortino_ratio == pytest.approx((ann_return - RISK_FREE) / expected_dd, rel=1e-6)


def test_sortino_negative_for_steady_losses(db_session, seeded):
    """Regression: a portfolio losing 1% every day must have a negative Sortino.

    The old implementation took the stdev of only the negative returns, which
    is 0 for identical daily losses and silently produced 0.
    """
    household, sp, account, asset = seeded
    values = [10_000.0 * 0.99**i for i in range(10)]
    dates = [START + timedelta(days=i) for i in range(10)]
    _seed_curve(db_session, household, sp, asset, values, dates)

    m = calculate_performance_metrics(db_session, household.id, start_date=dates[0], end_date=dates[-1])

    assert m.sortino_ratio < 0.0


def test_sortino_capped_when_no_losing_days(db_session, seeded):
    household, sp, account, asset = seeded
    values = [10_000.0 * 1.01**i for i in range(6)]
    _seed_curve(db_session, household, sp, asset, values, DATES)

    m = calculate_performance_metrics(db_session, household.id, start_date=DATES[0], end_date=DATES[-1])

    assert m.sortino_ratio == 100.0


# --------------------------------------------------------------------------
# Beta, Treynor ratio, Jensen's alpha
# --------------------------------------------------------------------------

def test_beta_two_when_portfolio_doubles_benchmark_moves(db_session, seeded):
    """Portfolio returns = 2 x benchmark returns => beta = 2 exactly."""
    household, sp, account, asset = seeded
    _seed_curve(db_session, household, sp, asset)
    bench_returns = [r / 2.0 for r in DAILY_RETURNS[1:]]
    _seed_benchmark(db_session, bench_returns, DATES)

    m = calculate_performance_metrics(db_session, household.id, start_date=DATES[0], end_date=DATES[-1])

    assert m.beta == pytest.approx(2.0, rel=1e-9)

    # Benchmark-relative metrics are measured over the dates both series
    # cover, i.e. every day but the first (which has no benchmark return).
    ann_return = arith_annualize(DAILY_RETURNS[1:])
    bench_ann = arith_annualize(bench_returns)
    assert m.treynor_ratio == pytest.approx((ann_return - RISK_FREE) / 2.0, rel=1e-6)
    assert m.alpha == pytest.approx(ann_return - (RISK_FREE + 2.0 * (bench_ann - RISK_FREE)), rel=1e-6)


def test_alpha_zero_when_portfolio_tracks_benchmark(db_session, seeded):
    """If the portfolio IS the benchmark, beta = 1 and Jensen's alpha = 0."""
    household, sp, account, asset = seeded
    _seed_curve(db_session, household, sp, asset)
    _seed_benchmark(db_session, DAILY_RETURNS[1:], DATES)

    m = calculate_performance_metrics(db_session, household.id, start_date=DATES[0], end_date=DATES[-1])

    assert m.beta == pytest.approx(1.0, rel=1e-9)
    assert m.alpha == pytest.approx(0.0, abs=1e-6)
    ann_return = arith_annualize(DAILY_RETURNS[1:])
    assert m.treynor_ratio == pytest.approx(ann_return - RISK_FREE, rel=1e-6)


def test_benchmark_metrics_none_without_benchmark_data(db_session, seeded):
    household, sp, account, asset = seeded
    _seed_curve(db_session, household, sp, asset)

    m = calculate_performance_metrics(db_session, household.id, start_date=DATES[0], end_date=DATES[-1])

    assert m.beta is None
    assert m.alpha is None
    assert m.treynor_ratio is None
