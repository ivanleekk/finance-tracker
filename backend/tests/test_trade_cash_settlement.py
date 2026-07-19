import uuid
from datetime import datetime, timezone
from decimal import Decimal

import pytest

from src import models


@pytest.fixture
def test_user(db_session):
    user = models.User(
        id=uuid.uuid7(),
        email="settle_from_cash@example.com",
        name="Settle User",
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
        name="Settle Household",
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
        name="Settle Brokerage",
        liquidity="liquid",
        tax_status="taxable",
        currency="USD",
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
        name="Settle Subportfolio",
        risk_profile="moderate",
    )
    db_session.add(sub)
    db_session.commit()
    db_session.refresh(sub)
    return sub


@pytest.fixture
def test_asset(db_session):
    asset = models.Asset(
        id=uuid.uuid7(),
        ticker="SETL",
        name="Settle Asset",
        type="stock",
        currency="USD",
    )
    db_session.add(asset)
    db_session.commit()
    db_session.refresh(asset)
    return asset


def _deposit_cash(client, auth_headers, household, subportfolio, account, amount=1000):
    resp = client.post(
        f"/portfolio/subportfolios/{subportfolio.id}/cash",
        headers=auth_headers,
        json={
            "household_id": str(household.id),
            "account_id": str(account.id),
            "direction": "deposit",
            "amount": amount,
            "currency": "USD",
            "date": datetime.now(timezone.utc).isoformat(),
            "exchange_rate": 1.0,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _buy_payload(household, subportfolio, asset, account, quantity=5, price="100.00", settle_from_cash=True):
    return {
        "household_id": str(household.id),
        "sub_portfolio_id": str(subportfolio.id),
        "asset_id": str(asset.id),
        "account_id": str(account.id),
        "type": "buy",
        "date": datetime.now(timezone.utc).isoformat(),
        "quantity": quantity,
        "price": price,
        "currency": "USD",
        "exchange_rate": 1.0,
        "settle_from_cash": settle_from_cash,
    }


def test_buy_settled_from_cash_consumes_subportfolio_cash(client, auth_headers, test_household, test_subportfolio, test_asset, test_account, db_session):
    _deposit_cash(client, auth_headers, test_household, test_subportfolio, test_account, amount=1000)

    response = client.post(
        "/portfolio/trades",
        headers=auth_headers,
        json=_buy_payload(test_household, test_subportfolio, test_asset, test_account, quantity=5, price="100.00"),
    )
    assert response.status_code == 201, response.text
    data = response.json()
    assert data["settlement_trade_id"] is not None
    assert data["transaction_id"] is None  # no funding-account transaction was created

    stock_trade = db_session.query(models.Trade).filter(models.Trade.id == uuid.UUID(data["id"])).first()
    companion = db_session.query(models.Trade).filter(models.Trade.id == stock_trade.settlement_trade_id).first()
    assert companion.trade_type == models.TradeType.sell
    assert companion.quantity == 500.0  # 5 * 100
    assert companion.transaction_id is None
    assert companion.settlement_trade_id == stock_trade.id

    cash_asset = db_session.query(models.Asset).filter(models.Asset.id == companion.asset_id).first()
    assert cash_asset.ticker == "CASH.USD"

    # The real bank account balance only reflects the original $1000 deposit.
    balance = db_session.query(models.AccountBalance).filter(
        models.AccountBalance.account_id == test_account.id
    ).order_by(models.AccountBalance.date.desc()).first()
    assert balance.balance == Decimal("-1000.00")


def test_buy_settled_from_cash_insufficient_funds_rejected(client, auth_headers, test_household, test_subportfolio, test_asset, test_account, db_session):
    _deposit_cash(client, auth_headers, test_household, test_subportfolio, test_account, amount=100)

    response = client.post(
        "/portfolio/trades",
        headers=auth_headers,
        json=_buy_payload(test_household, test_subportfolio, test_asset, test_account, quantity=5, price="100.00"),
    )
    assert response.status_code == 400
    assert "Insufficient cash" in response.json()["detail"]

    # Nothing was created for the rejected buy.
    stock_trades = db_session.query(models.Trade).filter(models.Trade.asset_id == test_asset.id).all()
    assert len(stock_trades) == 0


def test_sell_settled_from_cash_credits_subportfolio_cash(client, auth_headers, test_household, test_subportfolio, test_asset, test_account, db_session):
    # Buy normally (funded from the real account) so there's something to sell.
    buy = client.post(
        "/portfolio/trades",
        headers=auth_headers,
        json=_buy_payload(test_household, test_subportfolio, test_asset, test_account, quantity=5, price="100.00", settle_from_cash=False),
    )
    assert buy.status_code == 201, buy.text

    sell_payload = _buy_payload(test_household, test_subportfolio, test_asset, test_account, quantity=2, price="120.00", settle_from_cash=True)
    sell_payload["type"] = "sell"
    response = client.post("/portfolio/trades", headers=auth_headers, json=sell_payload)
    assert response.status_code == 201, response.text
    data = response.json()
    assert data["transaction_id"] is None

    companion = db_session.query(models.Trade).filter(models.Trade.id == data["settlement_trade_id"]).first()
    assert companion.trade_type == models.TradeType.buy
    assert companion.quantity == 240.0  # 2 * 120


def test_deleting_cash_settled_trade_removes_companion(client, auth_headers, test_household, test_subportfolio, test_asset, test_account, db_session):
    _deposit_cash(client, auth_headers, test_household, test_subportfolio, test_account, amount=1000)

    response = client.post(
        "/portfolio/trades",
        headers=auth_headers,
        json=_buy_payload(test_household, test_subportfolio, test_asset, test_account, quantity=5, price="100.00"),
    )
    trade_id = response.json()["id"]
    companion_id = response.json()["settlement_trade_id"]

    del_response = client.delete(f"/portfolio/trades/{trade_id}", headers=auth_headers)
    assert del_response.status_code == 204

    assert db_session.query(models.Trade).filter(models.Trade.id == trade_id).first() is None
    assert db_session.query(models.Trade).filter(models.Trade.id == uuid.UUID(companion_id)).first() is None


def test_updating_cash_settled_trade_resyncs_companion_quantity(client, auth_headers, test_household, test_subportfolio, test_asset, test_account, db_session):
    _deposit_cash(client, auth_headers, test_household, test_subportfolio, test_account, amount=1000)

    response = client.post(
        "/portfolio/trades",
        headers=auth_headers,
        json=_buy_payload(test_household, test_subportfolio, test_asset, test_account, quantity=5, price="100.00"),
    )
    trade_id = response.json()["id"]
    companion_id = response.json()["settlement_trade_id"]

    update = client.put(
        f"/portfolio/trades/{trade_id}",
        headers=auth_headers,
        json={"quantity": 3.0},
    )
    assert update.status_code == 200

    companion = db_session.query(models.Trade).filter(models.Trade.id == uuid.UUID(companion_id)).first()
    assert companion.quantity == 300.0  # 3 * 100, resynced


def test_cannot_settle_a_cash_asset_from_cash(client, auth_headers, test_household, test_subportfolio, test_account, db_session):
    _deposit_cash(client, auth_headers, test_household, test_subportfolio, test_account, amount=1000)
    cash_asset = db_session.query(models.Asset).filter(models.Asset.ticker == "CASH.USD").first()

    response = client.post(
        "/portfolio/trades",
        headers=auth_headers,
        json={
            "household_id": str(test_household.id),
            "sub_portfolio_id": str(test_subportfolio.id),
            "asset_id": str(cash_asset.id),
            "account_id": str(test_account.id),
            "type": "buy",
            "date": datetime.now(timezone.utc).isoformat(),
            "quantity": 100,
            "price": "1.00",
            "currency": "USD",
            "exchange_rate": 1.0,
            "settle_from_cash": True,
        },
    )
    assert response.status_code == 400
