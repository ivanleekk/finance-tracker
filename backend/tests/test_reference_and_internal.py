"""Tests for /reference lookups and the /internal scheduler endpoint."""
import uuid
from datetime import date, datetime, timezone
from unittest.mock import patch

import pytest

from src import models
from src.auth import create_access_token


# --- Reference data ---

def test_currencies_lookup(client):
    response = client.get("/reference/currencies")
    assert response.status_code == 200
    currencies = {c["code"]: c for c in response.json()}
    assert "USD" in currencies
    assert currencies["USD"]["name"] == "US Dollar"
    assert "SGD" in currencies
    # Sorted by code
    codes = [c["code"] for c in response.json()]
    assert codes == sorted(codes)


def test_countries_lookup(client):
    response = client.get("/reference/countries")
    assert response.status_code == 200
    countries = {c["code"]: c["name"] for c in response.json()}
    assert countries.get("US") == "United States"
    assert countries.get("SG") == "Singapore"


def test_timezones_lookup(client):
    response = client.get("/reference/timezones")
    assert response.status_code == 200
    tz = {t["name"]: t["label"] for t in response.json()}
    assert "UTC" in tz
    assert "(GMT" in tz["UTC"]
    assert "Asia/Singapore" in tz


def test_exchange_rate_endpoint_uses_cache_service(client):
    with patch("src.services.market_data.fetch_and_cache_exchange_rates", return_value=1.35) as mock_fetch:
        response = client.get("/reference/exchange_rate?base=USD&target=SGD&date=2024-01-15")
    assert response.status_code == 200
    assert response.json() == {"rate": 1.35}
    args = mock_fetch.call_args[0]
    assert args[1:] == ("USD", "SGD", date(2024, 1, 15))


# --- Internal scheduler endpoint ---

def _seed_household_with_trade(db_session):
    user = models.User(
        id=uuid.uuid7(), email=f"sched-{uuid.uuid7()}@example.com", name="Sched",
        salted_hashed_password="x", salt="x",
    )
    db_session.add(user)
    db_session.flush()
    household = models.Household(
        id=uuid.uuid7(), name="Sched HH", base_currency="USD", country_code="US", owner_id=user.id,
    )
    db_session.add(household)
    db_session.flush()
    sp = models.SubPortfolio(id=uuid.uuid7(), household_id=household.id, name="SP", risk_profile="Moderate")
    account = models.FinancialAccount(
        id=uuid.uuid7(), household_id=household.id, name="Acc",
        liquidity="liquid", tax_status="taxable", currency="USD",
    )
    asset = models.Asset(id=uuid.uuid7(), ticker="VOO", name="VOO", type="stock", currency="USD")
    db_session.add_all([sp, account, asset])
    db_session.flush()
    trade = models.Trade(
        id=uuid.uuid7(), household_id=household.id, sub_portfolio_id=sp.id,
        asset_id=asset.id, account_id=account.id, trade_type="buy",
        date=datetime(2024, 1, 10, tzinfo=timezone.utc), quantity=1, price=100, exchange_rate=1.0,
    )
    db_session.add(trade)
    db_session.commit()
    return household


def test_internal_snapshot_requires_secret(client, monkeypatch):
    monkeypatch.setenv("SCHEDULER_SECRET", "top-secret")
    assert client.post("/internal/tasks/daily-snapshot").status_code == 403
    assert client.post(
        "/internal/tasks/daily-snapshot", headers={"X-Scheduler-Secret": "wrong"}
    ).status_code == 403


def test_internal_snapshot_denies_when_unconfigured(client, monkeypatch):
    monkeypatch.delenv("SCHEDULER_SECRET", raising=False)
    response = client.post(
        "/internal/tasks/daily-snapshot", headers={"X-Scheduler-Secret": "anything"}
    )
    assert response.status_code == 500


def test_internal_snapshot_catches_up_from_first_trade(client, db_session, monkeypatch):
    monkeypatch.setenv("SCHEDULER_SECRET", "top-secret")
    household = _seed_household_with_trade(db_session)

    with patch("src.routers.internal.run_snapshot_range") as mock_run, \
         patch("src.routers.internal.sync_dividends_range", return_value=0) as mock_div:
        response = client.post(
            "/internal/tasks/daily-snapshot", headers={"X-Scheduler-Secret": "top-secret"}
        )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "success"
    detail = next(d for d in body["details"] if d["household_id"] == str(household.id))
    assert detail["status"] == "updated"
    # No snapshots yet → catch up from the first trade date
    assert detail["from"] == "2024-01-10"
    mock_run.assert_called_once()
    mock_div.assert_called_once()


def test_internal_snapshot_resumes_from_last_snapshot(client, db_session, monkeypatch):
    monkeypatch.setenv("SCHEDULER_SECRET", "top-secret")
    household = _seed_household_with_trade(db_session)
    sp = db_session.query(models.SubPortfolio).filter_by(household_id=household.id).one()
    asset = db_session.query(models.Asset).filter_by(ticker="VOO").first()
    db_session.add(models.PortfolioSnapshot(
        id=uuid.uuid7(), household_id=household.id, sub_portfolio_id=sp.id,
        asset_id=asset.id, date=date(2024, 3, 1), quantity=1,
        current_price=100, exchange_rate_used=1.0,
    ))
    db_session.commit()

    with patch("src.routers.internal.run_snapshot_range"), \
         patch("src.routers.internal.sync_dividends_range", return_value=0):
        response = client.post(
            "/internal/tasks/daily-snapshot", headers={"X-Scheduler-Secret": "top-secret"}
        )

    detail = next(d for d in response.json()["details"] if d["household_id"] == str(household.id))
    assert detail["from"] == "2024-03-01"
