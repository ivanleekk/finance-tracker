"""API-level tests for portfolio metrics, manual sync, and manual dividend CRUD."""
import uuid
from datetime import date, datetime, timedelta, timezone
from unittest.mock import patch

import pytest

from src import models
from src.auth import create_access_token


@pytest.fixture
def owner(db_session):
    user = models.User(
        id=uuid.uuid7(), email="metrics_owner@example.com", name="Metrics Owner",
        salted_hashed_password="x", salt="x",
    )
    db_session.add(user)
    db_session.commit()
    return user


@pytest.fixture
def headers(owner):
    return {"Authorization": f"Bearer {create_access_token(data={'sub': str(owner.id)})}"}


@pytest.fixture
def household(db_session, owner):
    hh = models.Household(
        id=uuid.uuid7(), name="Metrics HH", base_currency="USD", country_code="US", owner_id=owner.id,
    )
    db_session.add(hh)
    db_session.flush()
    db_session.add(models.HouseholdMember(
        id=uuid.uuid7(), household_id=hh.id, user_id=owner.id, role=models.HouseholdRoleType.owner,
    ))
    db_session.commit()
    return hh


@pytest.fixture
def portfolio(db_session, household):
    sp = models.SubPortfolio(id=uuid.uuid7(), household_id=household.id, name="Metrics SP", risk_profile="Moderate")
    account = models.FinancialAccount(
        id=uuid.uuid7(), household_id=household.id, name="Metrics Acc",
        liquidity="liquid", tax_status="taxable", currency="USD",
    )
    asset = models.Asset(id=uuid.uuid7(), ticker="MTRX", name="Metrics Asset", type="stock", currency="USD")
    db_session.add_all([sp, account, asset])
    db_session.commit()
    return sp, account, asset


@pytest.fixture(autouse=True)
def fresh_treasury_rate(db_session):
    """Seed a recent ^IRX row so metrics endpoints skip the yfinance treasury fetch."""
    db_session.add(models.MarketPrice(
        id=uuid.uuid7(), ticker="^IRX", date=date.today(), close_price=0.04, currency="USD",
    ))
    db_session.commit()


def test_household_metrics_endpoint(client, headers, db_session, household, portfolio):
    sp, account, asset = portfolio
    start = date.today() - timedelta(days=5)
    for i in range(5):
        db_session.add(models.PortfolioSnapshot(
            id=uuid.uuid7(), household_id=household.id, sub_portfolio_id=sp.id,
            asset_id=asset.id, date=start + timedelta(days=i), quantity=10,
            current_price=100 + i, exchange_rate_used=1.0,
            current_value_home_currency=1000 + 10 * i,
        ))
    db_session.commit()

    response = client.get(f"/portfolio/household/{household.id}/metrics", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["household_id"] == str(household.id)
    assert body["overall_metrics"]["time_weighted_return"] > 0
    names = [m["name"] for m in body["sub_portfolio_metrics"]]
    assert "Metrics SP" in names


def test_household_metrics_requires_membership(client, db_session, household):
    outsider = models.User(
        id=uuid.uuid7(), email="metrics_outsider@example.com", name="Out",
        salted_hashed_password="x", salt="x",
    )
    db_session.add(outsider)
    db_session.commit()
    outsider_headers = {"Authorization": f"Bearer {create_access_token(data={'sub': str(outsider.id)})}"}
    response = client.get(f"/portfolio/household/{household.id}/metrics", headers=outsider_headers)
    assert response.status_code == 403


def test_subportfolio_metrics_endpoint(client, headers, db_session, household, portfolio):
    sp, account, asset = portfolio
    db_session.add(models.PortfolioSnapshot(
        id=uuid.uuid7(), household_id=household.id, sub_portfolio_id=sp.id,
        asset_id=asset.id, date=date.today(), quantity=10,
        current_price=100, exchange_rate_used=1.0, current_value_home_currency=1000,
    ))
    db_session.commit()

    response = client.get(f"/portfolio/subportfolios/{sp.id}/metrics", headers=headers)
    assert response.status_code == 200
    assert "time_weighted_return" in response.json()

    missing = client.get(f"/portfolio/subportfolios/{uuid.uuid7()}/metrics", headers=headers)
    assert missing.status_code == 404


def test_manual_sync_endpoint(client, headers, db_session, household, portfolio):
    sp, account, asset = portfolio
    db_session.add(models.Trade(
        id=uuid.uuid7(), household_id=household.id, sub_portfolio_id=sp.id,
        asset_id=asset.id, account_id=account.id, trade_type="buy",
        date=datetime(2024, 5, 1, tzinfo=timezone.utc), quantity=1, price=100, exchange_rate=1.0,
    ))
    db_session.commit()

    with patch("src.routers.portfolio.run_snapshot_range") as mock_run:
        response = client.post(f"/portfolio/household/{household.id}/sync", headers=headers)
    assert response.status_code == 202
    assert response.json()["status"] == "success"
    args = mock_run.call_args[0]
    assert args[2] == date(2024, 5, 1)  # syncs from the earliest trade


def test_manual_sync_no_trades(client, headers, household):
    with patch("src.routers.portfolio.run_snapshot_range") as mock_run:
        response = client.post(f"/portfolio/household/{household.id}/sync", headers=headers)
    assert response.status_code == 202
    assert response.json()["status"] == "no_data"
    mock_run.assert_not_called()


def test_manual_dividend_crud(client, headers, db_session, household, portfolio):
    sp, account, asset = portfolio

    created = client.post(
        "/portfolio/dividends",
        headers=headers,
        json={
            "household_id": str(household.id),
            "sub_portfolio_id": str(sp.id),
            "asset_id": str(asset.id),
            "account_id": str(account.id),
            "date": "2024-06-01T00:00:00Z",
            "amount": "25.50",
            "exchange_rate": 1.0,
        },
    )
    assert created.status_code == 201
    dividend = created.json()
    assert dividend["is_manual"] is True

    listing = client.get(f"/portfolio/dividends/household/{household.id}", headers=headers)
    assert listing.status_code == 200
    assert [d["id"] for d in listing.json()] == [dividend["id"]]

    updated = client.put(
        f"/portfolio/dividends/{dividend['id']}",
        headers=headers,
        json={"amount": "30.00"},
    )
    assert updated.status_code == 200
    assert float(updated.json()["amount"]) == pytest.approx(30.0)

    assert client.delete(f"/portfolio/dividends/{dividend['id']}", headers=headers).status_code == 204
    assert client.get(f"/portfolio/dividends/household/{household.id}", headers=headers).json() == []


def test_dividend_update_missing_404(client, headers):
    response = client.put(
        f"/portfolio/dividends/{uuid.uuid7()}", headers=headers, json={"amount": "1.00"}
    )
    assert response.status_code == 404
