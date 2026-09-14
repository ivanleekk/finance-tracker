"""
The last places a missing exchange rate could still become 1.0 (#271).

`resolve_rates` made a transaction's rates strict, and `create_transfer` did the
same for transfers. Three more writes froze a looked-up rate into stored money
with the old fallback: a reimbursement settlement, the cash row a trade posts,
and a manual or opening balance. Each now works the rate out *through the
account's own currency* where it can — so a home-currency account needs no
lookup at all — and refuses with a 422 where it can't, before anything is
written.

What deliberately stays lenient is the balance chain's own home stamp
(`sync_transaction_to_balances`, `propagate_balance_change`). Every write that
reaches it has already passed a strict lookup for the same pair and date; the
only thing that can reach it without one is the reversal of a row written
before rates were strict, and refusing *that* would make an already-wrong row
impossible to delete.
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from unittest.mock import patch

import pytest

from src import models
from src.services.market_data import ExchangeRateUnavailable

# Household base is USD. SGD has a rate; XTS (the ISO "testing" code) has none.
RATES = {("SGD", "USD"): 0.75, ("JPY", "USD"): 0.0068, ("JPY", "SGD"): 0.009}
ON = "2026-03-04T12:00:00Z"


def _rate(db, base, target, on_date, *, strict=False, **kw):
    base, target = base.upper(), target.upper()
    if base == target:
        return 1.0
    if (base, target) in RATES:
        return RATES[(base, target)]
    if strict:
        raise ExchangeRateUnavailable(base, target, on_date)
    return 1.0


@pytest.fixture(autouse=True)
def no_network():
    """
    Every lookup goes through a fixed table. The balance chain's lookups get the
    *lenient* behaviour production has, so if one of them is ever made strict
    the legacy-delete test below fails.
    """
    with patch("src.services.transaction_service.fetch_and_cache_exchange_rates", side_effect=_rate), \
         patch("src.services.account_service.fetch_and_cache_exchange_rates", side_effect=_rate), \
         patch("src.services.account_service.fetch_and_cache_exchange_rates_range", return_value={}):
        yield


@pytest.fixture
def user(db_session):
    u = models.User(
        id=uuid.uuid7(), email="strict@example.com", name="Strict",
        salted_hashed_password="x", salt="x",
    )
    db_session.add(u)
    db_session.commit()
    return u


@pytest.fixture
def headers(user):
    from src.auth import create_access_token
    return {"Authorization": f"Bearer {create_access_token(data={'sub': str(user.id)})}"}


@pytest.fixture
def household(db_session, user):
    h = models.Household(
        id=uuid.uuid7(), name="Strict HH", base_currency="USD", country_code="US", owner_id=user.id,
    )
    db_session.add(h)
    db_session.commit()
    return h


def _account(db_session, household, currency):
    a = models.FinancialAccount(
        id=uuid.uuid7(), household_id=household.id, name=f"{currency} account",
        liquidity="liquid", tax_status="taxable", currency=currency,
    )
    db_session.add(a)
    db_session.commit()
    return a


def _count(db_session, model, **filters):
    db_session.expire_all()
    return db_session.query(model).filter_by(**filters).count()


# --- Settling a reimbursement -------------------------------------------------


@pytest.fixture
def alice(db_session, household):
    c = models.Counterparty(id=uuid.uuid7(), household_id=household.id, name="Alice")
    db_session.add(c)
    db_session.commit()
    return c


def _settle(client, headers, account, counterparty):
    return client.post(
        "/cashflow/reimbursements/settle",
        json={
            "account_id": str(account.id), "counterparty_id": str(counterparty.id),
            "direction": "owed_to_you", "amount": "40", "date": ON,
        },
        headers=headers,
    )


def test_a_settlement_with_no_rate_is_refused_and_writes_nothing(client, db_session, headers, household, alice):
    odd = _account(db_session, household, "XTS")
    res = _settle(client, headers, odd, alice)
    assert res.status_code == 422, res.text
    assert res.json()["exchange_rate_unavailable"]["base"] == "XTS"
    assert _count(db_session, models.Transaction, account_id=odd.id) == 0


def test_a_settlement_on_a_foreign_account_is_valued_at_its_rate(client, db_session, headers, household, alice):
    sgd = _account(db_session, household, "SGD")
    assert _settle(client, headers, sgd, alice).status_code == 201
    db_session.expire_all()
    txn = db_session.query(models.Transaction).filter_by(account_id=sgd.id).one()
    assert Decimal(str(txn.amount_home_currency)) == Decimal("30.00")


# --- A trade's cash row -------------------------------------------------------


@pytest.fixture
def sub_portfolio(db_session, household):
    s = models.SubPortfolio(id=uuid.uuid7(), household_id=household.id, name="Core", risk_profile="high")
    db_session.add(s)
    db_session.commit()
    return s


@pytest.fixture(autouse=True)
def no_market_engines():
    """Snapshots and dividend sync reach yfinance for the asset; neither is under test."""
    with patch("src.routers.portfolio.run_snapshot_range"), patch("src.routers.portfolio.sync_dividends_range"):
        yield


@pytest.fixture
def jpy_stock(db_session):
    a = models.Asset(id=uuid.uuid7(), ticker="7203.T", name="Toyota", type="stock", currency="JPY")
    db_session.add(a)
    db_session.commit()
    return a


def _trade(client, headers, household, sub_portfolio, asset, account, exchange_rate):
    return client.post(
        "/portfolio/trades",
        json={
            "household_id": str(household.id), "sub_portfolio_id": str(sub_portfolio.id),
            "asset_id": str(asset.id), "account_id": str(account.id), "type": "buy",
            "date": ON, "quantity": 10, "price": "1000", "exchange_rate": exchange_rate,
        },
        headers=headers,
    )


def test_a_trade_from_a_home_currency_account_needs_no_lookup(
    client, db_session, headers, household, sub_portfolio, jpy_stock
):
    """
    ¥10,000 at the trade's own rate of 0.007 is US$70 out of the account, and the
    account *is* home currency — so US$70 is the home value. The old code looked
    JPY→USD up separately, which could return 1.0 and value the trade at US$10,000.
    """
    usd = _account(db_session, household, "USD")
    with patch.dict(RATES, {}, clear=True):  # no rate exists for anything
        res = _trade(client, headers, household, sub_portfolio, jpy_stock, usd, 0.007)
    assert res.status_code == 201, res.text
    db_session.expire_all()
    txn = db_session.query(models.Transaction).filter_by(account_id=usd.id).one()
    assert Decimal(str(txn.amount_home_currency)) == Decimal("70.00")


def test_a_trade_from_a_foreign_account_is_valued_through_that_account(
    client, db_session, headers, household, sub_portfolio, jpy_stock
):
    sgd = _account(db_session, household, "SGD")
    res = _trade(client, headers, household, sub_portfolio, jpy_stock, sgd, 0.009)
    assert res.status_code == 201, res.text
    db_session.expire_all()
    txn = db_session.query(models.Transaction).filter_by(account_id=sgd.id).one()
    # ¥10,000 × 0.009 = S$90 out of the account; × 0.75 = US$67.50.
    assert Decimal(str(txn.amount_home_currency)) == Decimal("67.50")


def test_a_trade_from_an_account_with_no_rate_is_refused_and_writes_nothing(
    client, db_session, headers, household, sub_portfolio, jpy_stock
):
    odd = _account(db_session, household, "XTS")
    res = _trade(client, headers, household, sub_portfolio, jpy_stock, odd, 1.0)
    assert res.status_code == 422, res.text
    assert _count(db_session, models.Trade, account_id=odd.id) == 0
    assert _count(db_session, models.Transaction, account_id=odd.id) == 0


# --- Manual and opening balances ----------------------------------------------


def test_a_balance_with_no_rate_is_refused_and_writes_nothing(client, db_session, headers, household):
    odd = _account(db_session, household, "XTS")
    res = client.post(
        "/accounts/balances",
        json={"account_id": str(odd.id), "date": "2026-03-04", "balance": "500"},
        headers=headers,
    )
    assert res.status_code == 422, res.text
    assert _count(db_session, models.AccountBalance, account_id=odd.id) == 0


def test_editing_a_balance_with_no_rate_is_refused_and_leaves_it(client, db_session, headers, household):
    odd = _account(db_session, household, "XTS")
    row = models.AccountBalance(
        id=uuid.uuid7(), account_id=odd.id, date=date(2026, 3, 4),
        balance=Decimal("500"), balance_home_currency=Decimal("500"), is_manual=False,
    )
    db_session.add(row)
    db_session.commit()
    res = client.put(f"/accounts/balances/{row.id}", json={"balance": "650"}, headers=headers)
    assert res.status_code == 422, res.text
    db_session.expire_all()
    assert db_session.get(models.AccountBalance, row.id).balance == Decimal("500")


def test_a_foreign_balance_is_stamped_at_its_rate(client, db_session, headers, household):
    sgd = _account(db_session, household, "SGD")
    res = client.post(
        "/accounts/balances",
        json={"account_id": str(sgd.id), "date": "2026-03-04", "balance": "400"},
        headers=headers,
    )
    assert res.status_code == 201, res.text
    assert Decimal(str(res.json()["balance_home_currency"])) == Decimal("300")


# --- What stays lenient -------------------------------------------------------


def test_a_row_written_before_rates_were_strict_can_still_be_deleted(client, db_session, headers, household):
    """
    A legacy row on an account whose currency never had a rate was already
    valued 1:1. Deleting it is how the user gets rid of that, so the reversal
    must not refuse for the very rate that is missing.
    """
    odd = _account(db_session, household, "XTS")
    cat = models.Category(id=uuid.uuid7(), household_id=household.id, name="Dining", type="expense")
    db_session.add(cat)
    db_session.flush()
    txn = models.Transaction(
        id=uuid.uuid7(), account_id=odd.id, category_id=cat.id,
        date=datetime(2026, 3, 4, 12, tzinfo=timezone.utc), amount=Decimal("25"),
        amount_home_currency=Decimal("25"), currency="XTS", exchange_rate=1.0,
        transaction_type=models.TransactionType.expense,
    )
    db_session.add(txn)
    db_session.add(models.AccountBalance(
        id=uuid.uuid7(), account_id=odd.id, date=date(2026, 3, 4),
        balance=Decimal("-25"), balance_home_currency=Decimal("-25"), is_manual=False,
    ))
    db_session.commit()

    assert client.delete(f"/cashflow/transactions/{txn.id}", headers=headers).status_code in (200, 204)
    assert _count(db_session, models.Transaction, account_id=odd.id) == 0
