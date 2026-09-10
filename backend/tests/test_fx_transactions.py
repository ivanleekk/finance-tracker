"""
Foreign-currency transactions: the rate is pulled for the transaction's own
date, it is *never* silently 1.0, and an edit re-derives it.

The rate on a transaction is not like the rate on a snapshot. A snapshot is
recomputed, so a bad rate heals; a transaction's rate is frozen into the
balance chain and into `amount_home_currency` the moment it is written, and
nothing later goes back to check. These pin the three ways that can go wrong:
a missing rate, a stale rate after an edit, and a rate that ignores the spread
the user actually paid.
"""

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import patch

import pytest

from src import models

# A yen amount and a rate chosen so every expected figure is exact in cents.
JPY_PER_SGD = 0.01  # 1 JPY = 0.01 SGD
SGD_PER_USD = 2.0   # 1 SGD = 2.00 USD (nonsense as economics, exact as arithmetic)


@pytest.fixture
def user(db_session):
    u = models.User(
        id=uuid.uuid7(), email="fx@example.com", name="FX User",
        salted_hashed_password="fakehash", salt="fakesalt",
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
    """Base currency USD, so an SGD account exercises the account→home leg too."""
    h = models.Household(
        id=uuid.uuid7(), name="FX Household", base_currency="USD",
        country_code="SG", owner_id=user.id,
    )
    db_session.add(h)
    db_session.commit()
    return h


@pytest.fixture
def account(db_session, household):
    a = models.FinancialAccount(
        id=uuid.uuid7(), household_id=household.id, name="DBS SGD",
        liquidity="liquid", tax_status="taxable", currency="SGD",
    )
    db_session.add(a)
    db_session.commit()
    return a


@pytest.fixture
def dining(db_session, household):
    c = models.Category(
        id=uuid.uuid7(), household_id=household.id, name="Dining", type="expense",
    )
    db_session.add(c)
    db_session.commit()
    return c


def _rates(mapping, default=None):
    """Patch the rate lookup with a fixed table, so no test touches the network."""
    def fake(db, base, target, on_date, *, strict=False):
        base, target = base.upper(), target.upper()
        if base == target:
            return 1.0
        if (base, target) in mapping:
            return mapping[(base, target)]
        if default is not None:
            return default
        from src.services.market_data import ExchangeRateUnavailable
        if strict:
            raise ExchangeRateUnavailable(base, target, on_date)
        return 1.0
    return patch("src.services.transaction_service.fetch_and_cache_exchange_rates", side_effect=fake)


def _post(client, headers, account, category, **body):
    payload = {
        "account_id": str(account.id),
        "category_id": str(category.id),
        "date": "2026-03-04T12:00:00Z",
        "amount": 12000,
        **body,
    }
    return client.post("/cashflow/transactions", json=payload, headers=headers)


def _balance(db_session, account):
    row = (
        db_session.query(models.AccountBalance)
        .filter(models.AccountBalance.account_id == account.id)
        .order_by(models.AccountBalance.date.desc())
        .first()
    )
    return Decimal(str(row.balance)) if row else None


def test_a_foreign_currency_charge_converts_into_the_account_and_home_figures(
    client, db_session, headers, account, dining
):
    """¥12,000 on an SGD account in a USD household: S$120 off the chain, US$240 in the rollups."""
    with _rates({("JPY", "SGD"): JPY_PER_SGD, ("SGD", "USD"): SGD_PER_USD}):
        response = _post(client, headers, account, dining, currency="JPY")

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["currency"] == "JPY"
    assert body["exchange_rate"] == pytest.approx(JPY_PER_SGD)
    # The home figure is the account figure converted on, not a second
    # independent lookup that could disagree with the balance chain.
    assert Decimal(body["amount_home_currency"]) == Decimal("240.00")
    assert _balance(db_session, account) == Decimal("-120.00")


def test_a_rate_that_cannot_be_found_is_refused_rather_than_treated_as_one(
    client, db_session, headers, account, dining
):
    """
    The bug this exists for: the lookup used to end in `return 1.0`, which
    booked ¥12,000 as S$12,000 and said nothing.
    """
    with _rates({("SGD", "USD"): SGD_PER_USD}):  # no JPY→SGD pair
        response = _post(client, headers, account, dining, currency="JPY")

    assert response.status_code == 422, response.text
    detail = response.json()
    assert detail["exchange_rate_unavailable"] == {
        "base": "JPY", "target": "SGD", "date": "2026-03-04",
    }
    # Nothing was written: no half-posted row, no moved balance.
    assert db_session.query(models.Transaction).count() == 0
    assert _balance(db_session, account) is None


def test_the_amount_actually_charged_defines_the_rate_and_skips_the_lookup(
    client, db_session, headers, account, dining
):
    """
    The user's statement beats the mid-market close: ¥12,000 charged as S$124.80
    is a rate of 0.0104, spread included, and needs no JPY quote at all.
    """
    with _rates({("SGD", "USD"): SGD_PER_USD}) as fake:  # deliberately no JPY pair
        response = _post(client, headers, account, dining, currency="JPY", amount_charged=124.80)

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["exchange_rate"] == pytest.approx(0.0104)
    assert _balance(db_session, account) == Decimal("-124.80")
    # The only pair asked for is the account's own → home; the JPY leg was derived.
    assert {(c.args[1].upper(), c.args[2].upper()) for c in fake.mock_calls if c.args} == {("SGD", "USD")}


def test_correcting_a_transactions_currency_re_derives_its_rate(
    client, db_session, headers, account, dining
):
    """
    The stale-rate bug: the edit path recomputed `amount_home_currency` but
    reused the old `exchange_rate`, so switching a row from SGD to JPY applied
    a 1:1 rate to a yen figure and took S$12,000 off the account.
    """
    with _rates({("SGD", "USD"): SGD_PER_USD}):
        created = _post(client, headers, account, dining, currency="SGD")
    assert created.status_code == 201, created.text
    assert _balance(db_session, account) == Decimal("-12000.00")

    with _rates({("JPY", "SGD"): JPY_PER_SGD, ("SGD", "USD"): SGD_PER_USD}):
        edited = client.put(
            f"/cashflow/transactions/{created.json()['id']}",
            json={"currency": "JPY"},
            headers=headers,
        )

    assert edited.status_code == 200, edited.text
    assert edited.json()["exchange_rate"] == pytest.approx(JPY_PER_SGD)
    assert Decimal(edited.json()["amount_home_currency"]) == Decimal("240.00")
    assert _balance(db_session, account) == Decimal("-120.00")


def test_editing_something_unrelated_leaves_the_recorded_rate_alone(
    client, db_session, headers, account, dining
):
    """A description fix must not re-price a transaction at today's rate."""
    with _rates({("JPY", "SGD"): JPY_PER_SGD, ("SGD", "USD"): SGD_PER_USD}):
        created = _post(client, headers, account, dining, currency="JPY")
    assert created.status_code == 201, created.text

    # No rate table at all: if the edit tried to look one up, it would refuse.
    with _rates({}):
        edited = client.put(
            f"/cashflow/transactions/{created.json()['id']}",
            json={"description": "Ramen, not sushi"},
            headers=headers,
        )

    assert edited.status_code == 200, edited.text
    assert edited.json()["exchange_rate"] == pytest.approx(JPY_PER_SGD)
    assert _balance(db_session, account) == Decimal("-120.00")


def test_an_explicit_rate_is_carried_into_the_home_figure_too(
    client, db_session, headers, account, dining
):
    """
    A caller-supplied rate is the whole answer for the account leg, and it has
    to reach the home figure as well — deriving that from a mid-market close
    instead would report a different sum than the account actually moved by.
    """
    with _rates({("SGD", "USD"): SGD_PER_USD}):
        response = _post(client, headers, account, dining, currency="JPY", exchange_rate=0.011)

    assert response.status_code == 201, response.text
    assert _balance(db_session, account) == Decimal("-132.00")
    assert Decimal(response.json()["amount_home_currency"]) == Decimal("264.00")


def test_the_journal_line_records_the_rate_that_reconciles_its_own_numbers(
    client, db_session, headers, account, dining
):
    """
    The line's debit/credit are in home currency, so the rate stored beside its
    native amount has to be native→home. Storing the native→account rate made
    ¥12,000 × 0.01 read as US$240 on the same line.
    """
    with _rates({("JPY", "SGD"): JPY_PER_SGD, ("SGD", "USD"): SGD_PER_USD}):
        response = _post(client, headers, account, dining, currency="JPY")
    assert response.status_code == 201, response.text

    ledger_account = (
        db_session.query(models.LedgerAccount)
        .filter(models.LedgerAccount.financial_account_id == account.id)
        .one()
    )
    line = (
        db_session.query(models.JournalLine)
        .filter(models.JournalLine.ledger_account_id == ledger_account.id)
        .one()
    )
    assert line.native_currency == "JPY"
    assert Decimal(str(line.native_amount)) == Decimal("12000")
    assert line.exchange_rate == pytest.approx(0.02)  # JPY → USD, not JPY → SGD
    assert Decimal(str(line.credit)) == Decimal("240.00")
