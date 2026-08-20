"""Direct tests of calculate_performance_metrics with a synthetic equity curve."""
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

from src import models
from src.services.performance import calculate_performance_metrics, _calculate_xirr


@pytest.fixture
def seeded(db_session):
    user = models.User(
        id=uuid.uuid7(), email="perf@example.com", name="Perf",
        salted_hashed_password="x", salt="x",
    )
    db_session.add(user)
    db_session.flush()
    household = models.Household(
        id=uuid.uuid7(), name="Perf HH", base_currency="USD", country_code="US", owner_id=user.id,
    )
    db_session.add(household)
    db_session.flush()
    sp = models.SubPortfolio(id=uuid.uuid7(), household_id=household.id, name="Perf SP", risk_profile="Moderate")
    account = models.FinancialAccount(
        id=uuid.uuid7(), household_id=household.id, name="Acc",
        liquidity="liquid", tax_status="taxable", currency="USD",
    )
    asset = models.Asset(id=uuid.uuid7(), ticker="PERF", name="Perf Asset", type="stock", currency="USD")
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


def test_metrics_empty_household(db_session, seeded):
    household, *_ = seeded
    metrics = calculate_performance_metrics(db_session, uuid.uuid7())
    assert metrics.time_weighted_return == 0.0
    assert metrics.money_weighted_return == 0.0


def test_metrics_simple_growth_no_flows(db_session, seeded):
    """10,000 → 11,000 over 10 days with no cash flows: cumulative TWR is 10%."""
    household, sp, account, asset = seeded
    start = date(2024, 1, 1)
    db_session.add(models.Trade(
        id=uuid.uuid7(), household_id=household.id, sub_portfolio_id=sp.id,
        asset_id=asset.id, account_id=account.id, trade_type="buy",
        date=datetime(2023, 12, 20, tzinfo=timezone.utc), quantity=100, price=100, exchange_rate=1.0,
    ))
    for i in range(11):
        _snapshot(db_session, household, sp, asset, start + timedelta(days=i), 10_000 + 100 * i)
    db_session.commit()

    metrics = calculate_performance_metrics(
        db_session, household.id, start_date=start, end_date=start + timedelta(days=10)
    )

    # simple_return over the window: (11000 - 10000) / 10000 = 10%
    assert metrics.simple_return == pytest.approx(0.10, abs=1e-6)
    # A 10-day window is reported as the period return, not annualized up to
    # the ~3400%/yr that compounding 10% over 10 days would imply.
    assert metrics.annualized is False
    assert metrics.time_weighted_return == pytest.approx(0.10, abs=1e-6)
    assert metrics.volatility >= 0.0
    # No benchmark (SPY) data seeded, so benchmark-relative metrics are unknown
    assert metrics.beta is None
    assert metrics.alpha is None
    assert metrics.treynor_ratio is None


def test_metrics_deposit_not_counted_as_gain(db_session, seeded):
    """A mid-window buy (external cash inflow) must not inflate TWR."""
    household, sp, account, asset = seeded
    start = date(2024, 2, 1)
    # Value flat at 10k, then a 5k deposit on day 5 (value jumps to 15k), flat after.
    for i in range(11):
        value = 10_000 if i < 5 else 15_000
        _snapshot(db_session, household, sp, asset, start + timedelta(days=i), value)
    db_session.add(models.Trade(
        id=uuid.uuid7(), household_id=household.id, sub_portfolio_id=sp.id,
        asset_id=asset.id, account_id=account.id, trade_type="buy",
        date=datetime(2024, 2, 6, tzinfo=timezone.utc), quantity=50, price=100, exchange_rate=1.0,
    ))
    db_session.commit()

    metrics = calculate_performance_metrics(
        db_session, household.id, start_date=start, end_date=start + timedelta(days=10)
    )

    # All growth is explained by the deposit → zero performance
    assert metrics.time_weighted_return == pytest.approx(0.0, abs=1e-6)
    assert metrics.simple_return == pytest.approx(0.0, abs=1e-6)


def test_metrics_subportfolio_filter(db_session, seeded):
    """Metrics for one sub-portfolio must ignore the other's snapshots."""
    household, sp, account, asset = seeded
    sp2 = models.SubPortfolio(id=uuid.uuid7(), household_id=household.id, name="Other SP", risk_profile="Moderate")
    db_session.add(sp2)
    db_session.flush()

    start = date(2024, 3, 1)
    for i in range(3):
        _snapshot(db_session, household, sp, asset, start + timedelta(days=i), 10_000)  # flat
        db_session.add(models.PortfolioSnapshot(
            id=uuid.uuid7(), household_id=household.id, sub_portfolio_id=sp2.id,
            asset_id=asset.id, date=start + timedelta(days=i), quantity=10,
            current_price=100 * (1 + i), exchange_rate_used=1.0,
            current_value_home_currency=1_000 * (1 + i),
        ))
    db_session.commit()

    flat = calculate_performance_metrics(
        db_session, household.id, sub_portfolio_id=sp.id,
        start_date=start, end_date=start + timedelta(days=2),
    )
    growing = calculate_performance_metrics(
        db_session, household.id, sub_portfolio_id=sp2.id,
        start_date=start, end_date=start + timedelta(days=2),
    )
    assert flat.simple_return == pytest.approx(0.0, abs=1e-6)
    assert growing.simple_return > 0.5


def test_metrics_include_dividend_income(db_session, seeded):
    household, sp, account, asset = seeded
    start = date(2024, 4, 1)
    for i in range(3):
        _snapshot(db_session, household, sp, asset, start + timedelta(days=i), 10_000)
    db_session.add(models.Dividend(
        id=uuid.uuid7(), household_id=household.id, sub_portfolio_id=sp.id,
        asset_id=asset.id, account_id=account.id,
        date=datetime(2024, 4, 2, tzinfo=timezone.utc),
        amount=50, amount_home_currency=50, exchange_rate=1.0,
    ))
    db_session.commit()

    metrics = calculate_performance_metrics(
        db_session, household.id, start_date=start, end_date=start + timedelta(days=2)
    )
    assert metrics.dividend_income == pytest.approx(50.0)
    assert metrics.dividend_yield == pytest.approx(50.0 / 10_000)


def test_xirr_sign_and_magnitude():
    """Invest 1000, receive 1100 a year later → IRR ≈ 10%."""
    flows = [
        {"date": date(2023, 1, 1), "amount": -1000.0},
        {"date": date(2024, 1, 1), "amount": 1100.0},
    ]
    assert _calculate_xirr(flows) == pytest.approx(0.10, abs=0.005)


def test_xirr_degenerate_inputs():
    assert _calculate_xirr([]) == 0.0
    assert _calculate_xirr([{"date": date(2024, 1, 1), "amount": -100.0}]) == 0.0
