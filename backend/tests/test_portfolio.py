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

@pytest.fixture
def other_user(db_session):
    user = models.User(
        id=uuid.uuid7(),
        email="other_portfolio@example.com",
        name="Other User",
        salted_hashed_password="fakehash",
        salt="fakesalt",
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user

@pytest.fixture
def other_auth_headers(client, other_user):
    from src.auth import create_access_token
    token = create_access_token(data={"sub": str(other_user.id)})
    return {"Authorization": f"Bearer {token}"}

@pytest.fixture
def other_household(db_session, other_user):
    household = models.Household(
        id=uuid.uuid7(),
        name="Other Household",
        base_currency="USD",
        country_code="US",
        owner_id=other_user.id,
    )
    db_session.add(household)
    db_session.commit()
    db_session.refresh(household)
    return household

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

def test_create_asset_unauthorized(client):
    response = client.post(
        "/portfolio/assets",
        json={
            "id": str(uuid.uuid7()),
            "ticker": "MSFT",
            "name": "Microsoft",
            "type": "stock",
            "currency": "USD"
        }
    )
    assert response.status_code == 401

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

def test_create_asset_accepts_the_legacy_auto_pricing_mode(client, auth_headers):
    """Android shipped with "auto" where the backend says "market".

    Those builds are on people's phones, so the value is folded onto the canonical
    one instead of being rejected — but only one spelling ever reaches the column.
    """
    # A concrete name and currency mean create_asset skips the yfinance enrichment,
    # so this stays a pure schema test.
    response = client.post(
        "/portfolio/assets",
        headers=auth_headers,
        json={
            "id": str(uuid.uuid7()),
            "ticker": "MSFT",
            "name": "Microsoft",
            "type": "stock",
            "currency": "USD",
            "pricing_mode": "auto",
        }
    )
    assert response.status_code == 201
    assert response.json()["pricing_mode"] == "market"

def test_create_asset_rejects_an_unknown_pricing_mode(client, auth_headers):
    """Folding a known synonym must not turn the field into free text."""
    response = client.post(
        "/portfolio/assets",
        headers=auth_headers,
        json={
            "id": str(uuid.uuid7()),
            "ticker": "MSFT",
            "name": "Microsoft",
            "type": "stock",
            "currency": "USD",
            "pricing_mode": "whatever",
        }
    )
    assert response.status_code == 422

def test_update_asset_accepts_the_legacy_auto_pricing_mode(client, auth_headers, test_asset):
    response = client.put(
        f"/portfolio/assets/{test_asset.id}",
        headers=auth_headers,
        json={"pricing_mode": "auto"}
    )
    assert response.status_code == 200
    assert response.json()["pricing_mode"] == "market"

def test_update_asset_not_found(client, auth_headers):
    response = client.put(
        f"/portfolio/assets/{uuid.uuid7()}",
        headers=auth_headers,
        json={"name": "Apple Incorporated"}
    )
    assert response.status_code == 404

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

def test_delete_asset_not_found(client, auth_headers):
    response = client.delete(f"/portfolio/assets/{uuid.uuid7()}", headers=auth_headers)
    assert response.status_code == 404


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

def test_create_subportfolio_unauthorized(client, other_auth_headers, test_household):
    response = client.post(
        "/portfolio/subportfolios",
        headers=other_auth_headers,
        json={
            "household_id": str(test_household.id),
            "name": "Retirement",
            "risk_profile": "low"
        }
    )
    assert response.status_code == 403

def test_get_household_subportfolios(client, auth_headers, test_household, test_subportfolio):
    response = client.get(
        f"/portfolio/subportfolios/household/{test_household.id}",
        headers=auth_headers
    )
    assert response.status_code == 200
    assert len(response.json()) >= 1
    assert any(s["name"] == "Tech Stocks" for s in response.json())

def test_get_household_subportfolios_unauthorized(client, other_auth_headers, test_household):
    response = client.get(
        f"/portfolio/subportfolios/household/{test_household.id}",
        headers=other_auth_headers
    )
    assert response.status_code == 403

def test_update_subportfolio(client, auth_headers, test_subportfolio):
    response = client.patch(
        f"/portfolio/subportfolios/{test_subportfolio.id}",
        headers=auth_headers,
        json={"risk_profile": "medium"}
    )
    assert response.status_code == 200
    assert response.json()["risk_profile"] == "medium"

def test_update_subportfolio_not_found(client, auth_headers):
    response = client.patch(
        f"/portfolio/subportfolios/{uuid.uuid7()}",
        headers=auth_headers,
        json={"risk_profile": "medium"}
    )
    assert response.status_code == 404

def test_update_subportfolio_unauthorized(client, other_auth_headers, test_subportfolio):
    response = client.patch(
        f"/portfolio/subportfolios/{test_subportfolio.id}",
        headers=other_auth_headers,
        json={"risk_profile": "medium"}
    )
    assert response.status_code == 403

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

def test_delete_subportfolio_not_found(client, auth_headers):
    response = client.delete(f"/portfolio/subportfolios/{uuid.uuid7()}", headers=auth_headers)
    assert response.status_code == 404

def test_delete_subportfolio_unauthorized(client, other_auth_headers, test_subportfolio):
    response = client.delete(f"/portfolio/subportfolios/{test_subportfolio.id}", headers=other_auth_headers)
    assert response.status_code == 403


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

def test_update_trade_reassigns_uuid_fields(client, auth_headers, test_household, test_subportfolio, test_asset, test_account, db_session):
    """Reassigning a trade's asset/sub-portfolio takes UUIDs, not ints (regression:
    TradeUpdate previously typed these Optional[int], 422'ing any UUID payload)."""
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
    other_asset = models.Asset(
        id=uuid.uuid7(), ticker="MSFT", name="Microsoft", type="stock", currency="USD"
    )
    db_session.add_all([trade, other_asset])
    db_session.commit()

    response = client.put(
        f"/portfolio/trades/{trade.id}",
        headers=auth_headers,
        json={"asset_id": str(other_asset.id)}
    )
    assert response.status_code == 200
    assert response.json()["asset_id"] == str(other_asset.id)

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
            "average_cost_basis": "140.00"
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

def test_get_household_portfolio_snapshots(client, auth_headers, test_household, test_subportfolio, test_asset, db_session):
    snapshot = models.PortfolioSnapshot(
        id=uuid.uuid7(),
        household_id=test_household.id,
        sub_portfolio_id=test_subportfolio.id,
        asset_id=test_asset.id,
        date=date(2023, 10, 2),
        quantity=75.0,
        current_price=Decimal("110.0"),
        exchange_rate_used=1.0,
        current_value_home_currency=Decimal("8250.0"),
        average_cost_basis=Decimal("95.0")
    )
    db_session.add(snapshot)
    db_session.commit()

    response = client.get(
        f"/portfolio/snapshots/household/{test_household.id}",
        headers=auth_headers
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 1
    assert any(s["quantity"] == 75.0 for s in data)

def test_get_household_portfolio_snapshots_date_range(client, auth_headers, test_household, test_subportfolio, test_asset, db_session):
    for d, qty in [(date(2023, 9, 1), 10.0), (date(2023, 10, 1), 20.0), (date(2023, 11, 1), 30.0)]:
        db_session.add(models.PortfolioSnapshot(
            id=uuid.uuid7(),
            household_id=test_household.id,
            sub_portfolio_id=test_subportfolio.id,
            asset_id=test_asset.id,
            date=d,
            quantity=qty,
            current_price=Decimal("10.0"),
            exchange_rate_used=1.0,
            current_value_home_currency=Decimal(str(qty * 10)),
            average_cost_basis=Decimal("9.0"),
        ))
    db_session.commit()

    response = client.get(
        f"/portfolio/snapshots/household/{test_household.id}",
        params={"start_date": "2023-10-01", "end_date": "2023-10-31"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert [s["quantity"] for s in data] == [20.0]

def test_get_household_portfolio_snapshots_latest_only(client, auth_headers, test_household, test_subportfolio, test_asset, db_session):
    other_asset = models.Asset(id=uuid.uuid7(), ticker="MSFT", name="Microsoft", type="stock", currency="USD")
    db_session.add(other_asset)
    db_session.flush()

    # Two assets on the latest date, one stale row from an earlier date — latest_only
    # should return exactly the two current-date rows and drop the stale one.
    db_session.add_all([
        models.PortfolioSnapshot(
            id=uuid.uuid7(), household_id=test_household.id, sub_portfolio_id=test_subportfolio.id,
            asset_id=test_asset.id, date=date(2023, 10, 1), quantity=5.0, current_price=Decimal("10.0"),
            exchange_rate_used=1.0, current_value_home_currency=Decimal("50.0"), average_cost_basis=Decimal("9.0"),
        ),
        models.PortfolioSnapshot(
            id=uuid.uuid7(), household_id=test_household.id, sub_portfolio_id=test_subportfolio.id,
            asset_id=test_asset.id, date=date(2023, 11, 1), quantity=8.0, current_price=Decimal("10.0"),
            exchange_rate_used=1.0, current_value_home_currency=Decimal("80.0"), average_cost_basis=Decimal("9.0"),
        ),
        models.PortfolioSnapshot(
            id=uuid.uuid7(), household_id=test_household.id, sub_portfolio_id=test_subportfolio.id,
            asset_id=other_asset.id, date=date(2023, 11, 1), quantity=3.0, current_price=Decimal("20.0"),
            exchange_rate_used=1.0, current_value_home_currency=Decimal("60.0"), average_cost_basis=Decimal("18.0"),
        ),
    ])
    db_session.commit()

    response = client.get(
        f"/portfolio/snapshots/household/{test_household.id}",
        params={"latest_only": "true"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2
    assert all(s["date"] == "2023-11-01" for s in data)
    assert {s["quantity"] for s in data} == {8.0, 3.0}

def test_get_household_portfolio_snapshots_latest_only_empty(client, auth_headers, test_household):
    response = client.get(
        f"/portfolio/snapshots/household/{test_household.id}",
        params={"latest_only": "true"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json() == []

def test_get_household_portfolio_timeseries(client, auth_headers, test_household, test_subportfolio, test_asset, db_session):
    other_sub = models.SubPortfolio(id=uuid.uuid7(), household_id=test_household.id, name="Retirement", risk_profile="low")
    other_asset = models.Asset(id=uuid.uuid7(), ticker="MSFT", name="Microsoft", type="stock", currency="USD")
    db_session.add_all([other_sub, other_asset])
    db_session.flush()

    db_session.add_all([
        # Two assets in test_subportfolio on the same date should sum into one point.
        models.PortfolioSnapshot(
            id=uuid.uuid7(), household_id=test_household.id, sub_portfolio_id=test_subportfolio.id,
            asset_id=test_asset.id, date=date(2023, 10, 1), quantity=5.0, current_price=Decimal("10.0"),
            exchange_rate_used=1.0, current_value_home_currency=Decimal("50.0"), average_cost_basis=Decimal("9.0"),
        ),
        models.PortfolioSnapshot(
            id=uuid.uuid7(), household_id=test_household.id, sub_portfolio_id=test_subportfolio.id,
            asset_id=other_asset.id, date=date(2023, 10, 1), quantity=2.0, current_price=Decimal("25.0"),
            exchange_rate_used=1.0, current_value_home_currency=Decimal("50.0"), average_cost_basis=Decimal("20.0"),
        ),
        # A different sub-portfolio on the same date stays a separate point.
        models.PortfolioSnapshot(
            id=uuid.uuid7(), household_id=test_household.id, sub_portfolio_id=other_sub.id,
            asset_id=test_asset.id, date=date(2023, 10, 1), quantity=1.0, current_price=Decimal("10.0"),
            exchange_rate_used=1.0, current_value_home_currency=Decimal("10.0"), average_cost_basis=Decimal("9.0"),
        ),
    ])
    db_session.commit()

    response = client.get(
        f"/portfolio/snapshots/household/{test_household.id}/timeseries",
        headers=auth_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2
    by_sub = {row["sub_portfolio_id"]: Decimal(row["total_value_home_currency"]) for row in data}
    assert by_sub[str(test_subportfolio.id)] == Decimal("100.0")
    assert by_sub[str(other_sub.id)] == Decimal("10.0")
    assert all(row["date"] == "2023-10-01" for row in data)


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
