"""Regressions for issue #256: ratios going haywire over short periods and
around large cash injections.

Three distinct faults produced the nonsense numbers on the dashboard:

1. Every return was annualized, however short the window. A 2% week compounds
   to +180%/yr, and Sharpe/Sortino/Treynor/alpha all inherited that number as
   their numerator.
2. The daily return divided by the PREVIOUS day's value alone, so an injection
   many times larger than the existing balance levered the gap between a
   trade's price and that day's close into a triple-digit "daily return".
3. Internal cash movements (a trade settled from sub-portfolio cash, a
   dividend credited to that cash) were counted as external contributions.
"""
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

from src import models
from src.models import CASH_ASSET_TYPE
from src.services.performance import calculate_performance_metrics, _calculate_xirr

START = date(2024, 1, 1)


@pytest.fixture
def seeded(db_session):
    user = models.User(
        id=uuid.uuid7(), email="perf256@example.com", name="Perf256",
        salted_hashed_password="x", salt="x",
    )
    db_session.add(user)
    db_session.flush()
    household = models.Household(
        id=uuid.uuid7(), name="Perf256 HH", base_currency="USD", country_code="US", owner_id=user.id,
    )
    db_session.add(household)
    db_session.flush()
    sp = models.SubPortfolio(id=uuid.uuid7(), household_id=household.id, name="SP", risk_profile="Moderate")
    account = models.FinancialAccount(
        id=uuid.uuid7(), household_id=household.id, name="Acc",
        liquidity="liquid", tax_status="taxable", currency="USD",
    )
    asset = models.Asset(id=uuid.uuid7(), ticker="P256", name="Asset", type="stock", currency="USD")
    cash = models.Asset(id=uuid.uuid7(), ticker="CASH.USD", name="Cash USD", type=CASH_ASSET_TYPE, currency="USD")
    db_session.add_all([sp, account, asset, cash])
    db_session.commit()
    return household, sp, account, asset, cash


def _snapshot(db, household, sp, asset, d, value):
    db.add(models.PortfolioSnapshot(
        id=uuid.uuid7(), household_id=household.id, sub_portfolio_id=sp.id,
        asset_id=asset.id, date=d, quantity=max(value, 1.0) / 100.0,
        current_price=100.0, exchange_rate_used=1.0,
        current_value_home_currency=value, average_cost_basis=100.0,
        average_cost_basis_home_currency=100.0,
    ))


def _curve(db, household, sp, asset, values, start=START):
    for i, v in enumerate(values):
        _snapshot(db, household, sp, asset, start + timedelta(days=i), v)
    db.commit()


def _trade(db, household, sp, account, asset, day_offset, trade_type, amount,
           settlement_trade_id=None, start=START):
    trade = models.Trade(
        id=uuid.uuid7(), household_id=household.id, sub_portfolio_id=sp.id,
        asset_id=asset.id, account_id=account.id, trade_type=trade_type,
        date=datetime.combine(start + timedelta(days=day_offset), datetime.min.time(), tzinfo=timezone.utc),
        quantity=amount, price=1, exchange_rate=1.0,
        settlement_trade_id=settlement_trade_id,
    )
    db.add(trade)
    db.commit()
    return trade


# --------------------------------------------------------------------------
# 1. Short windows are reported as period returns, not annualized
# --------------------------------------------------------------------------

def test_short_window_returns_are_not_annualized(db_session, seeded):
    household, sp, account, asset, _cash = seeded
    # +2% over a 5-day week
    _curve(db_session, household, sp, asset, [10_000.0, 10_050.0, 10_100.0, 10_150.0, 10_200.0])

    m = calculate_performance_metrics(db_session, household.id)

    assert m.annualized is False
    # Annualizing this window would report ~+180%/yr for a 2% week
    assert m.time_weighted_return == pytest.approx(0.02, abs=1e-6)
    assert m.money_weighted_return == pytest.approx(0.02, abs=1e-3)


def test_year_long_window_is_annualized(db_session, seeded):
    """The annualization itself is not gone — it applies once there is a year."""
    household, sp, account, asset, _cash = seeded
    # Two years of 1%-per-month-ish growth, sampled monthly: 10k -> 12.1k
    values, dates = [], []
    for i in range(25):
        values.append(10_000.0 * (1.21 ** (i / 24)))
        dates.append(START + timedelta(days=30 * i))
    for d, v in zip(dates, values):
        _snapshot(db_session, household, sp, asset, d, v)
    db_session.commit()

    m = calculate_performance_metrics(db_session, household.id)

    assert m.annualized is True
    # 21% over ~720 days annualizes to roughly 10%/yr
    assert m.time_weighted_return == pytest.approx(0.10, abs=0.01)


def test_short_window_ratios_stay_in_a_sane_range(db_session, seeded):
    """Sharpe/Sortino on a week of small moves must not read in the hundreds."""
    household, sp, account, asset, _cash = seeded
    _curve(db_session, household, sp, asset,
           [10_000.0, 10_050.0, 10_020.0, 10_090.0, 10_060.0, 10_130.0])

    m = calculate_performance_metrics(db_session, household.id)

    assert abs(m.sharpe_ratio) < 25.0
    assert abs(m.sortino_ratio) <= 100.0
    assert m.volatility < 5.0


# --------------------------------------------------------------------------
# 2. Large cash injections
# --------------------------------------------------------------------------

def test_large_injection_does_not_inflate_returns_or_volatility(db_session, seeded):
    """100x injection with a 1% intraday gap between fill price and close.

    Old behaviour: the day's return was (V_t + amount)/V_t-1 - 1, i.e. the
    1,000 of drift on the new money was divided by the 1,000 that was already
    there, reporting +100% for the day and dragging TWR, volatility, Sharpe and
    Sortino with it.
    """
    household, sp, account, asset, _cash = seeded
    # 1k portfolio, 100k bought on day 1, that day closing 1% above the fill
    _curve(db_session, household, sp, asset, [1_000.0, 102_000.0, 102_000.0, 102_000.0])
    _trade(db_session, household, sp, account, asset, 1, "buy", 100_000)

    m = calculate_performance_metrics(db_session, household.id)

    # The real return is the 1% the injected money gained, not +100%
    assert m.time_weighted_return == pytest.approx(0.0099, abs=5e-4)
    assert m.volatility < 0.20
    assert abs(m.sharpe_ratio) < 25.0


def test_injection_into_empty_portfolio_is_not_infinite(db_session, seeded):
    """A day whose previous value is zero has no defined return.

    It used to divide by zero, and the resulting inf/NaN propagated into every
    metric in the response.
    """
    household, sp, account, asset, _cash = seeded
    _curve(db_session, household, sp, asset, [0.0, 50_000.0, 50_500.0, 50_500.0])
    _trade(db_session, household, sp, account, asset, 1, "buy", 50_000)

    m = calculate_performance_metrics(db_session, household.id)

    for value in (m.time_weighted_return, m.money_weighted_return, m.volatility,
                  m.sharpe_ratio, m.sortino_ratio, m.simple_return):
        assert value == value  # not NaN
        assert abs(value) < 1e6  # not inf
    # Only the 1% earned after the money landed counts as performance
    assert m.time_weighted_return == pytest.approx(0.01, abs=1e-6)


def test_mwr_is_immune_to_a_large_injection(db_session, seeded):
    """Same 1% gain, with and without a 100x deposit part-way through."""
    household, sp, account, asset, _cash = seeded
    _curve(db_session, household, sp, asset,
           [10_000.0, 10_000.0, 1_010_000.0, 1_010_000.0, 1_010_000.0])
    _trade(db_session, household, sp, account, asset, 2, "buy", 1_000_000)

    m = calculate_performance_metrics(db_session, household.id)

    # 10k flat then 1M deposited: no gain at all, in any measure
    assert m.money_weighted_return == pytest.approx(0.0, abs=1e-3)
    assert m.time_weighted_return == pytest.approx(0.0, abs=1e-6)
    assert m.simple_return == pytest.approx(0.0, abs=1e-6)


# --------------------------------------------------------------------------
# 3. Internal movements are not external cash flows
# --------------------------------------------------------------------------

def test_cash_settled_trade_legs_are_not_cash_flows(db_session, seeded):
    """Buying stock with the sub-portfolio's own cash moves nothing in or out."""
    household, sp, account, asset, cash = seeded
    # 10k of cash on day 0; on day 1 it buys stock, which closes 1% up
    _curve(db_session, household, sp, asset, [10_000.0, 10_100.0, 10_100.0])
    stock_leg = _trade(db_session, household, sp, account, asset, 1, "buy", 10_000)
    cash_leg = _trade(db_session, household, sp, account, cash, 1, "sell", 10_000,
                      settlement_trade_id=stock_leg.id)
    stock_leg.settlement_trade_id = cash_leg.id
    db_session.commit()

    m = calculate_performance_metrics(db_session, household.id)

    assert m.time_weighted_return == pytest.approx(0.01, abs=1e-6)
    assert m.simple_return == pytest.approx(0.01, abs=1e-6)


def test_dividend_cash_credit_counts_as_return_not_contribution(db_session, seeded):
    """An auto-tracked dividend credited to portfolio cash is performance.

    It lands in the equity curve as the cash pseudo-asset, so treating its
    cash trade as an external contribution subtracted the portfolio's own
    income from its return.
    """
    household, sp, account, asset, cash = seeded
    _curve(db_session, household, sp, asset, [10_000.0, 10_000.0, 10_100.0])
    cash_trade = _trade(db_session, household, sp, account, cash, 2, "buy", 100)
    db_session.add(models.Dividend(
        id=uuid.uuid7(), household_id=household.id, sub_portfolio_id=sp.id,
        asset_id=asset.id, account_id=account.id,
        date=datetime.combine(START + timedelta(days=2), datetime.min.time(), tzinfo=timezone.utc),
        amount=100, amount_home_currency=100, exchange_rate=1.0,
        is_manual=False, cash_trade_id=cash_trade.id,
    ))
    db_session.commit()

    m = calculate_performance_metrics(db_session, household.id)

    assert m.time_weighted_return == pytest.approx(0.01, abs=1e-6)
    assert m.dividend_income == pytest.approx(100.0)


# --------------------------------------------------------------------------
# 4. XIRR only reports a rate it actually solved for
# --------------------------------------------------------------------------

def test_xirr_returns_zero_when_no_root_exists():
    """A series whose NPV never crosses zero in range yields 0, not a clamp.

    Newton used to stop at the iteration cap and hand back its last iterate —
    often the 100.0 ceiling, i.e. a 10,000% return on the dashboard.
    """
    flows = [
        {"date": date(2024, 1, 1), "amount": -1_000.0},
        {"date": date(2024, 1, 2), "amount": 0.0},
    ]
    assert _calculate_xirr(flows) == 0.0


def test_steep_one_day_move_reports_its_period_return(db_session, seeded):
    """A 3% day is an annual IRR of ~4,900,000% — the solver has to reach it.

    With a tight rate ceiling the series is unbracketed and the old code fell
    back to 0%, reporting no gain at all for a real one.
    """
    household, sp, account, asset, _cash = seeded
    _curve(db_session, household, sp, asset, [10_000.0, 10_300.0])

    m = calculate_performance_metrics(db_session, household.id)

    assert m.money_weighted_return == pytest.approx(0.03, abs=1e-4)
    assert m.time_weighted_return == pytest.approx(0.03, abs=1e-6)


def test_xirr_solves_a_steep_short_series():
    """-1000 then +1010 a day later: ~1% in a day, a huge but real annual rate."""
    flows = [
        {"date": date(2024, 1, 1), "amount": -1_000.0},
        {"date": date(2024, 1, 2), "amount": 1_010.0},
    ]
    rate = _calculate_xirr(flows)
    # (1 + rate) ** (1/365.25) - 1 == 1%
    assert (1 + rate) ** (1 / 365.25) - 1 == pytest.approx(0.01, rel=1e-4)
