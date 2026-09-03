"""
The merchant category code catalogue (`GET /reference/mccs`) and the optional
`Transaction.mcc` column.

The column is deliberately inert: nothing derives a category, a budget or a limit
from it. These tests pin that it round-trips and that the catalogue is shaped for
a picker, not that anything computes from it — because nothing should.
"""

import uuid
from datetime import datetime, timezone
from decimal import Decimal

import pytest

from src import models


@pytest.fixture
def user(db_session):
    row = models.User(
        id=uuid.uuid7(),
        email="mcc@example.com",
        name="MCC User",
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
        name="MCC Household",
        base_currency="SGD",
        country_code="SG",
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
        name="Rewards Card",
        liquidity=models.LiquidityStatus.liquid,
        tax_status=models.TaxTreatment.taxable,
        kind=models.AccountKind.liability,
        currency="SGD",
    )
    db_session.add(row)
    db_session.commit()
    return row


@pytest.fixture
def category(db_session, household):
    row = models.Category(
        id=uuid.uuid7(), household_id=household.id, name="Dining", type="expense"
    )
    db_session.add(row)
    db_session.commit()
    return row


# ---------------------------------------------------------------------------
# The catalogue
# ---------------------------------------------------------------------------


def test_the_catalogue_is_served(client):
    response = client.get("/reference/mccs")
    assert response.status_code == 200
    rows = response.json()
    # ~700 named codes. A loose floor, so a package update that adds or drops a
    # handful doesn't fail the suite for no reason.
    assert len(rows) > 500


def test_every_row_can_be_rendered(client):
    """
    A picker row needs a code, a name and a group. Codes with no description from
    any source are dropped rather than shown as "(no description)".
    """
    rows = client.get("/reference/mccs").json()
    assert all(row["code"] and row["name"] and row["group"] for row in rows)
    assert all(len(row["code"]) == 4 and row["code"].isdigit() for row in rows)


def test_the_wording_prefers_the_readable_source(client):
    """
    ISO's own descriptions are terse and sometimes truncated mid-word; Stripe's
    are written to be shown to a person. 5411 is the clearest example.
    """
    rows = {row["code"]: row["name"] for row in client.get("/reference/mccs").json()}
    assert rows["5411"] == "Grocery Stores, Supermarkets"
    assert rows["5814"] == "Fast Food Restaurants"


def test_brand_codes_are_labelled_as_what_they_are(client):
    """
    ISO calls 3000-3999 "reserved for private use"; acquirers fill it with airline
    and hotel brands. The picker says the useful thing.
    """
    rows = {row["code"]: row for row in client.get("/reference/mccs").json()}
    assert rows["3000"]["name"] == "UNITED AIRLINES"
    assert rows["3000"]["group"] == "Airline, hotel and car rental brands"
    assert rows["3000"]["is_brand"] is True


def test_general_codes_are_separable_from_brands(client):
    """
    A client shows the ~300 general codes and leaves the ~400 brand entries to
    search. The flag is what makes that possible without hardcoding 3000-3999.
    """
    rows = client.get("/reference/mccs").json()
    general = [r for r in rows if not r["is_brand"]]
    brands = [r for r in rows if r["is_brand"]]
    assert 200 < len(general) < 400
    assert len(brands) > 300
    assert {r["group"] for r in general} != {"Airline, hotel and car rental brands"}


def test_the_flag_is_a_boolean(client):
    """
    Not the string "true". It was one once, and three clients each had to parse
    it back out — where any value other than that exact literal silently read as
    "general".
    """
    rows = client.get("/reference/mccs").json()
    assert all(isinstance(row["is_brand"], bool) for row in rows)


def test_brands_come_last_and_each_block_is_ordered_by_code(client):
    """
    The order is the contract, not a client's job. Every client wants general
    codes first — the brand block is rarely wanted and reads as noise between
    Groceries and Restaurants — so sorting it here means no client sorts at all.
    """
    rows = client.get("/reference/mccs").json()

    flags = [row["is_brand"] for row in rows]
    # Every general row precedes every brand row: no True appears before a False.
    assert flags == sorted(flags), "brand codes are not all at the end"

    general = [r["code"] for r in rows if not r["is_brand"]]
    brands = [r["code"] for r in rows if r["is_brand"]]
    assert general == sorted(general)
    assert brands == sorted(brands)
    # The boundary lands where ISO's private-use band starts.
    assert brands[0] == "3000"


def test_codes_the_package_leaves_blank_are_still_served(client):
    """
    iso18245's Stripe/USDA/ISO sources predate some codes the networks have
    since put into real use, so those codes carry no name from any of them.
    5262 (Marketplaces) is the one that sent a user looking for it and finding
    it silently missing from the picker; a handful of card-network-specific
    codes (MoneySend, quasi-cash) share the gap. `_DESCRIPTION_OVERRIDES`
    fills only codes confirmed live in Visa's or Mastercard's own current MCC
    manuals — everything else the package leaves blank is genuinely
    unassigned and stays dropped.
    """
    rows = {row["code"]: row for row in client.get("/reference/mccs").json()}
    assert rows["5262"]["name"] == "Marketplaces"
    for code in (
        "4813",
        "5552",
        "6050",
        "6532",
        "6533",
        "6536",
        "6537",
        "6538",
        "7800",
        "7801",
        "7802",
        "9406",
    ):
        assert rows[code]["name"], code
        assert rows[code]["group"], code


def test_the_catalogue_needs_no_login(client):
    """Reference data, like currencies and timezones beside it."""
    assert client.get("/reference/mccs").status_code == 200


# ---------------------------------------------------------------------------
# The column
# ---------------------------------------------------------------------------


def _post(client, headers, account, category, **extra):
    body = {
        "account_id": str(account.id),
        "category_id": str(category.id),
        "date": datetime(2026, 8, 20, 12, tzinfo=timezone.utc).isoformat(),
        "amount": "18.40",
        "description": "Baker & Cook",
    }
    body.update(extra)
    return client.post("/cashflow/transactions", json=body, headers=headers)


def test_a_code_round_trips(client, headers, account, category):
    response = _post(client, headers, account, category, mcc="5814")
    assert response.status_code == 201, response.text
    assert response.json()["mcc"] == "5814"


def test_the_code_is_optional(client, headers, account, category):
    """Every transaction logged before this column existed has none, and so does
    anyone who never turns the field on."""
    response = _post(client, headers, account, category)
    assert response.status_code == 201, response.text
    assert response.json()["mcc"] is None


@pytest.mark.parametrize(
    "blank,label",
    [(None, "explicit null"), ("", "empty string"), ("   ", "whitespace")],
)
def test_blank_means_unknown_not_invalid(client, headers, account, category, blank, label):
    """
    The code is optional even with the field switched on — most people do not know
    the MCC for most purchases. A cleared text field sends "" rather than null from
    all three clients, so blank has to mean "I don't know", never a 422.
    """
    response = _post(client, headers, account, category, mcc=blank)
    assert response.status_code == 201, f"{label}: {response.text}"
    assert response.json()["mcc"] is None


def test_a_recorded_code_can_be_blanked_out_again(client, headers, account, category):
    """Recording one by mistake must be as undoable as leaving it out."""
    created = _post(client, headers, account, category, mcc="5814").json()
    assert created["mcc"] == "5814"

    response = client.put(
        f"/cashflow/transactions/{created['id']}", json={"mcc": ""}, headers=headers
    )
    assert response.status_code == 200, response.text
    assert response.json()["mcc"] is None


def test_leaving_mcc_out_of_an_edit_does_not_clear_it(client, headers, account, category):
    """
    Omitted and blank are different requests. Editing a description must not
    silently discard a code the user took the trouble to look up.
    """
    created = _post(client, headers, account, category, mcc="5814").json()
    response = client.put(
        f"/cashflow/transactions/{created['id']}",
        json={"description": "Coffee, corrected"},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    assert response.json()["mcc"] == "5814"


def test_a_malformed_code_is_refused(client, headers, account, category):
    """Four digits or nothing — a free-text field here would be worthless later."""
    for bad in ("58", "58140", "dining", "58 1", "５８１４"):
        assert _post(client, headers, account, category, mcc=bad).status_code == 422, bad


def test_a_code_can_be_added_or_corrected_afterwards(client, headers, account, category):
    """
    The code is usually learnt after the fact — from a statement, or from looking
    it up later — so it has to be editable, not entry-only.
    """
    created = _post(client, headers, account, category).json()
    response = client.put(
        f"/cashflow/transactions/{created['id']}", json={"mcc": "5812"}, headers=headers
    )
    assert response.status_code == 200, response.text
    assert response.json()["mcc"] == "5812"


def test_the_code_changes_nothing_else(client, db_session, headers, account, category):
    """
    The whole safety property. Two identical transactions, one carrying a code:
    same amount, same category, same effect on the balance chain.
    """
    plain = _post(client, headers, account, category).json()
    coded = _post(client, headers, account, category, mcc="5814").json()

    assert plain["category_id"] == coded["category_id"]
    assert plain["transaction_type"] == coded["transaction_type"]
    assert Decimal(plain["amount"]) == Decimal(coded["amount"])

    db_session.expire_all()
    latest = (
        db_session.query(models.AccountBalance)
        .filter(models.AccountBalance.account_id == account.id)
        .order_by(models.AccountBalance.date.desc())
        .first()
    )
    # Both were charged; neither was treated specially because of a code. This
    # is a card, so the charges add to what is owed rather than subtracting from
    # a pile of cash.
    assert Decimal(str(latest.balance)) == Decimal("36.80")


# ---------------------------------------------------------------------------
# The per-user setting that reveals the field
# ---------------------------------------------------------------------------


def test_the_field_is_hidden_until_asked_for(client, headers, user):
    """
    Off by default. A four-digit code box on every transaction form would tax
    everyone for a feature only a few people can actually fill in.
    """
    assert client.get("/users", headers=headers).json()["record_merchant_codes"] is False


def test_the_setting_round_trips(client, headers, user):
    """
    `update_user` assigns each field explicitly, so a new column is silently
    dropped unless it is wired in there too — this is what catches that.
    """
    updated = client.put(
        "/users", json={"record_merchant_codes": True}, headers=headers
    )
    assert updated.status_code == 200
    assert updated.json()["record_merchant_codes"] is True
    assert client.get("/users", headers=headers).json()["record_merchant_codes"] is True


def test_the_setting_can_be_turned_back_off(client, headers, user):
    client.put("/users", json={"record_merchant_codes": True}, headers=headers)
    client.put("/users", json={"record_merchant_codes": False}, headers=headers)
    assert client.get("/users", headers=headers).json()["record_merchant_codes"] is False


def test_an_unrelated_edit_leaves_the_setting_alone(client, headers, user):
    """Omitted means unchanged — the same three-state rule `mcc` itself follows."""
    client.put("/users", json={"record_merchant_codes": True}, headers=headers)
    client.put("/users", json={"name": "Renamed"}, headers=headers)
    assert client.get("/users", headers=headers).json()["record_merchant_codes"] is True


def test_the_setting_does_not_gate_the_column(client, headers, account, category):
    """
    The setting is a client-side affordance, not an authorization rule. The API
    accepts a code regardless — otherwise turning the toggle off would start
    rejecting edits to transactions that already carry one.
    """
    assert _post(client, headers, account, category, mcc="5814").json()["mcc"] == "5814"
