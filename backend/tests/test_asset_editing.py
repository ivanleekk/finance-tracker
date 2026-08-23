"""
Editing an asset's identity (PUT /portfolio/assets/{id}).

The motivating case: a ticker created with the wrong currency (G3B.SI entered
as USD instead of SGD). Correcting it has to move the cached prices and replay
the affected households' snapshots, or the holdings keep the valuations the
wrong currency produced. See ``src/services/asset_service.py``.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from sqlalchemy import text

from src import models
from src.auth import create_access_token


@pytest.fixture
def mock_market_data():
    """No yfinance: prices come from the seeded market_prices rows, FX from the stub."""
    with patch("src.services.snapshot_engine.fetch_and_cache_market_prices_range") as prices, \
         patch("src.services.snapshot_engine.fetch_and_cache_exchange_rates_range") as rates:
        # SGD is worth 0.75 home (USD); everything else 1:1.
        def _rates(db, base, target, start, end):
            if base != "SGD":
                return {}
            out, day = {}, start
            while day <= end:
                out[(day, base, target)] = 0.75
                day += timedelta(days=1)
            return out
        rates.side_effect = _rates
        yield prices, rates


def _seed(db, *, email_tag: str, ticker="G3B.SI", currency="USD", pricing_mode="market"):
    user = models.User(
        id=uuid.uuid7(), email=f"asset-edit-{email_tag}@example.com", name="Asset Editor",
        salted_hashed_password="fakehash", salt="fakesalt",
    )
    db.add(user)
    db.flush()
    household = models.Household(
        id=uuid.uuid7(), name=f"Household {email_tag}", base_currency="USD",
        country_code="US", owner_id=user.id,
    )
    db.add(household)
    db.flush()
    sub = models.SubPortfolio(
        id=uuid.uuid7(), household_id=household.id, name="Growth", risk_profile="Moderate",
    )
    account = models.FinancialAccount(
        id=uuid.uuid7(), household_id=household.id, name="Brokerage",
        liquidity="liquid", tax_status="taxable", currency="USD",
    )
    asset = models.Asset(
        id=uuid.uuid7(), ticker=ticker, name="Nikko AM STI ETF", type="stock",
        currency=currency, pricing_mode=pricing_mode,
    )
    db.add_all([sub, account, asset])
    db.commit()
    return user, household, sub, account, asset


def _headers(user):
    return {"Authorization": f"Bearer {create_access_token(data={'sub': str(user.id)})}"}


def _add_trade(db, *, household, sub, asset, account, when: datetime, quantity=100, price=3.0):
    db.add(models.Trade(
        id=uuid.uuid7(), household_id=household.id, sub_portfolio_id=sub.id,
        asset_id=asset.id, account_id=account.id, trade_type=models.TradeType.buy,
        date=when, quantity=quantity, price=price, exchange_rate=1.0,
    ))
    db.commit()


def _add_price(db, ticker: str, day: date, price: float, currency="USD"):
    db.execute(
        text("INSERT INTO finance_tracker.market_prices (id, ticker, date, close_price, currency) "
             "VALUES (:id, :ticker, :d, :p, :cur)"),
        {"id": uuid.uuid7(), "ticker": ticker, "d": day, "p": price, "cur": currency},
    )
    db.commit()


# --- the motivating case -------------------------------------------------


def test_currency_correction_replays_snapshots(client, db_session, mock_market_data):
    """
    A ticker created as USD but actually quoted in SGD: correcting the currency
    must rewrite the home-currency values already snapshotted at 1:1.
    """
    user, household, sub, account, asset = _seed(db_session, email_tag="ccy")
    bought = date.today() - timedelta(days=3)
    _add_trade(db_session, household=household, sub=sub, asset=asset, account=account,
               when=datetime.combine(bought, datetime.min.time(), tzinfo=timezone.utc))
    for offset in range(4):
        _add_price(db_session, "G3B.SI", bought + timedelta(days=offset), 4.0)

    # Snapshot under the wrong currency first: 100 shares * 4.00, no conversion.
    from src.services.snapshot_engine import run_snapshot_range
    run_snapshot_range(db_session, household.id, bought, date.today())
    before = db_session.query(models.PortfolioSnapshot).filter_by(
        household_id=household.id, asset_id=asset.id, date=date.today()).one()
    assert float(before.current_value_home_currency) == pytest.approx(400.0)

    response = client.put(f"/portfolio/assets/{asset.id}", headers=_headers(user),
                          json={"currency": "sgd"})
    assert response.status_code == 200
    assert response.json()["currency"] == "SGD"

    db_session.expire_all()
    after = db_session.query(models.PortfolioSnapshot).filter_by(
        household_id=household.id, asset_id=asset.id, date=date.today()).one()
    # Replayed from the first trade, now converted at 0.75.
    assert float(after.current_value_home_currency) == pytest.approx(300.0)
    assert float(after.exchange_rate_used) == pytest.approx(0.75)

    oldest = db_session.query(models.PortfolioSnapshot).filter_by(
        household_id=household.id, asset_id=asset.id, date=bought).one()
    assert float(oldest.exchange_rate_used) == pytest.approx(0.75)


def test_currency_change_relabels_manual_prices(client, db_session, mock_market_data):
    """Hand-recorded prices are the user's own data — they survive, relabelled."""
    user, household, sub, account, asset = _seed(
        db_session, email_tag="manual-ccy", ticker="SSB-2026", pricing_mode="manual")
    _add_price(db_session, "SSB-2026", date.today(), 1.02)

    response = client.put(f"/portfolio/assets/{asset.id}", headers=_headers(user),
                          json={"currency": "SGD"})
    assert response.status_code == 200

    rows = db_session.query(models.MarketPrice).filter_by(ticker="SSB-2026").all()
    assert len(rows) == 1
    assert rows[0].currency == "SGD"


def test_market_price_cache_dropped_for_market_assets(client, db_session, mock_market_data):
    """A market asset's cached closes belong to the old symbol; refetch instead."""
    user, household, sub, account, asset = _seed(db_session, email_tag="cache", ticker="G3B")
    _add_price(db_session, "G3B", date.today(), 4.0)

    response = client.put(f"/portfolio/assets/{asset.id}", headers=_headers(user),
                          json={"ticker": "g3b.si"})
    assert response.status_code == 200
    assert response.json()["ticker"] == "G3B.SI"

    assert db_session.query(models.MarketPrice).filter_by(ticker="G3B").count() == 0


def test_ticker_rename_carries_manual_prices(client, db_session, mock_market_data):
    user, household, sub, account, asset = _seed(
        db_session, email_tag="manual-rename", ticker="SSB-OLD", pricing_mode="manual")
    _add_price(db_session, "SSB-OLD", date.today(), 1.05)

    response = client.put(f"/portfolio/assets/{asset.id}", headers=_headers(user),
                          json={"ticker": "SSB-NEW"})
    assert response.status_code == 200

    assert db_session.query(models.MarketPrice).filter_by(ticker="SSB-OLD").count() == 0
    moved = db_session.query(models.MarketPrice).filter_by(ticker="SSB-NEW").all()
    assert len(moved) == 1
    assert float(moved[0].close_price) == pytest.approx(1.05)


# --- guards --------------------------------------------------------------


def test_name_only_edit_leaves_snapshots_alone(client, db_session, mock_market_data):
    user, household, sub, account, asset = _seed(db_session, email_tag="name")
    bought = date.today() - timedelta(days=2)
    _add_trade(db_session, household=household, sub=sub, asset=asset, account=account,
               when=datetime.combine(bought, datetime.min.time(), tzinfo=timezone.utc))
    _add_price(db_session, "G3B.SI", date.today(), 4.0)

    with patch("src.routers.portfolio.run_snapshot_range") as replay:
        response = client.put(f"/portfolio/assets/{asset.id}", headers=_headers(user),
                              json={"name": "  Nikko AM Singapore STI ETF  "})
        assert response.status_code == 200
        assert response.json()["name"] == "Nikko AM Singapore STI ETF"
        replay.assert_not_called()


def test_duplicate_ticker_rejected(client, db_session, mock_market_data):
    user, household, sub, account, asset = _seed(db_session, email_tag="dupe", ticker="OLD1")
    db_session.add(models.Asset(id=uuid.uuid7(), ticker="TAKEN", name="Taken",
                                type="stock", currency="USD"))
    db_session.commit()

    response = client.put(f"/portfolio/assets/{asset.id}", headers=_headers(user),
                          json={"ticker": "taken"})
    assert response.status_code == 409


def test_pseudo_assets_cannot_be_edited(client, db_session, mock_market_data):
    user, household, sub, account, asset = _seed(db_session, email_tag="pseudo")
    cash = models.Asset(id=uuid.uuid7(), ticker=models.cash_ticker("USD"), name="US Dollar",
                        type=models.CASH_ASSET_TYPE, currency="USD",
                        pricing_mode=models.PRICING_MODE_MANUAL)
    db_session.add(cash)
    db_session.commit()

    response = client.put(f"/portfolio/assets/{cash.id}", headers=_headers(user),
                          json={"currency": "SGD"})
    assert response.status_code == 400


def test_cannot_promote_an_asset_into_a_pseudo_type(client, db_session, mock_market_data):
    user, household, sub, account, asset = _seed(db_session, email_tag="promote")
    response = client.put(f"/portfolio/assets/{asset.id}", headers=_headers(user),
                          json={"type": models.LINKED_ACCOUNT_ASSET_TYPE})
    assert response.status_code == 400


def test_cannot_edit_an_asset_only_another_household_holds(client, db_session, mock_market_data):
    owner, household, sub, account, asset = _seed(db_session, email_tag="theirs", ticker="THEIRS")
    _add_trade(db_session, household=household, sub=sub, asset=asset, account=account,
               when=datetime.now(timezone.utc))

    outsider = models.User(id=uuid.uuid7(), email="asset-edit-outsider@example.com",
                           name="Outsider", salted_hashed_password="fakehash", salt="fakesalt")
    db_session.add(outsider)
    db_session.commit()

    response = client.put(f"/portfolio/assets/{asset.id}", headers=_headers(outsider),
                          json={"currency": "SGD"})
    assert response.status_code == 403
    db_session.expire_all()
    assert db_session.get(models.Asset, asset.id).currency == "USD"


def test_untraded_asset_is_editable_by_anyone_who_can_see_it(client, db_session, mock_market_data):
    """Freshly created assets have no trades yet; the create form's typo is the
    most likely thing to need fixing, so don't lock it behind ownership."""
    user, household, sub, account, asset = _seed(db_session, email_tag="untraded", ticker="FRESH")
    response = client.put(f"/portfolio/assets/{asset.id}", headers=_headers(user),
                          json={"currency": "SGD", "name": "Fresh Ltd"})
    assert response.status_code == 200
    assert response.json()["currency"] == "SGD"


def test_empty_ticker_rejected(client, db_session, mock_market_data):
    user, household, sub, account, asset = _seed(db_session, email_tag="empty", ticker="EMPTYCASE")
    response = client.put(f"/portfolio/assets/{asset.id}", headers=_headers(user),
                          json={"ticker": "   "})
    assert response.status_code == 400


def test_update_requires_auth(client, db_session, mock_market_data):
    _, _, _, _, asset = _seed(db_session, email_tag="anon", ticker="ANON")
    assert client.put(f"/portfolio/assets/{asset.id}", json={"currency": "SGD"}).status_code == 401
