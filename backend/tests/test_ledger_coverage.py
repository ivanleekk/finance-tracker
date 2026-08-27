"""
The rest of what moves money: trades and manual reconciliations.

The ledger was introduced with transactions and transfers posting; these are the
two flows added afterwards. What matters is not that entries exist but that they
say the right thing — a trade is a *cash* movement (the holding itself lives in
the snapshot engine, deliberately outside the journal), and a reconciliation is a
one-sided fact that has to land somewhere other than real spending.
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest

from src import models
from src.services import ledger_service as ledger


@pytest.fixture
def user(db_session):
    row = models.User(
        id=uuid.uuid7(),
        email="coverage@example.com",
        name="Coverage User",
        salted_hashed_password="fakehash",
        salt="fakesalt",
    )
    db_session.add(row)
    db_session.commit()
    return row


@pytest.fixture
def headers(client, user):
    from src.auth import create_access_token

    return {"Authorization": f"Bearer {create_access_token(data={'sub': str(user.id)})}"}


@pytest.fixture
def household(db_session, user):
    row = models.Household(
        id=uuid.uuid7(),
        name="Coverage Household",
        base_currency="USD",
        country_code="US",
        owner_id=user.id,
    )
    db_session.add(row)
    db_session.commit()
    return row


@pytest.fixture
def account(db_session, household):
    row = models.FinancialAccount(
        id=uuid.uuid7(),
        household_id=household.id,
        name="Brokerage Cash",
        liquidity=models.LiquidityStatus.liquid,
        tax_status=models.TaxTreatment.taxable,
        kind=models.AccountKind.asset,
        currency="USD",
    )
    db_session.add(row)
    db_session.commit()
    return row


@pytest.fixture
def subportfolio(db_session, household):
    row = models.SubPortfolio(
        id=uuid.uuid7(), household_id=household.id, name="Main", risk_profile="high"
    )
    db_session.add(row)
    db_session.commit()
    return row


@pytest.fixture
def asset(db_session):
    row = models.Asset(
        id=uuid.uuid7(), ticker="LEDG", name="Ledger Corp", type="stock", currency="USD"
    )
    db_session.add(row)
    db_session.commit()
    return row


def _entries(db_session, household):
    return (
        db_session.query(models.JournalEntry)
        .filter(models.JournalEntry.household_id == household.id)
        .all()
    )


def _lines_by_role(db_session, entry):
    out = {}
    for line in entry.lines:
        chart = (
            db_session.query(models.LedgerAccount)
            .filter(models.LedgerAccount.id == line.ledger_account_id)
            .one()
        )
        out[chart.role] = (ledger._dec(line.debit), ledger._dec(line.credit))
    return out


def _buy(client, headers, household, subportfolio, asset, account, *, quantity=10, price="100.00"):
    response = client.post(
        "/portfolio/trades",
        headers=headers,
        json={
            "household_id": str(household.id),
            "sub_portfolio_id": str(subportfolio.id),
            "asset_id": str(asset.id),
            "account_id": str(account.id),
            "type": "buy",
            "date": datetime(2026, 8, 10, 12, tzinfo=timezone.utc).isoformat(),
            "quantity": quantity,
            "price": price,
            "exchange_rate": 1.0,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


# ---------------------------------------------------------------------------
# Trades
# ---------------------------------------------------------------------------


def test_a_buy_takes_cash_out_of_the_funding_account(
    client, db_session, headers, household, subportfolio, asset, account
):
    """
    A buy is money leaving a real account, so the ledger has to show it leaving.
    The shares it bought are not in the journal at all — snapshot_engine values
    holdings, and posting one entry per holding per day would be an enormous
    volume of rows for something it already does well.
    """
    _buy(client, headers, household, subportfolio, asset, account)

    db_session.expire_all()
    entries = _entries(db_session, household)
    assert len(entries) == 1
    roles = _lines_by_role(db_session, entries[0])
    # Debit the category, credit the account: the transaction's own shape.
    assert roles[models.LedgerAccountRole.category] == (Decimal("1000"), Decimal("0"))
    assert roles[models.LedgerAccountRole.cash] == (Decimal("0"), Decimal("1000"))


def test_editing_a_trade_replaces_its_entry_rather_than_adding_one(
    client, db_session, headers, household, subportfolio, asset, account
):
    trade_id = _buy(client, headers, household, subportfolio, asset, account)
    response = client.put(
        f"/portfolio/trades/{trade_id}",
        headers=headers,
        json={"quantity": 4, "price": "100.00"},
    )
    assert response.status_code == 200, response.text

    db_session.expire_all()
    entries = _entries(db_session, household)
    assert len(entries) == 1
    roles = _lines_by_role(db_session, entries[0])
    assert roles[models.LedgerAccountRole.cash] == (Decimal("0"), Decimal("400"))


def test_deleting_a_trade_takes_its_entry_with_it(
    client, db_session, headers, household, subportfolio, asset, account
):
    trade_id = _buy(client, headers, household, subportfolio, asset, account)
    assert client.delete(f"/portfolio/trades/{trade_id}", headers=headers).status_code == 204

    db_session.expire_all()
    assert _entries(db_session, household) == []


def test_a_sell_brings_cash_back_in(
    client, db_session, headers, household, subportfolio, asset, account
):
    _buy(client, headers, household, subportfolio, asset, account)
    response = client.post(
        "/portfolio/trades",
        headers=headers,
        json={
            "household_id": str(household.id),
            "sub_portfolio_id": str(subportfolio.id),
            "asset_id": str(asset.id),
            "account_id": str(account.id),
            "type": "sell",
            "date": datetime(2026, 8, 12, 12, tzinfo=timezone.utc).isoformat(),
            "quantity": 5,
            "price": "120.00",
            "exchange_rate": 1.0,
        },
    )
    assert response.status_code == 201, response.text

    db_session.expire_all()
    sell = [e for e in _entries(db_session, household) if e.date.day == 12][0]
    roles = _lines_by_role(db_session, sell)
    # The mirror image of a buy: cash in, category credited.
    assert roles[models.LedgerAccountRole.cash] == (Decimal("600"), Decimal("0"))
    assert roles[models.LedgerAccountRole.category] == (Decimal("0"), Decimal("600"))


def test_a_cash_settled_trade_posts_nothing(
    client, db_session, headers, household, subportfolio, asset, account
):
    """
    Settling from the sub-portfolio's own cash moves no household account, so
    there is no transaction and there must be no entry either — the same
    boundary that keeps holdings out of the journal.
    """
    deposit = client.post(
        f"/portfolio/subportfolios/{subportfolio.id}/cash",
        headers=headers,
        json={
            "household_id": str(household.id),
            "account_id": str(account.id),
            "amount": "5000.00",
            "currency": "USD",
            "date": datetime(2026, 8, 1, 12, tzinfo=timezone.utc).isoformat(),
            "direction": "deposit",
        },
    )
    assert deposit.status_code in (200, 201), deposit.text

    db_session.expire_all()
    before = len(_entries(db_session, household))

    response = client.post(
        "/portfolio/trades",
        headers=headers,
        json={
            "household_id": str(household.id),
            "sub_portfolio_id": str(subportfolio.id),
            "asset_id": str(asset.id),
            "account_id": str(account.id),
            "type": "buy",
            "date": datetime(2026, 8, 5, 12, tzinfo=timezone.utc).isoformat(),
            "quantity": 2,
            "price": "100.00",
            "exchange_rate": 1.0,
            "settle_from_cash": True,
        },
    )
    assert response.status_code == 201, response.text

    db_session.expire_all()
    assert len(_entries(db_session, household)) == before


# ---------------------------------------------------------------------------
# Manual reconciliations
# ---------------------------------------------------------------------------


def _reconcile(client, headers, account, amount, on=date(2026, 8, 15)):
    return client.post(
        "/accounts/balances",
        headers=headers,
        json={
            "account_id": str(account.id),
            "date": on.isoformat(),
            "balance": str(amount),
        },
    )


def test_a_reconciliation_lands_in_equity_not_in_spending(
    client, db_session, headers, household, account
):
    """
    "This account holds 500" says nothing about where the money came from.
    Equity is where the unexplained belongs; putting it in a category would make
    a bookkeeping correction look like real income or real spending.
    """
    assert _reconcile(client, headers, account, 500).status_code in (200, 201)

    db_session.expire_all()
    entries = _entries(db_session, household)
    assert len(entries) == 1
    roles = _lines_by_role(db_session, entries[0])
    assert roles[models.LedgerAccountRole.cash] == (Decimal("500"), Decimal("0"))
    assert roles[models.LedgerAccountRole.adjustment] == (Decimal("0"), Decimal("500"))
    assert models.LedgerAccountRole.category not in roles


def test_a_downward_reconciliation_reverses_the_plug(
    client, db_session, headers, household, account
):
    assert _reconcile(client, headers, account, 500).status_code in (200, 201)
    assert _reconcile(
        client, headers, account, 300, on=date(2026, 8, 20)
    ).status_code in (200, 201)

    db_session.expire_all()
    later = [e for e in _entries(db_session, household) if e.date.day == 20][0]
    roles = _lines_by_role(db_session, later)
    # The account lost 200, so the plug absorbs it on the other side.
    assert roles[models.LedgerAccountRole.cash] == (Decimal("0"), Decimal("200"))
    assert roles[models.LedgerAccountRole.adjustment] == (Decimal("200"), Decimal("0"))


def test_a_reconciliation_that_changes_nothing_posts_nothing(
    client, db_session, headers, household, account
):
    assert _reconcile(client, headers, account, 500).status_code in (200, 201)
    db_session.expire_all()
    before = len(_entries(db_session, household))

    assert _reconcile(
        client, headers, account, 500, on=date(2026, 8, 21)
    ).status_code in (200, 201)

    db_session.expire_all()
    assert len(_entries(db_session, household)) == before


def test_the_adjustment_carries_its_home_currency_value(
    client, db_session, headers, household, account
):
    """
    The budget rollups read `amount_home_currency` and fall back to the raw
    amount. On a foreign-currency account that fallback is a different number
    wearing the same label, so the row has to carry the converted figure.
    """
    assert _reconcile(client, headers, account, 500).status_code in (200, 201)

    db_session.expire_all()
    adjustment = (
        db_session.query(models.Transaction)
        .join(models.Category, models.Transaction.category_id == models.Category.id)
        .filter(models.Category.name == models.SYSTEM_CATEGORY_BALANCE_ADJUSTMENT)
        .one()
    )
    assert adjustment.amount_home_currency is not None
    assert Decimal(str(adjustment.amount_home_currency)) == Decimal("500")


def test_the_books_still_balance_across_trades_and_reconciliations(
    client, db_session, headers, household, subportfolio, asset, account
):
    _buy(client, headers, household, subportfolio, asset, account)
    _reconcile(client, headers, account, 500)

    db_session.expire_all()
    debits, credits = ledger.trial_balance(db_session, household.id)
    assert debits == credits
    assert debits > 0
