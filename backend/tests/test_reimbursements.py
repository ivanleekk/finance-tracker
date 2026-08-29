"""
Paying for other people, and being paid for.

This is what the ledger was introduced for. Single entry could record that money
left an account and that a category was charged, but it had no way to say those
two facts were about different amounts — so fronting a group dinner blew the
payer's budget, and being treated left no trace at all.

The suite is organised around the four things that must hold: your budget sees
your share, a debt is created and readable, settling it clears the debt without
charging anything a second time, and none of it can knock the books out of
balance. Splits are now a list of counterparties rather than a single one, so a
handful of tests also cover the N-way case directly.
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest

from src import models
from src.services import budget_service, ledger_service


def _at(day: int, hour: int = 12) -> datetime:
    return datetime(2026, 8, day, hour, tzinfo=timezone.utc)


@pytest.fixture
def owner(db_session):
    user = models.User(
        id=uuid.uuid7(),
        email="reimb_owner@example.com",
        name="Reimb Owner",
        salted_hashed_password="fakehash",
        salt="fakesalt",
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def headers(client, owner):
    from src.auth import create_access_token

    return {"Authorization": f"Bearer {create_access_token(data={'sub': str(owner.id)})}"}


@pytest.fixture
def household(db_session, owner):
    hh = models.Household(
        id=uuid.uuid7(),
        name="Reimb Household",
        base_currency="USD",
        country_code="US",
        owner_id=owner.id,
        emergency_fund_target_months=Decimal("6"),
    )
    db_session.add(hh)
    db_session.commit()
    db_session.refresh(hh)
    return hh


@pytest.fixture
def account(db_session, household):
    acc = models.FinancialAccount(
        id=uuid.uuid7(),
        household_id=household.id,
        name="Checking",
        liquidity=models.LiquidityStatus.liquid,
        tax_status=models.TaxTreatment.taxable,
        kind=models.AccountKind.asset,
        currency="USD",
    )
    db_session.add(acc)
    db_session.commit()
    db_session.refresh(acc)
    return acc


@pytest.fixture
def dining(db_session, household):
    cat = models.Category(
        id=uuid.uuid7(), household_id=household.id, name="Dining", type="expense"
    )
    db_session.add(cat)
    db_session.commit()
    db_session.refresh(cat)
    return cat


def _counterparty(db_session, household, name):
    row = models.Counterparty(id=uuid.uuid7(), household_id=household.id, name=name)
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


@pytest.fixture
def alice(db_session, household):
    return _counterparty(db_session, household, "Alice")


@pytest.fixture
def bob(db_session, household):
    return _counterparty(db_session, household, "Bob")


def _budget(db_session, household, category, amount):
    budget = models.Budget(
        id=uuid.uuid7(),
        household_id=household.id,
        amount=Decimal(str(amount)),
        period=models.BudgetPeriod.monthly,
    )
    db_session.add(budget)
    db_session.flush()
    db_session.add(
        models.BudgetCategory(
            id=uuid.uuid7(),
            budget_id=budget.id,
            category_id=category.id,
            household_id=household.id,
        )
    )
    db_session.commit()
    return budget


def _spent(db_session, household, owner) -> Decimal:
    statuses = budget_service.budget_statuses(
        db_session, household.id, owner, on=date(2026, 8, 20)
    )
    assert len(statuses) == 1
    return statuses[0].spent


def _post_split(client, headers, account, category, *, amount, splits, day=10):
    """`splits` is a list of `(counterparty, amount)` pairs."""
    response = client.post(
        "/cashflow/transactions",
        json={
            "account_id": str(account.id),
            "category_id": str(category.id),
            "date": _at(day).isoformat(),
            "amount": str(amount),
            "splits": [
                {"counterparty_id": str(counterparty.id), "amount": str(owed)}
                for counterparty, owed in splits
            ],
            "description": "Group dinner",
        },
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


# ---------------------------------------------------------------------------
# Your budget sees your share
# ---------------------------------------------------------------------------


def test_fronting_a_bill_only_budgets_your_share(
    client, db_session, headers, household, account, dining, owner, alice
):
    _budget(db_session, household, dining, 200)
    _post_split(client, headers, account, dining, amount=120, splits=[(alice, 80)])

    db_session.expire_all()
    assert _spent(db_session, household, owner) == Decimal("40.00")


def test_a_three_way_split_budgets_only_your_own_third(
    client, db_session, headers, household, account, dining, owner, alice, bob
):
    """The motivating case: a $300 dinner split three ways is $100 of spending."""
    _budget(db_session, household, dining, 500)
    _post_split(
        client, headers, account, dining, amount=300, splits=[(alice, 100), (bob, 100)]
    )

    db_session.expire_all()
    assert _spent(db_session, household, owner) == Decimal("100.00")


def test_the_whole_bill_still_leaves_the_account(
    client, db_session, headers, household, account, dining, alice
):
    """
    The split changes whose spending it was, not what happened to the money.
    Recording 40 instead of 120 would balance the budget by lying about the bank.
    """
    _post_split(client, headers, account, dining, amount=120, splits=[(alice, 80)])

    db_session.expire_all()
    balance = (
        db_session.query(models.AccountBalance)
        .filter(models.AccountBalance.account_id == account.id)
        .order_by(models.AccountBalance.date.desc())
        .first()
    )
    assert balance is not None
    assert Decimal(str(balance.balance)) == Decimal("-120")


def test_an_unsplit_expense_is_entirely_yours(
    client, db_session, headers, household, account, dining, owner
):
    """The correction must not leak into ordinary spending."""
    _budget(db_session, household, dining, 200)
    response = client.post(
        "/cashflow/transactions",
        json={
            "account_id": str(account.id),
            "category_id": str(dining.id),
            "date": _at(10).isoformat(),
            "amount": "55",
        },
        headers=headers,
    )
    assert response.status_code == 201, response.text

    db_session.expire_all()
    assert _spent(db_session, household, owner) == Decimal("55.00")


def test_fronting_the_whole_bill_budgets_nothing(
    client, db_session, headers, household, account, dining, owner, alice
):
    _budget(db_session, household, dining, 200)
    _post_split(client, headers, account, dining, amount=90, splits=[(alice, 90)])

    db_session.expire_all()
    assert _spent(db_session, household, owner) == Decimal("0.00")


# ---------------------------------------------------------------------------
# The debt is created, and readable
# ---------------------------------------------------------------------------


def test_the_counterparty_owes_you_what_you_fronted(
    client, db_session, headers, household, account, dining, alice
):
    _post_split(client, headers, account, dining, amount=120, splits=[(alice, 80)])

    response = client.get(f"/cashflow/reimbursements/household/{household.id}", headers=headers)
    assert response.status_code == 200, response.text
    assert response.json() == [
        {
            "counterparty_id": str(alice.id),
            "counterparty_name": "Alice",
            "direction": "owed_to_you",
            "amount": "80.00",
        }
    ]


def test_the_transaction_reports_its_own_split(
    client, db_session, headers, household, account, dining, alice
):
    created = _post_split(client, headers, account, dining, amount=120, splits=[(alice, 80)])
    assert created["splits"] == [
        {"counterparty_id": str(alice.id), "counterparty_name": "Alice", "amount": "80"}
    ]

    listed = client.get(
        f"/cashflow/transactions/household/{household.id}", headers=headers
    ).json()
    row = next(r for r in listed if r["id"] == created["id"])
    assert row["splits"][0]["counterparty_name"] == "Alice"


def test_a_split_reports_every_counterparty(
    client, db_session, headers, household, account, dining, alice, bob
):
    created = _post_split(
        client, headers, account, dining, amount=300, splits=[(alice, 100), (bob, 100)]
    )
    by_name = {s["counterparty_name"]: Decimal(s["amount"]) for s in created["splits"]}
    assert by_name == {"Alice": Decimal("100"), "Bob": Decimal("100")}


def test_two_dinners_with_the_same_person_accumulate(
    client, db_session, headers, household, account, dining, alice
):
    _post_split(client, headers, account, dining, amount=120, splits=[(alice, 80)], day=10)
    _post_split(client, headers, account, dining, amount=60, splits=[(alice, 30)], day=12)

    balances = client.get(
        f"/cashflow/reimbursements/household/{household.id}", headers=headers
    ).json()
    assert len(balances) == 1
    assert Decimal(balances[0]["amount"]) == Decimal("110")


def test_a_split_entry_requires_both_fields(client, headers, account, dining, alice):
    response = client.post(
        "/cashflow/transactions",
        json={
            "account_id": str(account.id),
            "category_id": str(dining.id),
            "date": _at(10).isoformat(),
            "amount": "120",
            "splits": [{"counterparty_id": str(alice.id)}],
        },
        headers=headers,
    )
    assert response.status_code == 422


def test_a_split_cannot_exceed_the_bill(client, headers, account, dining, alice):
    """Owing more than was paid is not a split; it is a typo."""
    response = client.post(
        "/cashflow/transactions",
        json={
            "account_id": str(account.id),
            "category_id": str(dining.id),
            "date": _at(10).isoformat(),
            "amount": "120",
            "splits": [{"counterparty_id": str(alice.id), "amount": "200"}],
        },
        headers=headers,
    )
    assert response.status_code == 422


def test_a_multi_way_split_cannot_exceed_the_bill_combined(
    client, headers, account, dining, alice, bob
):
    response = client.post(
        "/cashflow/transactions",
        json={
            "account_id": str(account.id),
            "category_id": str(dining.id),
            "date": _at(10).isoformat(),
            "amount": "120",
            "splits": [
                {"counterparty_id": str(alice.id), "amount": "80"},
                {"counterparty_id": str(bob.id), "amount": "80"},
            ],
        },
        headers=headers,
    )
    assert response.status_code == 422


def test_the_same_counterparty_cannot_appear_twice_in_one_split(
    client, headers, account, dining, alice
):
    response = client.post(
        "/cashflow/transactions",
        json={
            "account_id": str(account.id),
            "category_id": str(dining.id),
            "date": _at(10).isoformat(),
            "amount": "120",
            "splits": [
                {"counterparty_id": str(alice.id), "amount": "40"},
                {"counterparty_id": str(alice.id), "amount": "40"},
            ],
        },
        headers=headers,
    )
    assert response.status_code == 422


# ---------------------------------------------------------------------------
# Someone paid for you: the case with no transaction at all
# ---------------------------------------------------------------------------


def test_spending_someone_else_paid_for_still_counts_against_your_budget(
    client, db_session, headers, household, account, dining, owner, bob
):
    _budget(db_session, household, dining, 200)
    response = client.post(
        "/cashflow/reimbursements/on-behalf",
        json={
            "household_id": str(household.id),
            "category_id": str(dining.id),
            "counterparty_id": str(bob.id),
            "amount": "45",
            "date": _at(10).isoformat(),
        },
        headers=headers,
    )
    assert response.status_code == 201, response.text
    assert response.json()["direction"] == "you_owe"

    db_session.expire_all()
    assert _spent(db_session, household, owner) == Decimal("45.00")


def test_being_paid_for_moves_no_account(
    client, db_session, headers, household, account, dining, bob
):
    """No account moved, so none may be touched — that is why it has no transaction."""
    client.post(
        "/cashflow/reimbursements/on-behalf",
        json={
            "household_id": str(household.id),
            "category_id": str(dining.id),
            "counterparty_id": str(bob.id),
            "amount": "45",
            "date": _at(10).isoformat(),
        },
        headers=headers,
    )
    db_session.expire_all()
    assert db_session.query(models.AccountBalance).count() == 0
    assert db_session.query(models.Transaction).count() == 0


# ---------------------------------------------------------------------------
# Settling up
# ---------------------------------------------------------------------------


def _settle(client, headers, account, counterparty, direction, amount, day=20, owner_user_id=None):
    return client.post(
        "/cashflow/reimbursements/settle",
        json={
            "account_id": str(account.id),
            "counterparty_id": str(counterparty.id),
            "direction": direction,
            "amount": str(amount),
            "date": _at(day).isoformat(),
            "owner_user_id": str(owner_user_id) if owner_user_id else None,
        },
        headers=headers,
    )


def test_settling_clears_the_debt(
    client, db_session, headers, household, account, dining, alice
):
    _post_split(client, headers, account, dining, amount=120, splits=[(alice, 80)])
    assert _settle(client, headers, account, alice, "owed_to_you", 80).status_code == 201

    balances = client.get(
        f"/cashflow/reimbursements/household/{household.id}", headers=headers
    ).json()
    assert balances == []


def test_a_partial_repayment_leaves_the_rest_outstanding(
    client, db_session, headers, household, account, dining, alice
):
    _post_split(client, headers, account, dining, amount=120, splits=[(alice, 80)])
    assert _settle(client, headers, account, alice, "owed_to_you", 30).status_code == 201

    balances = client.get(
        f"/cashflow/reimbursements/household/{household.id}", headers=headers
    ).json()
    assert Decimal(balances[0]["amount"]) == Decimal("50")


def test_settling_does_not_charge_a_budget_again(
    client, db_session, headers, household, account, dining, owner, alice
):
    """
    The dinner was charged when it was paid for. A repayment is cash moving, not
    a second dinner — counting it would mean fronting money made your budget
    worse whichever way the money went.
    """
    _budget(db_session, household, dining, 200)
    _post_split(client, headers, account, dining, amount=120, splits=[(alice, 80)])
    _settle(client, headers, account, alice, "owed_to_you", 80)

    db_session.expire_all()
    assert _spent(db_session, household, owner) == Decimal("40.00")


def test_paying_someone_back_is_not_spending_either(
    client, db_session, headers, household, account, dining, owner, bob
):
    _budget(db_session, household, dining, 200)
    client.post(
        "/cashflow/reimbursements/on-behalf",
        json={
            "household_id": str(household.id),
            "category_id": str(dining.id),
            "counterparty_id": str(bob.id),
            "amount": "45",
            "date": _at(10).isoformat(),
        },
        headers=headers,
    )
    assert _settle(client, headers, account, bob, "you_owe", 45).status_code == 201

    db_session.expire_all()
    # Charged once, when Bob paid — not again when he was paid back.
    assert _spent(db_session, household, owner) == Decimal("45.00")
    assert client.get(
        f"/cashflow/reimbursements/household/{household.id}", headers=headers
    ).json() == []


def test_a_repayment_reaches_the_account(
    client, db_session, headers, household, account, dining, alice
):
    _post_split(client, headers, account, dining, amount=120, splits=[(alice, 80)])
    _settle(client, headers, account, alice, "owed_to_you", 80)

    db_session.expire_all()
    latest = (
        db_session.query(models.AccountBalance)
        .filter(models.AccountBalance.account_id == account.id)
        .order_by(models.AccountBalance.date.desc())
        .first()
    )
    assert Decimal(str(latest.balance)) == Decimal("-40")


def test_settling_from_a_different_account_still_clears_the_same_debt(
    client, db_session, headers, household, account, private_account, dining, alice
):
    """
    The dinner was fronted from the shared `account`, so Alice's debt belongs
    to the household. Repaying it into `private_account` (owner-scoped to a
    single member) must still clear that same debt rather than mistaking the
    settling account's own ownership for the debt's scope and opening a
    second, unrelated one.
    """
    _post_split(client, headers, account, dining, amount=120, splits=[(alice, 80)])
    assert _settle(client, headers, private_account, alice, "owed_to_you", 80).status_code == 201

    balances = client.get(
        f"/cashflow/reimbursements/household/{household.id}", headers=headers
    ).json()
    assert balances == []


def test_settling_a_private_debt_through_a_shared_account_still_clears_it(
    client, db_session, headers, household, account, private_account, dining, owner, alice
):
    """
    The mirror of the case above: the dinner was fronted privately, so the
    settle request must carry that owner scope explicitly (as
    `CounterpartyBalanceResponse.owner_user_id` would hand back) even though
    the repayment itself lands in the shared `account`.
    """
    _post_split(client, headers, private_account, dining, amount=120, splits=[(alice, 80)])
    assert (
        _settle(
            client, headers, account, alice, "owed_to_you", 80, owner_user_id=owner.id
        ).status_code
        == 201
    )

    balances = client.get(
        f"/cashflow/reimbursements/household/{household.id}", headers=headers
    ).json()
    assert balances == []


def test_settling_is_excluded_from_the_burn_rate(
    client, db_session, headers, household, account, dining, owner, bob
):
    """
    Repaying a debt is cash you will not have to spend again next month. It sits
    in a system category so the runway average ignores it, the same way it
    ignores buying shares.
    """
    client.post(
        "/cashflow/reimbursements/on-behalf",
        json={
            "household_id": str(household.id),
            "category_id": str(dining.id),
            "counterparty_id": str(bob.id),
            "amount": "45",
            "date": _at(10).isoformat(),
        },
        headers=headers,
    )
    _settle(client, headers, account, bob, "you_owe", 45)

    db_session.expire_all()
    spend, _ = budget_service._spend_by_category(
        db_session, household.id, owner, date(2026, 8, 1), date(2026, 8, 31)
    )
    reimbursement = (
        db_session.query(models.Category)
        .filter(
            models.Category.household_id == household.id,
            models.Category.name == models.SYSTEM_CATEGORY_REIMBURSEMENT,
        )
        .first()
    )
    assert reimbursement is not None
    assert models.SYSTEM_CATEGORY_REIMBURSEMENT in models.SYSTEM_CATEGORY_NAMES
    assert spend.get(reimbursement.id, Decimal("0")) == Decimal("45")


# ---------------------------------------------------------------------------
# Editing and deleting
# ---------------------------------------------------------------------------


def test_editing_the_description_keeps_the_split(
    client, db_session, headers, household, account, dining, owner, alice
):
    """A split that quietly evaporated on an unrelated edit would be worse than none."""
    _budget(db_session, household, dining, 200)
    created = _post_split(client, headers, account, dining, amount=120, splits=[(alice, 80)])
    response = client.put(
        f"/cashflow/transactions/{created['id']}",
        json={"description": "Dinner with Alice"},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    assert response.json()["splits"][0]["counterparty_name"] == "Alice"

    db_session.expire_all()
    assert _spent(db_session, household, owner) == Decimal("40.00")


def test_changing_the_split_moves_the_debt(
    client, db_session, headers, household, account, dining, owner, alice
):
    _budget(db_session, household, dining, 200)
    created = _post_split(client, headers, account, dining, amount=120, splits=[(alice, 80)])
    response = client.put(
        f"/cashflow/transactions/{created['id']}",
        json={"splits": [{"counterparty_id": str(alice.id), "amount": "30"}]},
        headers=headers,
    )
    assert response.status_code == 200, response.text

    db_session.expire_all()
    assert _spent(db_session, household, owner) == Decimal("90.00")
    balances = client.get(
        f"/cashflow/reimbursements/household/{household.id}", headers=headers
    ).json()
    assert Decimal(balances[0]["amount"]) == Decimal("30")


def test_adding_a_second_person_to_an_existing_split(
    client, db_session, headers, household, account, dining, owner, alice, bob
):
    _budget(db_session, household, dining, 500)
    created = _post_split(client, headers, account, dining, amount=300, splits=[(alice, 100)])
    response = client.put(
        f"/cashflow/transactions/{created['id']}",
        json={
            "splits": [
                {"counterparty_id": str(alice.id), "amount": "100"},
                {"counterparty_id": str(bob.id), "amount": "100"},
            ]
        },
        headers=headers,
    )
    assert response.status_code == 200, response.text

    db_session.expire_all()
    assert _spent(db_session, household, owner) == Decimal("100.00")
    balances = client.get(
        f"/cashflow/reimbursements/household/{household.id}", headers=headers
    ).json()
    assert {b["counterparty_name"]: Decimal(b["amount"]) for b in balances} == {
        "Alice": Decimal("100"),
        "Bob": Decimal("100"),
    }


def test_clearing_the_split_makes_it_all_yours(
    client, db_session, headers, household, account, dining, owner, alice
):
    _budget(db_session, household, dining, 200)
    created = _post_split(client, headers, account, dining, amount=120, splits=[(alice, 80)])
    response = client.put(
        f"/cashflow/transactions/{created['id']}",
        json={"splits": []},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    assert response.json()["splits"] == []

    db_session.expire_all()
    assert _spent(db_session, household, owner) == Decimal("120.00")
    assert client.get(
        f"/cashflow/reimbursements/household/{household.id}", headers=headers
    ).json() == []


def test_omitting_the_split_key_leaves_it_alone(
    client, db_session, headers, household, account, dining, owner, alice
):
    """Leaving `splits` out of the payload must not be read as clearing it."""
    _budget(db_session, household, dining, 200)
    created = _post_split(client, headers, account, dining, amount=120, splits=[(alice, 80)])
    response = client.put(
        f"/cashflow/transactions/{created['id']}",
        json={"amount": "120"},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    assert response.json()["splits"][0]["counterparty_name"] == "Alice"

    db_session.expire_all()
    assert _spent(db_session, household, owner) == Decimal("40.00")


def test_shrinking_the_bill_below_the_split_clamps_it(
    client, db_session, headers, household, account, dining, owner, alice
):
    """
    Correcting 120 down to 50 must not leave 80 owed against it: the entry would
    not balance, and the ledger would refuse it. The split follows the bill down.
    """
    _budget(db_session, household, dining, 200)
    created = _post_split(client, headers, account, dining, amount=120, splits=[(alice, 80)])
    response = client.put(
        f"/cashflow/transactions/{created['id']}",
        json={"amount": "50"},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    assert Decimal(response.json()["splits"][0]["amount"]) == Decimal("50")

    db_session.expire_all()
    assert _spent(db_session, household, owner) == Decimal("0.00")


def test_deleting_the_transaction_cancels_the_debt(
    client, db_session, headers, household, account, dining, alice
):
    created = _post_split(client, headers, account, dining, amount=120, splits=[(alice, 80)])
    assert (
        client.delete(f"/cashflow/transactions/{created['id']}", headers=headers).status_code
        == 204
    )
    assert client.get(
        f"/cashflow/reimbursements/household/{household.id}", headers=headers
    ).json() == []


# ---------------------------------------------------------------------------
# The books stay balanced
# ---------------------------------------------------------------------------


def test_the_books_balance_after_every_flow(
    client, db_session, headers, household, account, dining, alice, bob
):
    _post_split(client, headers, account, dining, amount=120, splits=[(alice, 80)])
    client.post(
        "/cashflow/reimbursements/on-behalf",
        json={
            "household_id": str(household.id),
            "category_id": str(dining.id),
            "counterparty_id": str(bob.id),
            "amount": "45",
            "date": _at(11).isoformat(),
        },
        headers=headers,
    )
    _settle(client, headers, account, alice, "owed_to_you", 80)
    _settle(client, headers, account, bob, "you_owe", 45)

    db_session.expire_all()
    debits, credits = ledger_service.trial_balance(db_session, household.id)
    assert debits == credits
    assert debits > 0


def test_a_three_way_split_still_balances(
    client, db_session, headers, household, account, dining, alice, bob
):
    _post_split(
        client, headers, account, dining, amount=300, splits=[(alice, 100), (bob, 100)]
    )

    db_session.expire_all()
    debits, credits = ledger_service.trial_balance(db_session, household.id)
    assert debits == credits
    assert debits > 0


def test_alice_owing_you_and_you_owing_alice_are_separate(
    client, db_session, headers, household, account, dining, alice
):
    """
    Netting two directions is the user's decision, not the ledger's. Someone can
    owe you for last night and be owed for last week, and collapsing that loses
    the fact that there are two things to settle.
    """
    _post_split(client, headers, account, dining, amount=120, splits=[(alice, 80)])
    client.post(
        "/cashflow/reimbursements/on-behalf",
        json={
            "household_id": str(household.id),
            "category_id": str(dining.id),
            "counterparty_id": str(alice.id),
            "amount": "45",
            "date": _at(11).isoformat(),
        },
        headers=headers,
    )

    balances = client.get(
        f"/cashflow/reimbursements/household/{household.id}", headers=headers
    ).json()
    assert {(b["direction"], Decimal(b["amount"])) for b in balances} == {
        ("owed_to_you", Decimal("80")),
        ("you_owe", Decimal("45")),
    }


def test_a_transfer_posts_one_entry_and_charges_no_category(
    client, db_session, headers, household, account, dining
):
    """
    A transfer is one event across two rows. Posting it twice, or charging the
    Transfer category, would put your own money moving between your own accounts
    into the ledger as spending.
    """
    other = models.FinancialAccount(
        id=uuid.uuid7(),
        household_id=household.id,
        name="Savings",
        liquidity=models.LiquidityStatus.liquid,
        tax_status=models.TaxTreatment.taxable,
        kind=models.AccountKind.asset,
        currency="USD",
    )
    db_session.add(other)
    db_session.commit()

    response = client.post(
        "/cashflow/transfers",
        json={
            "from_account_id": str(account.id),
            "to_account_id": str(other.id),
            "amount": "200",
            "date": _at(10).isoformat(),
        },
        headers=headers,
    )
    assert response.status_code == 201, response.text

    db_session.expire_all()
    entries = (
        db_session.query(models.JournalEntry)
        .filter(models.JournalEntry.household_id == household.id)
        .all()
    )
    assert len(entries) == 1
    roles = {
        db_session.query(models.LedgerAccount)
        .filter(models.LedgerAccount.id == line.ledger_account_id)
        .one()
        .role
        for line in entries[0].lines
    }
    assert roles == {models.LedgerAccountRole.cash}


# ---------------------------------------------------------------------------
# Privacy
#
# A receivable is as revealing as the account it came from — "Alice owes you 80"
# names a person and an amount. Private accounts are a server-side boundary here
# (AGENTS.md 4a), and these are two new ways across it.
# ---------------------------------------------------------------------------


@pytest.fixture
def housemate(db_session):
    user = models.User(
        id=uuid.uuid7(),
        email="reimb_housemate@example.com",
        name="Housemate",
        salted_hashed_password="fakehash",
        salt="fakesalt",
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def housemate_headers(client, housemate):
    from src.auth import create_access_token

    return {"Authorization": f"Bearer {create_access_token(data={'sub': str(housemate.id)})}"}


@pytest.fixture
def shared_household(db_session, owner, housemate, household):
    for user in (owner, housemate):
        db_session.add(
            models.HouseholdMember(
                id=uuid.uuid7(),
                household_id=household.id,
                user_id=user.id,
                role=(
                    models.HouseholdRoleType.owner
                    if user is owner
                    else models.HouseholdRoleType.editor
                ),
            )
        )
    db_session.commit()
    return household


@pytest.fixture
def private_account(db_session, shared_household, owner):
    acc = models.FinancialAccount(
        id=uuid.uuid7(),
        household_id=shared_household.id,
        name="Private Checking",
        liquidity=models.LiquidityStatus.liquid,
        tax_status=models.TaxTreatment.taxable,
        kind=models.AccountKind.asset,
        currency="USD",
        owner_user_id=owner.id,
    )
    db_session.add(acc)
    db_session.commit()
    db_session.refresh(acc)
    return acc


def test_a_receivable_from_a_private_account_stays_private(
    client, db_session, headers, housemate_headers, shared_household, private_account, dining, alice
):
    _post_split(
        client, headers, private_account, dining, amount=120, splits=[(alice, 80)]
    )

    mine = client.get(
        f"/cashflow/reimbursements/household/{shared_household.id}", headers=headers
    ).json()
    assert len(mine) == 1

    theirs = client.get(
        f"/cashflow/reimbursements/household/{shared_household.id}", headers=housemate_headers
    ).json()
    assert theirs == []


def test_another_members_private_debt_does_not_reach_your_budget(
    client, db_session, headers, housemate_headers, shared_household, dining, housemate, owner, bob
):
    """
    Ledger-only spend has no account to filter on, so the counterparty account
    carries the ownership instead. Without that, a private "Bob paid for me"
    would show up in a housemate's category totals.
    """
    _budget(db_session, shared_household, dining, 200)
    response = client.post(
        "/cashflow/reimbursements/on-behalf",
        json={
            "household_id": str(shared_household.id),
            "category_id": str(dining.id),
            "counterparty_id": str(bob.id),
            "amount": "45",
            "date": _at(10).isoformat(),
            "owner_user_id": str(owner.id),
        },
        headers=headers,
    )
    assert response.status_code == 201, response.text

    db_session.expire_all()
    assert _spent(db_session, shared_household, owner) == Decimal("45.00")
    assert _spent(db_session, shared_household, housemate) == Decimal("0.00")


# ---------------------------------------------------------------------------
# Counterparty CRUD
# ---------------------------------------------------------------------------


def test_a_person_can_be_renamed_without_orphaning_their_history(
    client, db_session, headers, household, account, dining, alice
):
    """The point of a stable id: renaming updates the same receivable, not a new one."""
    _post_split(client, headers, account, dining, amount=120, splits=[(alice, 80)])

    response = client.put(
        f"/cashflow/counterparties/{alice.id}",
        json={"name": "Alicia"},
        headers=headers,
    )
    assert response.status_code == 200, response.text

    balances = client.get(
        f"/cashflow/reimbursements/household/{household.id}", headers=headers
    ).json()
    assert len(balances) == 1
    assert balances[0]["counterparty_id"] == str(alice.id)
    assert balances[0]["counterparty_name"] == "Alicia"
    assert Decimal(balances[0]["amount"]) == Decimal("80")


def test_deleting_a_person_with_history_is_refused(
    client, db_session, headers, account, dining, alice
):
    _post_split(client, headers, account, dining, amount=120, splits=[(alice, 80)])

    response = client.delete(f"/cashflow/counterparties/{alice.id}", headers=headers)
    assert response.status_code == 409


def test_deleting_an_unused_person_succeeds(client, headers, household):
    created = client.post(
        "/cashflow/counterparties",
        json={"household_id": str(household.id), "name": "Nobody Yet"},
        headers=headers,
    ).json()

    response = client.delete(f"/cashflow/counterparties/{created['id']}", headers=headers)
    assert response.status_code == 204


def test_two_people_cannot_share_a_name_in_one_household(client, headers, household, alice):
    response = client.post(
        "/cashflow/counterparties",
        json={"household_id": str(household.id), "name": "Alice"},
        headers=headers,
    )
    assert response.status_code == 409
