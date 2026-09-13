"""
A card's surcharge on one purchase (`Transaction.fee_percent`).

The design this pins: the fee is a **separate transaction**, not a column
folded into the purchase. `amount * exchange_rate` means "what left the
account" to the balance chain, to `card_service`, and to the figure every
client prints beside a row — a fee hidden inside either factor would redefine
all of them at once, and a fee left outside them would make the balance wrong.
A row of its own keeps every reader correct with none of them changed.
"""

import uuid
from decimal import Decimal
from unittest.mock import patch

import pytest

from src import models


@pytest.fixture
def user(db_session):
    u = models.User(
        id=uuid.uuid7(), email="fees@example.com", name="Fee User",
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
    h = models.Household(
        id=uuid.uuid7(), name="Fee Household", base_currency="SGD",
        country_code="SG", owner_id=user.id,
    )
    db_session.add(h)
    db_session.commit()
    return h


@pytest.fixture
def account(db_session, household):
    a = models.FinancialAccount(
        id=uuid.uuid7(), household_id=household.id, name="Travel Card",
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


def _no_network():
    """Every currency here is the account's own, but pin it so nothing reaches out."""
    return patch(
        "src.services.transaction_service.fetch_and_cache_exchange_rates",
        side_effect=lambda db, base, target, on_date, **kw: 1.0,
    )


def _post(client, headers, account, category, **body):
    payload = {
        "account_id": str(account.id),
        "category_id": str(category.id),
        "date": "2026-03-04T12:00:00Z",
        "amount": 100,
        **body,
    }
    with _no_network():
        return client.post("/cashflow/transactions", json=payload, headers=headers)


def _fee_row(db_session, purchase_id):
    return (
        db_session.query(models.Transaction)
        .filter(models.Transaction.fee_for_transaction_id == uuid.UUID(str(purchase_id)))
        .one_or_none()
    )


def _balance(db_session, account):
    row = (
        db_session.query(models.AccountBalance)
        .filter(models.AccountBalance.account_id == account.id)
        .order_by(models.AccountBalance.date.desc())
        .first()
    )
    return Decimal(str(row.balance)) if row else None


def test_a_surcharge_posts_its_own_row_and_leaves_the_purchase_alone(
    client, db_session, headers, account, dining
):
    response = _post(client, headers, account, dining, fee_percent=3)
    assert response.status_code == 201, response.text
    body = response.json()

    # The purchase still says what the merchant billed. Inflating it to 103
    # would put the card's fee in the Dining budget and contradict the receipt.
    assert Decimal(body["amount"]) == Decimal("100")
    assert Decimal(body["fee_percent"]) == Decimal("3")

    fee = _fee_row(db_session, body["id"])
    assert fee is not None
    assert Decimal(str(fee.amount)) == Decimal("3.00")
    assert fee.category.name == models.SYSTEM_CATEGORY_FEE
    # Both rows really left the account.
    assert _balance(db_session, account) == Decimal("-103.00")


def test_a_fee_is_spending_rather_than_bookkeeping(client, headers, account, dining):
    """
    Unlike a transfer or a settlement, a surcharge is money genuinely gone, so
    the burn rate has to count it — which means its category must stay out of
    SYSTEM_CATEGORY_NAMES.
    """
    assert models.SYSTEM_CATEGORY_FEE not in models.SYSTEM_CATEGORY_NAMES


def test_no_fee_percentage_posts_no_second_row(client, db_session, headers, account, dining):
    response = _post(client, headers, account, dining)
    assert response.status_code == 201, response.text
    assert _fee_row(db_session, response.json()["id"]) is None
    assert db_session.query(models.Transaction).count() == 1
    assert _balance(db_session, account) == Decimal("-100.00")


def test_a_zero_percent_fee_is_no_fee_rather_than_an_error(
    client, db_session, headers, account, dining
):
    # "I set it back to zero" must not be a 422, and must not leave a row worth
    # nothing sitting in the activity list.
    response = _post(client, headers, account, dining, fee_percent=0)
    assert response.status_code == 201, response.text
    assert _fee_row(db_session, response.json()["id"]) is None


def test_an_absurd_percentage_is_refused_as_the_typo_it_is(client, headers, account, dining):
    assert _post(client, headers, account, dining, fee_percent=300).status_code == 422


def test_the_fee_is_charged_on_the_converted_amount_not_the_foreign_one(
    client, db_session, headers, account, dining
):
    """
    The card's fee is a percentage of what *it* billed, so it follows the
    account-currency figure — ¥12,000 settled at S$124.80 carries a S$3.74 fee,
    not ¥360 worth of one.
    """
    response = _post(
        client, headers, account, dining,
        amount=12000, currency="JPY", amount_charged=124.80, fee_percent=3,
    )
    assert response.status_code == 201, response.text
    fee = _fee_row(db_session, response.json()["id"])
    assert Decimal(str(fee.amount)) == Decimal("3.74")  # 124.80 * 3%
    assert fee.currency == "SGD"  # the card settles its fee in its own currency
    assert _balance(db_session, account) == Decimal("-128.54")


def test_repricing_a_purchase_reprices_its_fee(client, db_session, headers, account, dining):
    created = _post(client, headers, account, dining, fee_percent=3)
    purchase_id = created.json()["id"]

    with _no_network():
        edited = client.put(
            f"/cashflow/transactions/{purchase_id}", json={"amount": 200}, headers=headers
        )
    assert edited.status_code == 200, edited.text

    fee = _fee_row(db_session, purchase_id)
    assert Decimal(str(fee.amount)) == Decimal("6.00")
    # Exactly one fee row, not a second one stacked on the first.
    assert db_session.query(models.Transaction).count() == 2
    assert _balance(db_session, account) == Decimal("-206.00")


def test_clearing_the_percentage_removes_the_fee_row_and_its_impact(
    client, db_session, headers, account, dining
):
    created = _post(client, headers, account, dining, fee_percent=3)
    purchase_id = created.json()["id"]

    with _no_network():
        edited = client.put(
            f"/cashflow/transactions/{purchase_id}", json={"fee_percent": 0}, headers=headers
        )
    assert edited.status_code == 200, edited.text
    assert _fee_row(db_session, purchase_id) is None
    assert _balance(db_session, account) == Decimal("-100.00")


def test_editing_something_else_leaves_the_fee_alone(
    client, db_session, headers, account, dining
):
    """`fee_percent` is three-state like `mcc`: omitted means preserve."""
    created = _post(client, headers, account, dining, fee_percent=3)
    purchase_id = created.json()["id"]

    with _no_network():
        edited = client.put(
            f"/cashflow/transactions/{purchase_id}",
            json={"description": "Dinner, not lunch"},
            headers=headers,
        )
    assert edited.status_code == 200, edited.text
    assert Decimal(edited.json()["fee_percent"]) == Decimal("3")
    assert Decimal(str(_fee_row(db_session, purchase_id).amount)) == Decimal("3.00")
    assert _balance(db_session, account) == Decimal("-103.00")


def test_deleting_the_purchase_takes_its_fee_with_it(
    client, db_session, headers, account, dining
):
    created = _post(client, headers, account, dining, fee_percent=3)
    purchase_id = created.json()["id"]

    assert client.delete(f"/cashflow/transactions/{purchase_id}", headers=headers).status_code == 204

    assert db_session.query(models.Transaction).count() == 0
    # Both impacts reversed, not just the purchase's — the bug a DB cascade
    # would have left behind.
    assert _balance(db_session, account) == Decimal("0.00")


def test_the_fee_is_a_balanced_entry_of_its_own(client, db_session, headers, account, dining):
    created = _post(client, headers, account, dining, fee_percent=3)
    fee = _fee_row(db_session, created.json()["id"])

    entry = (
        db_session.query(models.JournalEntry)
        .filter(models.JournalEntry.source_id == fee.id)
        .one()
    )
    debits = sum(Decimal(str(line.debit)) for line in entry.lines)
    credits = sum(Decimal(str(line.credit)) for line in entry.lines)
    assert debits == credits == Decimal("3.00")


def test_a_recurring_rule_carries_its_surcharge_onto_every_posting(
    db_session, household, account, dining
):
    """
    A card that adds 3% to a foreign subscription adds it every month. The rule
    records it once, for the same reason it records `mcc` and
    `card_category_id` — opening each posted row to add it by hand is the work
    a rule exists to avoid.
    """
    from datetime import date

    from src.services.recurring_service import materialize_due

    due = date(2026, 3, 4)
    rule = models.RecurringTransaction(
        id=uuid.uuid7(),
        household_id=household.id,
        account_id=account.id,
        category_id=dining.id,
        amount=Decimal("100"),
        frequency="monthly",
        start_date=due,
        next_due_date=due,
        is_active=True,
        fee_percent=Decimal("3"),
    )
    db_session.add(rule)
    db_session.commit()

    with _no_network():
        assert materialize_due(db_session, household.id, as_of=due) == 1

    purchase = (
        db_session.query(models.Transaction)
        .filter(models.Transaction.recurring_transaction_id == rule.id)
        .one()
    )
    assert Decimal(str(purchase.fee_percent)) == Decimal("3")
    fee = _fee_row(db_session, purchase.id)
    assert Decimal(str(fee.amount)) == Decimal("3.00")
    assert _balance(db_session, account) == Decimal("-103.00")


# --- A card's default foreign-transaction fee ---------------------------------
#
# `Card.foreign_fee_percent` is the percentage a card adds to every foreign
# charge. Left out of a create, `fee_percent` takes it for a foreign charge;
# an explicit value — 0 included — always wins, and an update never applies it.


def _card(db_session, account, foreign_fee_percent="3"):
    card = models.Card(
        id=uuid.uuid7(),
        financial_account_id=account.id,
        statement_day=1,
        foreign_fee_percent=None if foreign_fee_percent is None else Decimal(foreign_fee_percent),
    )
    db_session.add(card)
    db_session.commit()
    return card


def test_a_foreign_charge_takes_the_cards_default_fee(client, db_session, headers, account, dining):
    _card(db_session, account)
    response = _post(client, headers, account, dining, amount=12000, currency="JPY", amount_charged=124.80)
    assert response.status_code == 201, response.text
    assert Decimal(response.json()["fee_percent"]) == Decimal("3"), "the row records the fee it was charged"
    fee = _fee_row(db_session, response.json()["id"])
    assert Decimal(str(fee.amount)) == Decimal("3.74")


def test_a_domestic_charge_on_the_same_card_takes_no_default(client, db_session, headers, account, dining):
    _card(db_session, account)
    response = _post(client, headers, account, dining)
    assert response.status_code == 201, response.text
    assert response.json()["fee_percent"] in (None, "0")
    assert _fee_row(db_session, response.json()["id"]) is None


@pytest.mark.parametrize("explicit", [0, None])
def test_an_explicit_zero_or_null_skips_the_default(client, db_session, headers, account, dining, explicit):
    _card(db_session, account)
    response = _post(client, headers, account, dining, currency="JPY", fee_percent=explicit)
    assert response.status_code == 201, response.text
    assert _fee_row(db_session, response.json()["id"]) is None


def test_an_explicit_percentage_beats_the_default(client, db_session, headers, account, dining):
    _card(db_session, account)
    response = _post(client, headers, account, dining, currency="JPY", fee_percent=1.5)
    assert Decimal(str(_fee_row(db_session, response.json()["id"]).amount)) == Decimal("1.50")


def test_an_account_with_no_card_has_no_default(client, db_session, headers, account, dining):
    response = _post(client, headers, account, dining, currency="JPY")
    assert _fee_row(db_session, response.json()["id"]) is None


def test_editing_a_charge_never_applies_the_default(client, db_session, headers, account, dining):
    """A default set afterwards must not appear on rows that already exist."""
    created = _post(client, headers, account, dining, currency="JPY")
    _card(db_session, account)
    with _no_network():
        edited = client.put(
            f"/cashflow/transactions/{created.json()['id']}", json={"amount": 200}, headers=headers
        )
    assert edited.status_code == 200, edited.text
    assert _fee_row(db_session, created.json()["id"]) is None


def test_a_foreign_recurring_rule_with_no_fee_of_its_own_takes_the_default(
    db_session, household, account, dining
):
    from datetime import date

    from src.services.recurring_service import materialize_due

    _card(db_session, account)
    due = date(2026, 3, 4)
    rule = models.RecurringTransaction(
        id=uuid.uuid7(), household_id=household.id, account_id=account.id, category_id=dining.id,
        amount=Decimal("100"), currency="USD", frequency="monthly",
        start_date=due, next_due_date=due, is_active=True,
    )
    db_session.add(rule)
    db_session.commit()

    with _no_network():
        assert materialize_due(db_session, household.id, as_of=due) == 1
    purchase = db_session.query(models.Transaction).filter(
        models.Transaction.recurring_transaction_id == rule.id
    ).one()
    assert Decimal(str(_fee_row(db_session, purchase.id).amount)) == Decimal("3.00")


def test_the_card_endpoints_set_and_clear_the_default(client, db_session, headers, account):
    account.kind = models.AccountKind.liability  # a card is set up on money owed
    db_session.commit()
    created = client.post(
        "/cards",
        json={"financial_account_id": str(account.id), "statement_day": 18, "foreign_fee_percent": 3.25},
        headers=headers,
    )
    assert created.status_code == 201, created.text
    card_id = created.json()["id"]
    assert Decimal(str(created.json()["foreign_fee_percent"])) == Decimal("3.25")

    kept = client.put(f"/cards/{card_id}", json={"statement_day": 20}, headers=headers)
    assert Decimal(str(kept.json()["foreign_fee_percent"])) == Decimal("3.25"), "omitted preserves"

    cleared = client.put(f"/cards/{card_id}", json={"foreign_fee_percent": None}, headers=headers)
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["foreign_fee_percent"] is None

    assert client.put(f"/cards/{card_id}", json={"foreign_fee_percent": 101}, headers=headers).status_code == 422
