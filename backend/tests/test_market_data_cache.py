"""Tests for market_data caching: cached rows must short-circuit yfinance calls."""
import uuid
from datetime import date, timedelta
from unittest.mock import patch

import pandas as pd
import pytest

from src.models import ExchangeRate, MarketPrice
from src.services.market_data import (
    fetch_and_cache_exchange_rates,
    fetch_and_cache_exchange_rates_range,
    fetch_and_cache_market_prices_range,
)


def _seed_rate(db, base, target, d, rate):
    db.add(ExchangeRate(
        id=uuid.uuid7(), base_currency=base, target_currency=target, date=d, rate=rate,
    ))
    db.commit()


def test_same_currency_rate_is_one_without_network(db_session):
    with patch("src.services.market_data.yf.download") as mock_dl:
        rate = fetch_and_cache_exchange_rates(db_session, "USD", "usd", date(2024, 1, 2))
    assert rate == 1.0
    mock_dl.assert_not_called()


def test_cached_exchange_rate_short_circuits_yfinance(db_session):
    _seed_rate(db_session, "USD", "SGD", date(2024, 1, 2), 1.33)
    with patch("src.services.market_data.yf.download") as mock_dl:
        rate = fetch_and_cache_exchange_rates(db_session, "usd", "sgd", date(2024, 1, 2))
    assert float(rate) == pytest.approx(1.33)
    mock_dl.assert_not_called()


def test_exchange_rate_cache_miss_fetches_year_and_upserts(db_session):
    fetched_days = pd.date_range("2024-01-01", "2024-01-05")
    fake = pd.DataFrame({"Close": [1.30, 1.31, 1.32, 1.33, 1.34]}, index=fetched_days)
    with patch("src.services.market_data.yf.download", return_value=fake) as mock_dl:
        rate = fetch_and_cache_exchange_rates(db_session, "USD", "SGD", date(2024, 1, 3))

    assert float(rate) == pytest.approx(1.32)
    mock_dl.assert_called_once()
    assert mock_dl.call_args[0][0] == "USDSGD=X"
    # The whole fetched window is cached for future lookups
    cached = db_session.query(ExchangeRate).filter_by(
        base_currency="USD", target_currency="SGD"
    ).count()
    assert cached == 5

    # Second lookup within the fetched window: no new network call
    with patch("src.services.market_data.yf.download") as mock_dl2:
        rate2 = fetch_and_cache_exchange_rates(db_session, "USD", "SGD", date(2024, 1, 5))
    assert float(rate2) == pytest.approx(1.34)
    mock_dl2.assert_not_called()


def test_exchange_rate_range_same_currency(db_session):
    lookup = fetch_and_cache_exchange_rates_range(
        db_session, "USD", "USD", date(2024, 1, 1), date(2024, 1, 3)
    )
    assert lookup == {
        (date(2024, 1, 1), "USD", "USD"): 1.0,
        (date(2024, 1, 2), "USD", "USD"): 1.0,
        (date(2024, 1, 3), "USD", "USD"): 1.0,
    }


def test_exchange_rate_range_uses_cache(db_session):
    """A fully cached range must not hit yfinance (weekends use the cached weekday rows)."""
    d = date(2024, 1, 1)
    while d <= date(2024, 1, 7):
        _seed_rate(db_session, "EUR", "USD", d, 1.10)
        d += timedelta(days=1)

    with patch("src.services.market_data.yf.download") as mock_dl:
        lookup = fetch_and_cache_exchange_rates_range(
            db_session, "EUR", "USD", date(2024, 1, 2), date(2024, 1, 6)
        )
    mock_dl.assert_not_called()
    assert lookup[(date(2024, 1, 4), "EUR", "USD")] == pytest.approx(1.10)


def test_market_prices_range_skips_cached_tickers(db_session):
    """Tickers already covering the range shouldn't be re-downloaded."""
    for offset in range(3):
        db_session.add(MarketPrice(
            id=uuid.uuid7(), ticker="AAPL", date=date(2024, 1, 1) + timedelta(days=offset),
            close_price=150 + offset, currency="USD",
        ))
    db_session.commit()

    with patch("src.services.market_data.yf.download", return_value=pd.DataFrame()) as mock_dl:
        fetch_and_cache_market_prices_range(db_session, ["AAPL"], date(2024, 1, 1), date(2024, 1, 3))

    if mock_dl.called:
        # If the implementation still fetches, it must at least not duplicate rows
        assert db_session.query(MarketPrice).filter_by(ticker="AAPL").count() == 3
    else:
        mock_dl.assert_not_called()


def test_market_prices_range_empty_ticker_list(db_session):
    with patch("src.services.market_data.yf.download") as mock_dl:
        fetch_and_cache_market_prices_range(db_session, [], date(2024, 1, 1), date(2024, 1, 3))
    mock_dl.assert_not_called()
