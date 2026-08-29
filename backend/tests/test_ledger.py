"""
The double-entry ledger (`services/ledger_service.py`).

The suite is organised around what double entry buys that single entry could not
express, because that is what it was introduced for — not around the CRUD.
"""

import uuid
from decimal import Decimal

import pytest

from src import models
from src.services import ledger_service as ledger


@pytest.fixture
def user(db_session):
    row = models.User(
        id=uuid.uuid7(),
        email="ledger@example.com",
        name="Ledger User",
        salted_hashed_password="fakehash",
        salt="fakesalt",
    )
    db_session.add(row)
    db_session.commit()
    return row


@pytest.fixture
def household(db_session, user):
    row = models.Household(
        id=uuid.uuid7(),
        name="Ledger Household",
        base_currency="SGD",
        country_code="SG",
        owner_id=user.id,
    )
    db_session.add(row)
    db_session.commit()
    return row


@pytest.fixture
def bank(db_session, household):
    row = models.FinancialAccount(
        id=uuid.uuid7(),
        household_id=household.id,
        name="Bank",
        liquidity=models.LiquidityStatus.liquid,
        tax_status=models.TaxTreatment.taxable,
        kind=models.AccountKind.asset,
        currency="SGD",
    )
    db_session.add(row)
    db_session.commit()
    return row


@pytest.fixture
def dining(db_session, household):
    row = models.Category(id=uuid.uuid7(), household_id=household.id, name="Dining", type="expense")
    db_session.add(row)
    db_session.commit()
    return row


@pytest.fixture
def alice(db_session, household):
    row = models.Counterparty(id=uuid.uuid7(), household_id=household.id, name="Alice")
    db_session.add(row)
    db_session.commit()
    return row


@pytest.fixture
def mum(db_session, household):
    row = models.Counterparty(id=uuid.uuid7(), household_id=household.id, name="Mum")
    db_session.add(row)
    db_session.commit()
    return row


def _at(db_session, household):
    from datetime import datetime, timezone

    return datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# The invariant
# ---------------------------------------------------------------------------


def test_an_unbalanced_entry_is_refused(db_session, household, bank, dining):
    """The one rule that makes every other answer trustworthy."""
    bank_acct = ledger.ledger_account_for_financial_account(db_session, bank)
    dining_acct = ledger.ledger_account_for_category(db_session, dining)

    with pytest.raises(ledger.UnbalancedEntry):
        ledger.post_entry(
            db=db_session,
            household_id=household.id,
            date=_at(db_session, household),
            lines=[ledger.debit(dining_acct.id, 50), ledger.credit(bank_acct.id, 40)],
        )


def test_a_line_cannot_be_both_a_debit_and_a_credit(db_session, household, bank, dining):
    bank_acct = ledger.ledger_account_for_financial_account(db_session, bank)
    dining_acct = ledger.ledger_account_for_category(db_session, dining)
    with pytest.raises(ledger.UnbalancedEntry):
        ledger.post_entry(
            db=db_session,
            household_id=household.id,
            date=_at(db_session, household),
            lines=[
                ledger.LineSpec(dining_acct.id, debit=Decimal("50"), credit=Decimal("50")),
                ledger.credit(bank_acct.id, 50),
            ],
        )


def test_a_trial_balance_always_balances(db_session, household, bank, dining):
    bank_acct = ledger.ledger_account_for_financial_account(db_session, bank)
    dining_acct = ledger.ledger_account_for_category(db_session, dining)
    for amount in (10, 25, 100):
        ledger.post_entry(
            db=db_session,
            household_id=household.id,
            date=_at(db_session, household),
            lines=[ledger.debit(dining_acct.id, amount), ledger.credit(bank_acct.id, amount)],
        )
    debits, credits = ledger.trial_balance(db_session, household.id)
    assert debits == credits == Decimal("135")


# ---------------------------------------------------------------------------
# What single entry could not express
# ---------------------------------------------------------------------------


def test_paying_on_behalf_of_someone_only_budgets_your_own_share(
    db_session, household, bank, dining, alice
):
    """
    The motivating case. A $200 dinner where $150 is owed back is one entry with
    three lines, and the category only ever sees $50 — not $200 with a correction
    bolted on afterwards.
    """
    bank_acct = ledger.ledger_account_for_financial_account(db_session, bank)
    dining_acct = ledger.ledger_account_for_category(db_session, dining)
    alice = ledger.receivable_account(db_session, household.id, alice)

    ledger.post_entry(
        db=db_session,
        household_id=household.id,
        date=_at(db_session, household),
        description="Group dinner",
        lines=[
            ledger.debit(dining_acct.id, 50),
            ledger.debit(alice.id, 150),
            ledger.credit(bank_acct.id, 200),
        ],
    )

    from datetime import date

    movement = ledger.category_movement(db_session, household.id, date(2026, 7, 1), date(2026, 7, 31))
    assert movement[dining.id] == Decimal("50")
    assert ledger.account_balance(db_session, alice.id) == Decimal("150")
    assert ledger.account_balance(db_session, bank_acct.id) == Decimal("-200")


def test_being_repaid_touches_no_category_at_all(db_session, household, bank, dining, alice):
    """
    The half that single entry got wrong in the other direction: a repayment
    logged as income inflated income and the savings rate. Here it clears the
    receivable and nothing else moves.
    """
    from datetime import date, datetime, timezone

    bank_acct = ledger.ledger_account_for_financial_account(db_session, bank)
    dining_acct = ledger.ledger_account_for_category(db_session, dining)
    alice = ledger.receivable_account(db_session, household.id, alice)

    ledger.post_entry(
        db=db_session,
        household_id=household.id,
        date=_at(db_session, household),
        lines=[
            ledger.debit(dining_acct.id, 50),
            ledger.debit(alice.id, 150),
            ledger.credit(bank_acct.id, 200),
        ],
    )
    ledger.post_entry(
        db=db_session,
        household_id=household.id,
        date=datetime(2026, 7, 5, 12, 0, tzinfo=timezone.utc),
        description="Alice repays",
        lines=[ledger.debit(bank_acct.id, 150), ledger.credit(alice.id, 150)],
    )

    movement = ledger.category_movement(db_session, household.id, date(2026, 7, 1), date(2026, 7, 31))
    assert movement[dining.id] == Decimal("50")
    assert ledger.account_balance(db_session, alice.id) == Decimal("0")
    assert ledger.account_balance(db_session, bank_acct.id) == Decimal("-50")


def test_a_refund_reduces_the_category_instead_of_arriving_as_income(
    db_session, household, bank, dining
):
    """
    Contra-expense. Single entry had nowhere to put a refund — `amount` is
    positive and there is no third transaction type — so refunds were logged as
    income and inflated both income and the savings rate.
    """
    from datetime import date, datetime, timezone

    bank_acct = ledger.ledger_account_for_financial_account(db_session, bank)
    dining_acct = ledger.ledger_account_for_category(db_session, dining)

    ledger.post_entry(
        db=db_session,
        household_id=household.id,
        date=_at(db_session, household),
        lines=[ledger.debit(dining_acct.id, 80), ledger.credit(bank_acct.id, 80)],
    )
    ledger.post_entry(
        db=db_session,
        household_id=household.id,
        date=datetime(2026, 7, 9, 12, 0, tzinfo=timezone.utc),
        description="Refunded a bad meal",
        lines=[ledger.debit(bank_acct.id, 20), ledger.credit(dining_acct.id, 20)],
    )

    movement = ledger.category_movement(db_session, household.id, date(2026, 7, 1), date(2026, 7, 31))
    assert movement[dining.id] == Decimal("60")


def test_a_payable_is_a_liability_and_reads_positive_when_owed(db_session, household, bank, dining, mum):
    """The mirror image: someone else paid, so the household owes them."""
    bank_acct = ledger.ledger_account_for_financial_account(db_session, bank)
    dining_acct = ledger.ledger_account_for_category(db_session, dining)
    mum = ledger.payable_account(db_session, household.id, mum)

    ledger.post_entry(
        db=db_session,
        household_id=household.id,
        date=_at(db_session, household),
        description="Mum paid for dinner",
        lines=[ledger.debit(dining_acct.id, 60), ledger.credit(mum.id, 60)],
    )
    # Credit-normal, so an outstanding debt reads as a positive balance.
    assert ledger.account_balance(db_session, mum.id) == Decimal("60")
    assert ledger.account_balance(db_session, bank_acct.id) == Decimal("0")


# ---------------------------------------------------------------------------
# Chart of accounts
# ---------------------------------------------------------------------------


def test_a_liability_account_is_credit_normal(db_session, household):
    """
    The sign lives in the account type, which is why nothing downstream has to
    remember to negate a loan — see the iOS/Android AccountRow that had to.
    """
    loan = models.FinancialAccount(
        id=uuid.uuid7(),
        household_id=household.id,
        name="Mortgage",
        liquidity=models.LiquidityStatus.liquid,
        tax_status=models.TaxTreatment.taxable,
        kind=models.AccountKind.liability,
        currency="SGD",
    )
    db_session.add(loan)
    db_session.commit()

    acct = ledger.ledger_account_for_financial_account(db_session, loan)
    assert acct.type == models.LedgerAccountType.liability
    assert acct.is_debit_normal is False


def test_the_chart_account_for_a_row_is_created_once(db_session, household, bank, dining, alice):
    """Two chart accounts for one bank account would silently split its balance."""
    first = ledger.ledger_account_for_financial_account(db_session, bank)
    second = ledger.ledger_account_for_financial_account(db_session, bank)
    assert first.id == second.id

    a = ledger.receivable_account(db_session, household.id, alice)
    b = ledger.receivable_account(db_session, household.id, alice)
    assert a.id == b.id


def test_owing_alice_and_being_owed_by_alice_are_separate_accounts(db_session, household, alice):
    """Netting the two is the user's business, not the ledger's."""
    owed_to_us = ledger.receivable_account(db_session, household.id, alice)
    we_owe = ledger.payable_account(db_session, household.id, alice)
    assert owed_to_us.id != we_owe.id
    assert owed_to_us.type == models.LedgerAccountType.asset
    assert we_owe.type == models.LedgerAccountType.liability


def test_reposting_the_same_source_replaces_rather_than_duplicates(
    db_session, household, bank, dining
):
    """
    What makes editing a transaction safe, and the backfill re-runnable: the entry
    a row posted is replaced, not accumulated alongside its correction.
    """
    bank_acct = ledger.ledger_account_for_financial_account(db_session, bank)
    dining_acct = ledger.ledger_account_for_category(db_session, dining)
    source_id = uuid.uuid7()

    for amount in (30, 45):
        ledger.post_entry(
            db=db_session,
            household_id=household.id,
            date=_at(db_session, household),
            lines=[ledger.debit(dining_acct.id, amount), ledger.credit(bank_acct.id, amount)],
            source=models.JournalSource.transaction,
            source_id=source_id,
        )

    entries = (
        db_session.query(models.JournalEntry)
        .filter(models.JournalEntry.source_id == source_id)
        .all()
    )
    assert len(entries) == 1
    assert ledger.account_balance(db_session, dining_acct.id) == Decimal("45")
