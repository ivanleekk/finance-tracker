"""Tests for /cashflow/transfers: paired transactions, balances, currency conversion, authz."""
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import patch

import pytest

from src import models
from src.auth import create_access_token


@pytest.fixture
def owner(db_session):
    user = models.User(
        id=uuid.uuid7(), email="transfer_owner@example.com", name="Owner",
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
        id=uuid.uuid7(), name="Transfer HH", base_currency="USD", country_code="US", owner_id=owner.id,
    )
    db_session.add(hh)
    db_session.flush()
    db_session.add(models.HouseholdMember(
        id=uuid.uuid7(), household_id=hh.id, user_id=owner.id, role=models.HouseholdRoleType.owner,
    ))
    db_session.commit()
    return hh


def _account(db_session, household, name, currency="USD"):
    acc = models.FinancialAccount(
        id=uuid.uuid7(), household_id=household.id, name=name,
        liquidity="liquid", tax_status="taxable", currency=currency,
    )
    db_session.add(acc)
    db_session.commit()
    return acc


def _balance(db_session, account, amount):
    db_session.add(models.AccountBalance(
        id=uuid.uuid7(), account_id=account.id,
        date=datetime(2024, 1, 1, tzinfo=timezone.utc).date(), balance=Decimal(amount),
    ))
    db_session.commit()


def test_transfer_creates_paired_transactions(client, headers, db_session, household):
    src = _account(db_session, household, "Checking")
    dst = _account(db_session, household, "Savings")
    _balance(db_session, src, "1000")
    _balance(db_session, dst, "0")

    response = client.post(
        "/cashflow/transfers",
        headers=headers,
        json={
            "from_account_id": str(src.id),
            "to_account_id": str(dst.id),
            "amount": "250.00",
            "date": "2024-01-05T12:00:00Z",
            "description": "Monthly savings",
        },
    )
    assert response.status_code == 201
    withdrawal, deposit = response.json()

    assert withdrawal["transaction_type"] == "expense"
    assert deposit["transaction_type"] == "income"
    assert withdrawal["transfer_id"] == deposit["transfer_id"]
    assert Decimal(withdrawal["amount"]) == Decimal("250.00")
    assert Decimal(deposit["amount"]) == Decimal("250.00")

    # Balances synced: source down, destination up
    src_balances = {b.date.isoformat(): b.balance for b in db_session.query(models.AccountBalance).filter_by(account_id=src.id)}
    dst_balances = {b.date.isoformat(): b.balance for b in db_session.query(models.AccountBalance).filter_by(account_id=dst.id)}
    assert Decimal(src_balances["2024-01-05"]) == Decimal("750.00")
    assert Decimal(dst_balances["2024-01-05"]) == Decimal("250.00")


def test_transfer_cross_currency_converts_amount(client, headers, db_session, household):
    src = _account(db_session, household, "USD Account", currency="USD")
    dst = _account(db_session, household, "SGD Account", currency="SGD")

    with patch("src.services.transaction_service.fetch_and_cache_exchange_rates") as mock_rates:
        # USD→SGD 1.35; conversions to home (USD) are 1.0 and 1/1.35
        def rate(db, base, target, d, **kw):
            if base == target:
                return 1.0
            if (base, target) == ("USD", "SGD"):
                return 1.35
            if (base, target) == ("SGD", "USD"):
                return 1 / 1.35
            return 1.0
        mock_rates.side_effect = rate

        response = client.post(
            "/cashflow/transfers",
            headers=headers,
            json={
                "from_account_id": str(src.id),
                "to_account_id": str(dst.id),
                "amount": "100.00",
                "date": "2024-01-05T12:00:00Z",
            },
        )

    assert response.status_code == 201
    withdrawal, deposit = response.json()
    assert withdrawal["currency"] == "USD"
    assert deposit["currency"] == "SGD"
    assert float(deposit["amount"]) == pytest.approx(135.0)


def test_transfer_rejects_cross_household(client, headers, db_session, household, owner):
    other_hh = models.Household(
        id=uuid.uuid7(), name="Second HH", base_currency="USD", country_code="US", owner_id=owner.id,
    )
    db_session.add(other_hh)
    db_session.flush()
    db_session.add(models.HouseholdMember(
        id=uuid.uuid7(), household_id=other_hh.id, user_id=owner.id, role=models.HouseholdRoleType.owner,
    ))
    db_session.commit()

    src = _account(db_session, household, "Here")
    dst = _account(db_session, other_hh, "There")

    response = client.post(
        "/cashflow/transfers",
        headers=headers,
        json={
            "from_account_id": str(src.id),
            "to_account_id": str(dst.id),
            "amount": "10.00",
            "date": "2024-01-05T12:00:00Z",
        },
    )
    assert response.status_code == 400


def test_transfer_missing_account_404(client, headers, db_session, household):
    src = _account(db_session, household, "Only Account")
    response = client.post(
        "/cashflow/transfers",
        headers=headers,
        json={
            "from_account_id": str(src.id),
            "to_account_id": str(uuid.uuid7()),
            "amount": "10.00",
            "date": "2024-01-05T12:00:00Z",
        },
    )
    assert response.status_code == 404


def test_transfer_requires_membership(client, db_session, household):
    outsider = models.User(
        id=uuid.uuid7(), email="outsider@example.com", name="Outsider",
        salted_hashed_password="x", salt="x",
    )
    db_session.add(outsider)
    db_session.commit()
    outsider_headers = {"Authorization": f"Bearer {create_access_token(data={'sub': str(outsider.id)})}"}

    src = _account(db_session, household, "A")
    dst = _account(db_session, household, "B")
    response = client.post(
        "/cashflow/transfers",
        headers=outsider_headers,
        json={
            "from_account_id": str(src.id),
            "to_account_id": str(dst.id),
            "amount": "10.00",
            "date": "2024-01-05T12:00:00Z",
        },
    )
    assert response.status_code == 403


# --- Cross-currency transfers: the rate you actually got (#271) ---------------
#
# Household base SGD. S$1,000 leaves; mid-market SGD->USD is 0.74, so the
# close says US$740 should arrive. The bank delivered US$731.


RATES = {("SGD", "USD"): 0.74, ("USD", "SGD"): 1 / 0.74}


def _rates(missing=()):
    """Patch the lookup with a fixed table; pairs in `missing` behave as strict misses."""
    from src.services.market_data import ExchangeRateUnavailable

    def rate(db, base, target, d, strict=False, **kw):
        if base == target:
            return 1.0
        if (base, target) in missing or (base, target) not in RATES:
            if strict:
                raise ExchangeRateUnavailable(base, target, d)
            return 1.0
        return RATES[(base, target)]

    return patch("src.services.transaction_service.fetch_and_cache_exchange_rates", side_effect=rate)


@pytest.fixture
def sgd_household(db_session, owner):
    hh = models.Household(
        id=uuid.uuid7(), name="SGD HH", base_currency="SGD", country_code="SG", owner_id=owner.id,
    )
    db_session.add(hh)
    db_session.flush()
    db_session.add(models.HouseholdMember(
        id=uuid.uuid7(), household_id=hh.id, user_id=owner.id, role=models.HouseholdRoleType.owner,
    ))
    db_session.commit()
    return hh


@pytest.fixture
def dbs(db_session, sgd_household):
    sgd = _account(db_session, sgd_household, "DBS SGD", currency="SGD")
    usd = _account(db_session, sgd_household, "DBS USD", currency="USD")
    _balance(db_session, sgd, "5000")
    _balance(db_session, usd, "0")
    return sgd, usd


def _transfer(client, headers, src, dst, missing=(), **body):
    payload = {
        "from_account_id": str(src.id),
        "to_account_id": str(dst.id),
        "amount": "1000.00",
        "date": "2024-01-05T12:00:00Z",
        **body,
    }
    with _rates(missing):
        return client.post("/cashflow/transfers", headers=headers, json=payload)


def _latest_balance(db_session, account):
    db_session.expire_all()
    row = (
        db_session.query(models.AccountBalance)
        .filter_by(account_id=account.id)
        .order_by(models.AccountBalance.date.desc())
        .first()
    )
    return Decimal(row.balance)


def _conversion_rows(db_session, household):
    db_session.expire_all()
    return (
        db_session.query(models.Transaction)
        .join(models.Category, models.Category.id == models.Transaction.category_id)
        .filter(
            models.Category.household_id == household.id,
            models.Category.name == models.SYSTEM_CATEGORY_FX_CONVERSION,
        )
        .all()
    )


def _adjustment_lines(db_session, household):
    return (
        db_session.query(models.JournalLine)
        .join(models.LedgerAccount, models.LedgerAccount.id == models.JournalLine.ledger_account_id)
        .filter(
            models.LedgerAccount.household_id == household.id,
            models.LedgerAccount.role == models.LedgerAccountRole.adjustment,
        )
        .all()
    )


def test_without_a_received_amount_the_legs_agree_and_nothing_is_plugged(
    client, headers, db_session, sgd_household, dbs
):
    """
    Both legs are valued through one lookup, so the transfer entry balances
    exactly. Two independent lookups used to leave a "conversion difference"
    in the adjustment account on a transfer that lost nobody anything.
    """
    sgd, usd = dbs
    res = _transfer(client, headers, sgd, usd)
    assert res.status_code == 201, res.text
    withdrawal, deposit = res.json()
    assert Decimal(withdrawal["amount"]) == Decimal("1000.00")
    assert Decimal(deposit["amount"]) == Decimal("740.00")
    assert Decimal(withdrawal["amount_home_currency"]) == Decimal(deposit["amount_home_currency"])
    assert _conversion_rows(db_session, sgd_household) == []
    assert _adjustment_lines(db_session, sgd_household) == []


def test_the_amount_received_splits_out_what_the_conversion_cost(
    client, headers, db_session, sgd_household, dbs
):
    sgd, usd = dbs
    res = _transfer(client, headers, sgd, usd, amount_received="731.00")
    assert res.status_code == 201, res.text
    withdrawal, deposit = res.json()

    # US$731 at 0.74 is S$987.84 of what left; the other S$12.16 is the cost.
    assert Decimal(deposit["amount"]) == Decimal("731.00")
    assert Decimal(withdrawal["amount"]) == Decimal("987.84")
    [conversion] = _conversion_rows(db_session, sgd_household)
    assert conversion.amount == Decimal("12.16")
    assert conversion.account_id == sgd.id
    assert conversion.transfer_id is None, "a transfer row would be dropped by every spending rollup"
    assert str(conversion.fee_for_transaction_id) == withdrawal["id"]

    # The account still lost exactly what the user said left it.
    assert _latest_balance(db_session, sgd) == Decimal("4000.00")
    assert _latest_balance(db_session, usd) == Decimal("731.00")
    assert _adjustment_lines(db_session, sgd_household) == [], "the cost is a category, not a plug"


def test_the_conversion_cost_counts_as_spending(client, headers, db_session, owner, sgd_household, dbs):
    from datetime import date
    from src.services import budget_service

    sgd, usd = dbs
    assert _transfer(client, headers, sgd, usd, amount_received="731.00").status_code == 201
    [conversion] = _conversion_rows(db_session, sgd_household)

    totals, _ = budget_service._spend_by_category(
        db_session, sgd_household.id, owner, date(2024, 1, 1), date(2024, 1, 31)
    )
    assert totals.get(conversion.category_id) == Decimal("12.16")
    transfer_category = db_session.query(models.Category).filter_by(
        household_id=sgd_household.id, name=models.SYSTEM_CATEGORY_TRANSFER
    ).one()
    assert transfer_category.id not in totals, "the transfer itself is still not spending"


def test_a_better_than_mid_rate_books_no_income(client, headers, db_session, sgd_household, dbs):
    sgd, usd = dbs
    res = _transfer(client, headers, sgd, usd, amount_received="745.00")
    assert res.status_code == 201, res.text
    withdrawal, deposit = res.json()
    assert Decimal(withdrawal["amount"]) == Decimal("1000.00")
    assert Decimal(deposit["amount"]) == Decimal("745.00")
    assert _conversion_rows(db_session, sgd_household) == []


def test_a_missing_rate_is_refused_not_guessed(client, headers, db_session, sgd_household, dbs):
    sgd, usd = dbs
    res = _transfer(client, headers, sgd, usd, missing={("SGD", "USD")})
    assert res.status_code == 422
    assert res.json()["exchange_rate_unavailable"]["target"] == "USD"
    assert _latest_balance(db_session, sgd) == Decimal("5000"), "nothing was written"


def test_a_received_amount_still_posts_when_no_mid_rate_exists(
    client, headers, db_session, sgd_household, dbs
):
    """The user told us what arrived; with nothing to measure a cost against, there is no cost row."""
    sgd, usd = dbs
    res = _transfer(client, headers, sgd, usd, amount_received="731.00", missing={("SGD", "USD")})
    assert res.status_code == 201, res.text
    withdrawal, deposit = res.json()
    assert Decimal(withdrawal["amount"]) == Decimal("1000.00")
    assert Decimal(deposit["amount"]) == Decimal("731.00")
    assert _conversion_rows(db_session, sgd_household) == []


def test_a_received_amount_on_a_same_currency_transfer_is_refused(client, headers, db_session, sgd_household):
    a = _account(db_session, sgd_household, "A", currency="SGD")
    b = _account(db_session, sgd_household, "B", currency="SGD")
    assert _transfer(client, headers, a, b, amount_received="990").status_code == 400


def test_a_currency_that_is_not_the_source_accounts_is_refused(client, headers, db_session, sgd_household, dbs):
    sgd, usd = dbs
    assert _transfer(client, headers, sgd, usd, currency="USD").status_code == 422
    assert _transfer(client, headers, sgd, usd, currency="SGD").status_code == 201


@pytest.mark.parametrize("which", ["withdrawal", "deposit", "conversion"])
def test_deleting_any_part_removes_the_whole_transfer(
    client, headers, db_session, sgd_household, dbs, which
):
    sgd, usd = dbs
    withdrawal, deposit = _transfer(client, headers, sgd, usd, amount_received="731.00").json()
    [conversion] = _conversion_rows(db_session, sgd_household)
    target = {"withdrawal": withdrawal["id"], "deposit": deposit["id"], "conversion": str(conversion.id)}[which]

    assert client.delete(f"/cashflow/transactions/{target}", headers=headers).status_code in (200, 204)

    db_session.expire_all()
    remaining = db_session.query(models.Transaction).filter(
        models.Transaction.account_id.in_([sgd.id, usd.id])
    ).count()
    assert remaining == 0
    assert _latest_balance(db_session, sgd) == Decimal("5000.00")
    assert _latest_balance(db_session, usd) == Decimal("0.00")
    assert db_session.query(models.JournalLine).join(models.LedgerAccount).filter(
        models.LedgerAccount.household_id == sgd_household.id
    ).count() == 0, "no journal entry outlives its rows"


@pytest.mark.parametrize("which", ["withdrawal", "deposit", "conversion"])
def test_editing_any_part_of_a_transfer_is_refused(client, headers, db_session, sgd_household, dbs, which):
    sgd, usd = dbs
    withdrawal, deposit = _transfer(client, headers, sgd, usd, amount_received="731.00").json()
    [conversion] = _conversion_rows(db_session, sgd_household)
    target = {"withdrawal": withdrawal["id"], "deposit": deposit["id"], "conversion": str(conversion.id)}[which]

    res = client.put(f"/cashflow/transactions/{target}", headers=headers, json={"description": "renamed"})
    assert res.status_code == 409
    assert "delete" in res.json()["detail"].lower()
