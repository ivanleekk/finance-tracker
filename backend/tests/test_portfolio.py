import uuid
import pytest
from decimal import Decimal
from datetime import datetime, date, timezone
from src import models

@pytest.fixture
def test_user(db_session):
    user = models.User(
        id=uuid.uuid7(),
        email="test_portfolio@example.com",
        name="Portfolio User",
        salted_hashed_password="fakehash",
        salt="fakesalt",
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user

@pytest.fixture
def auth_headers(client, test_user):
    from src.auth import create_access_token
    token = create_access_token(data={"sub": str(test_user.id)})
    return {"Authorization": f"Bearer {token}"}

@pytest.fixture
def test_household(db_session, test_user):
    household = models.Household(
        id=uuid.uuid7(),
        name="Portfolio Household",
        base_currency="USD",
        country_code="US",
        owner_id=test_user.id,
    )
    db_session.add(household)
    db_session.commit()
    db_session.refresh(household)
    return household

@pytest.fixture
def test_account(db_session, test_household):
    account = models.FinancialAccount(
        id=uuid.uuid7(),
        household_id=test_household.id,
        name="Brokerage",
        liquidity="liquid",
        tax_status="taxable",
        currency="USD"
    )
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)
    return account

@pytest.fixture
def test_subportfolio(db_session, test_household):
    sub = models.SubPortfolio(
        id=uuid.uuid7(),
        household_id=test_household.id,
        name="Tech Stocks",
        risk_profile="high"
    )
    db_session.add(sub)
    db_session.commit()
    db_session.refresh(sub)
    return sub

@pytest.fixture
def test_asset(db_session):
    asset = models.Asset(
        id=uuid.uuid7(),
        ticker="AAPL",
        name="Apple Inc.",
        type="stock",
        currency="USD"
    )
    db_session.add(asset)
    db_session.commit()
    db_session.refresh(asset)
    return asset


# --- ASSETS ---

def test_create_asset(client, auth_headers):
    response = client.post(
        "/portfolio/assets",
        headers=auth_headers,
        json={
            "id": str(uuid.uuid7()),
            "ticker": "MSFT",
            "name": "Microsoft",
            "type": "stock",
            "currency": "USD"
        }
    )
    assert response.status_code == 201
    assert response.json()["ticker"] == "MSFT"

def test_search_assets(client, auth_headers, test_asset):
    response = client.get("/portfolio/assets?ticker=AAPL", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 1
    assert data[0]["ticker"] == "AAPL"

def test_update_asset(client, auth_headers, test_asset):
    response = client.put(
        f"/portfolio/assets/{test_asset.id}",
        headers=auth_headers,
        json={"name": "Apple Incorporated"}
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Apple Incorporated"

def test_delete_asset(client, auth_headers, db_session):
    asset = models.Asset(
        id=uuid.uuid7(),
        ticker="DEL",
        name="Delete Me",
        type="stock",
        currency="USD"
    )
    db_session.add(asset)
    db_session.commit()

    response = client.delete(f"/portfolio/assets/{asset.id}", headers=auth_headers)
    assert response.status_code == 204
    assert db_session.query(models.Asset).filter_by(id=asset.id).first() is None


# --- SUBPORTFOLIOS ---

def test_create_subportfolio(client, auth_headers, test_household):
    response = client.post(
        "/portfolio/subportfolios",
        headers=auth_headers,
        json={
            "household_id": str(test_household.id),
            "name": "Retirement",
            "risk_profile": "low"
        }
    )
    assert response.status_code == 201
    assert response.json()["name"] == "Retirement"

def test_get_household_subportfolios(client, auth_headers, test_household, test_subportfolio):
    response = client.get(
        f"/portfolio/subportfolios/household/{test_household.id}",
        headers=auth_headers
    )
    assert response.status_code == 200
    assert len(response.json()) >= 1
    assert any(s["name"] == "Tech Stocks" for s in response.json())

def test_update_subportfolio(client, auth_headers, test_subportfolio):
    response = client.put(
        f"/portfolio/subportfolios/{test_subportfolio.id}",
        headers=auth_headers,
        json={"risk_profile": "medium"}
    )
    assert response.status_code == 200
    assert response.json()["risk_profile"] == "medium"

def test_delete_subportfolio(client, auth_headers, test_household, db_session):
    sub = models.SubPortfolio(
        id=uuid.uuid7(),
        household_id=test_household.id,
        name="Delete Me",
        risk_profile="low"
    )
    db_session.add(sub)
    db_session.commit()

    response = client.delete(f"/portfolio/subportfolios/{sub.id}", headers=auth_headers)
    assert response.status_code == 204
    assert db_session.query(models.SubPortfolio).filter_by(id=sub.id).first() is None


# --- TRADES ---

def test_execute_trade(client, auth_headers, test_household, test_subportfolio, test_asset, test_account):
    response = client.post(
        "/portfolio/trades",
        headers=auth_headers,
        json={
            "household_id": str(test_household.id),
            "sub_portfolio_id": str(test_subportfolio.id),
            "asset_id": str(test_asset.id),
            "account_id": str(test_account.id),
            "type": "buy",
            "date": datetime.now(timezone.utc).isoformat(),
            "quantity": 10.5,
            "price": "150.25",
            "exchange_rate": 1.0
        }
    )
    assert response.status_code == 201
    data = response.json()
    assert data["type"] == "buy"
    assert data["quantity"] == 10.5

def test_get_household_trades(client, auth_headers, test_household, test_subportfolio, test_asset, test_account, db_session):
    trade = models.Trade(
        id=uuid.uuid7(),
        household_id=test_household.id,
        sub_portfolio_id=test_subportfolio.id,
        asset_id=test_asset.id,
        account_id=test_account.id,
        trade_type="sell",
        date=datetime.now(timezone.utc),
        quantity=5.0,
        price=Decimal("160.00"),
        exchange_rate=1.0
    )
    db_session.add(trade)
    db_session.commit()

    response = client.get(f"/portfolio/trades/household/{test_household.id}", headers=auth_headers)
    assert response.status_code == 200
    assert len(response.json()) >= 1
    assert any(t["type"] == "sell" for t in response.json())

def test_update_trade(client, auth_headers, test_household, test_subportfolio, test_asset, test_account, db_session):
    trade = models.Trade(
        id=uuid.uuid7(),
        household_id=test_household.id,
        sub_portfolio_id=test_subportfolio.id,
        asset_id=test_asset.id,
        account_id=test_account.id,
        trade_type="buy",
        date=datetime.now(timezone.utc),
        quantity=5.0,
        price=Decimal("160.00"),
        exchange_rate=1.0
    )
    db_session.add(trade)
    db_session.commit()

    response = client.put(
        f"/portfolio/trades/{trade.id}",
        headers=auth_headers,
        json={"quantity": 15.0}
    )
    assert response.status_code == 200
    assert response.json()["quantity"] == 15.0

def test_delete_trade(client, auth_headers, test_household, test_subportfolio, test_asset, test_account, db_session):
    trade = models.Trade(
        id=uuid.uuid7(),
        household_id=test_household.id,
        sub_portfolio_id=test_subportfolio.id,
        asset_id=test_asset.id,
        account_id=test_account.id,
        trade_type="buy",
        date=datetime.now(timezone.utc),
        quantity=5.0,
        price=Decimal("160.00"),
        exchange_rate=1.0
    )
    db_session.add(trade)
    db_session.commit()

    response = client.delete(f"/portfolio/trades/{trade.id}", headers=auth_headers)
    assert response.status_code == 204
    assert db_session.query(models.Trade).filter_by(id=trade.id).first() is None


# --- SNAPSHOTS ---

def test_create_snapshot(client, auth_headers, test_household, test_subportfolio, test_asset):
    response = client.post(
        f"/portfolio/subportfolios/{test_subportfolio.id}/snapshot",
        headers=auth_headers,
        json={
            "household_id": str(test_household.id),
            "sub_portfolio_id": str(test_subportfolio.id),
            "asset_id": str(test_asset.id),
            "date": "2023-10-01",
            "quantity": 100,
            "price": "150.00",
            "exchange_rate_used": 1.0,
            "current_value_home_currency": "15000.00",
            "averge_cost_basis": "140.00"
        }
    )
    assert response.status_code == 201
    assert response.json()["quantity"] == 100

def test_get_snapshots(client, auth_headers, test_household, test_subportfolio, test_asset, db_session):
    snapshot = models.PortfolioSnapshot(
        id=uuid.uuid7(),
        household_id=test_household.id,
        sub_portfolio_id=test_subportfolio.id,
        asset_id=test_asset.id,
        date=date(2023, 10, 1),
        quantity=50.0,
        current_price=Decimal("100.0"),
        exchange_rate_used=1.0,
        current_value_home_currency=Decimal("5000.0"),
        average_cost_basis=Decimal("90.0")
    )
    db_session.add(snapshot)
    db_session.commit()

    response = client.get(
        f"/portfolio/subportfolios/{test_subportfolio.id}/snapshot",
        headers=auth_headers
    )
    assert response.status_code == 200
    assert len(response.json()) >= 1
    assert response.json()[0]["quantity"] == 50.0


# --- DIVIDENDS ---

def test_log_dividend(client, auth_headers, test_household, test_subportfolio, test_asset, test_account):
    response = client.post(
        "/portfolio/dividends",
        headers=auth_headers,
        json={
            "household_id": str(test_household.id),
            "sub_portfolio_id": str(test_subportfolio.id),
            "asset_id": str(test_asset.id),
            "account_id": str(test_account.id),
            "date": datetime.now(timezone.utc).isoformat(),
            "amount": "25.50",
            "exchange_rate": 1.0
        }
    )
    assert response.status_code == 201
    assert response.json()["amount"] == "25.50"


# --- EXCHANGE RATES ---

def test_log_exchange_rate(client, auth_headers):
    response = client.post(
        "/portfolio/exchangerates",
        headers=auth_headers,
        json={
            "id": str(uuid.uuid7()),
            "date": "2023-10-01",
            "base_currency": "USD",
            "target_currency": "EUR",
            "rate": 0.95
        }
    )
    assert response.status_code == 201
    assert response.json()["rate"] == 0.95

def test_get_exchange_rates(client, auth_headers, db_session):
    rate = models.ExchangeRate(
        id=uuid.uuid7(),
        base_currency="USD",
        target_currency="GBP",
        date=date(2023, 10, 1),
        rate=0.82
    )
    db_session.add(rate)
    db_session.commit()

    response = client.get("/portfolio/exchangerates?base_currency=USD&target_currency=GBP", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 1
    assert any(r["rate"] == 0.82 for r in data)
