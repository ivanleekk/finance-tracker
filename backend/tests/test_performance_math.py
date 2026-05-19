from datetime import date
import uuid
from src.services.performance import calculate_performance_metrics, _calculate_xirr

def test_xirr_basic():
    # CFs: -100 at t0, +110 at t1 year
    cfs = [
        {"date": date(2023, 1, 1), "amount": -100},
        {"date": date(2024, 1, 1), "amount": 110}
    ]
    # Expected IRR: 10%
    rate = _calculate_xirr(cfs)
    assert abs(rate - 0.10) < 1e-4

def test_xirr_complex():
    # CFs: -100 at t0, -50 at t0.5, +170 at t1
    cfs = [
        {"date": date(2023, 1, 1), "amount": -100},
        {"date": date(2023, 7, 1), "amount": -50},
        {"date": date(2024, 1, 1), "amount": 170}
    ]
    rate = _calculate_xirr(cfs)
    # Just check it converges and is positive
    assert rate > 0
    assert rate < 0.30

# Mocking DB for calculate_performance_metrics is complex, 
# but we can verify the function handles empty data gracefully.
def test_empty_metrics(db_session):
    household_id = uuid.uuid4()
    metrics = calculate_performance_metrics(db_session, household_id)
    assert metrics.simple_return == 0.0
    assert metrics.sharpe_ratio == 0.0
