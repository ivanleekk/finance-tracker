import uuid
import pytest
from decimal import Decimal
from datetime import date, datetime, timezone
from src import models

@pytest.fixture
def test_user(db_session):
    user = models.User(
        id=uuid.uuid7(),
        email="balance_sync@example.com",
        name="Balance User",
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
        name="Balance Household",
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
        name="Test Account",
        liquidity="liquid",
        tax_status="taxable",
        currency="USD"
    )
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)
    return account

@pytest.fixture
def test_category(db_session, test_household):
    category = models.Category(
        id=uuid.uuid7(),
        household_id=test_household.id,
        name="Income Category",
        type="income"
    )
    db_session.add(category)
    db_session.commit()
    db_session.refresh(category)
    return category

def test_transaction_syncs_to_balance(client, auth_headers, test_account, test_category, db_session):
    # 1. Add initial manual balance
    client.post("/accounts/balances", headers=auth_headers, json={
        "account_id": str(test_account.id),
        "date": "2023-10-01",
        "balance": "1000.00"
    })
    
    # 2. Add transaction on Oct 5
    client.post("/cashflow/transactions", headers=auth_headers, json={
        "account_id": str(test_account.id),
        "category_id": str(test_category.id),
        "date": "2023-10-05T12:00:00Z",
        "amount": "50.00",
        "description": "Test Income"
    })
    
    # 3. Verify balance record created for Oct 5
    bal = db_session.query(models.AccountBalance).filter(
        models.AccountBalance.account_id == test_account.id,
        models.AccountBalance.date == date(2023, 10, 5)
    ).first()
    assert bal is not None
    assert bal.balance == Decimal("1050.00")
    assert bal.is_manual is False

def test_propagation_stops_at_manual(client, auth_headers, test_account, test_category, db_session):
    # 1. Manual balance on Oct 1
    client.post("/accounts/balances", headers=auth_headers, json={
        "account_id": str(test_account.id),
        "date": "2023-10-01",
        "balance": "100.00"
    })
    
    # 2. Manual balance on Oct 10
    client.post("/accounts/balances", headers=auth_headers, json={
        "account_id": str(test_account.id),
        "date": "2023-10-10",
        "balance": "1000.00"
    })
    
    # 3. Transaction on Oct 5 (+50)
    client.post("/cashflow/transactions", headers=auth_headers, json={
        "account_id": str(test_account.id),
        "category_id": str(test_category.id),
        "date": "2023-10-05T12:00:00Z",
        "amount": "50.00",
        "description": "Test"
    })
    
    # 4. Oct 5 should be 150
    bal_oct5 = db_session.query(models.AccountBalance).filter_by(date=date(2023, 10, 5)).first()
    assert bal_oct5.balance == Decimal("150.00")
    
    # 5. Oct 10 should STILL be 1000
    bal_oct10 = db_session.query(models.AccountBalance).filter_by(date=date(2023, 10, 10)).first()
    assert bal_oct10.balance == Decimal("1000.00")

def test_propagation_through_auto_records(client, auth_headers, test_account, test_category, db_session):
    # 1. Oct 1 Manual 100
    client.post("/accounts/balances", headers=auth_headers, json={"account_id": str(test_account.id), "date": "2023-10-01", "balance": "100.00"})
    
    # 2. Oct 5 Transaction +50 (Auto Oct 5: 150)
    client.post("/cashflow/transactions", headers=auth_headers, json={"account_id": str(test_account.id), "category_id": str(test_category.id), "date": "2023-10-05T12:00:00Z", "amount": "50.00", "description": "T1"})
    
    # 3. Oct 7 Transaction +20 (Auto Oct 7: 170)
    client.post("/cashflow/transactions", headers=auth_headers, json={"account_id": str(test_account.id), "category_id": str(test_category.id), "date": "2023-10-07T12:00:00Z", "amount": "20.00", "description": "T2"})
    
    # 4. Add transaction on Oct 3 (+10)
    client.post("/cashflow/transactions", headers=auth_headers, json={"account_id": str(test_account.id), "category_id": str(test_category.id), "date": "2023-10-03T12:00:00Z", "amount": "10.00", "description": "T3"})
    
    # Oct 3: 110
    # Oct 5: 150 + 10 = 160
    # Oct 7: 170 + 10 = 180
    assert db_session.query(models.AccountBalance).filter_by(date=date(2023, 10, 3)).first().balance == Decimal("110.00")
    assert db_session.query(models.AccountBalance).filter_by(date=date(2023, 10, 5)).first().balance == Decimal("160.00")
    assert db_session.query(models.AccountBalance).filter_by(date=date(2023, 10, 7)).first().balance == Decimal("180.00")


def test_a_backdated_transaction_reaches_the_opening_balance(
    client, auth_headers, test_account, test_category, db_session
):
    """
    The bug this fixes: set an account up today with an opening balance, then
    enter a purchase from last week, and the headline balance never moved.

    An account's first balance is an opening balance, not a reconciliation.
    Marking it manual made every new account plant a checkpoint at its creation
    date, and `propagate_balance_change` refuses to move through one — so the
    backdated transaction updated its own day and stopped dead.
    """
    client.post("/accounts/balances", headers=auth_headers, json={
        "account_id": str(test_account.id),
        "date": "2023-10-10",
        "balance": "0.00",
    })

    opening = db_session.query(models.AccountBalance).filter_by(date=date(2023, 10, 10)).first()
    assert opening.is_manual is False, "an opening balance is not a checkpoint"

    # A purchase from before the account was set up.
    client.post("/cashflow/transactions", headers=auth_headers, json={
        "account_id": str(test_account.id),
        "category_id": str(test_category.id),
        "date": "2023-10-05T12:00:00Z",
        "amount": "100.00",
        "description": "Last week",
    })

    db_session.expire_all()
    assert db_session.query(models.AccountBalance).filter_by(
        date=date(2023, 10, 5)
    ).first().balance == Decimal("100.00")
    # The whole point: the opening balance moves with it rather than pinning
    # the account at its starting figure forever.
    assert db_session.query(models.AccountBalance).filter_by(
        date=date(2023, 10, 10)
    ).first().balance == Decimal("100.00")


def test_a_later_balance_is_still_a_checkpoint(
    client, auth_headers, test_account, test_category, db_session
):
    """
    The half that must not regress. A *second* balance is a reconciliation —
    "I counted, and it was this much" — and a transaction entered afterwards
    with an earlier date must not silently overwrite it.
    """
    for on, amount in (("2023-10-01", "100.00"), ("2023-10-10", "1000.00")):
        client.post("/accounts/balances", headers=auth_headers, json={
            "account_id": str(test_account.id), "date": on, "balance": amount,
        })

    balances = {
        b.date: b for b in db_session.query(models.AccountBalance).filter_by(
            account_id=test_account.id
        ).all()
    }
    assert balances[date(2023, 10, 1)].is_manual is False, "the first is the opening balance"
    assert balances[date(2023, 10, 10)].is_manual is True, "the second is a reconciliation"

    client.post("/cashflow/transactions", headers=auth_headers, json={
        "account_id": str(test_account.id),
        "category_id": str(test_category.id),
        "date": "2023-10-05T12:00:00Z",
        "amount": "50.00",
        "description": "Between the two",
    })

    db_session.expire_all()
    assert db_session.query(models.AccountBalance).filter_by(
        date=date(2023, 10, 10)
    ).first().balance == Decimal("1000.00")


def test_editing_the_opening_balance_leaves_it_an_opening_balance(
    client, auth_headers, test_account, db_session
):
    # Correcting the number you started from is not the same as reconciling.
    for amount in ("0.00", "250.00"):
        client.post("/accounts/balances", headers=auth_headers, json={
            "account_id": str(test_account.id), "date": "2023-10-10", "balance": amount,
        })

    opening = db_session.query(models.AccountBalance).filter_by(date=date(2023, 10, 10)).first()
    assert opening.balance == Decimal("250.00")
    assert opening.is_manual is False


@pytest.fixture
def credit_card(db_session, test_household):
    """A liability account — its balance is money owed, stored positive."""
    account = models.FinancialAccount(
        id=uuid.uuid7(),
        household_id=test_household.id,
        name="Credit Card",
        kind=models.AccountKind.liability,
        liquidity="liquid",
        tax_status="taxable",
        currency="USD",
    )
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)
    return account


@pytest.fixture
def expense_category(db_session, test_household):
    category = models.Category(
        id=uuid.uuid7(),
        household_id=test_household.id,
        name="Dining",
        type="expense",
    )
    db_session.add(category)
    db_session.commit()
    db_session.refresh(category)
    return category


def test_a_card_charge_increases_what_you_owe(
    client, auth_headers, credit_card, expense_category, db_session
):
    """
    The bug: spending on a credit card made the household *richer*.

    A liability's balance is the amount outstanding, stored as a positive
    number and subtracted by every net-worth reader. The balance sync applied
    the cash-flow sign regardless of the account's kind, so a $100 charge moved
    the card from 0 to -100 — a debt of *negative* one hundred dollars, which
    every client happily added to net worth.
    """
    client.post("/accounts/balances", headers=auth_headers, json={
        "account_id": str(credit_card.id),
        "date": "2023-10-01",
        "balance": "0.00",
    })

    client.post("/cashflow/transactions", headers=auth_headers, json={
        "account_id": str(credit_card.id),
        "category_id": str(expense_category.id),
        "date": "2023-10-05T12:00:00Z",
        "amount": "100.00",
        "description": "Dinner on the card",
    })

    db_session.expire_all()
    assert db_session.query(models.AccountBalance).filter_by(
        account_id=credit_card.id, date=date(2023, 10, 5)
    ).first().balance == Decimal("100.00")


def test_paying_the_card_down_reduces_what_you_owe(
    client, auth_headers, test_account, credit_card, expense_category, db_session
):
    """The other half: a transfer into a liability settles debt, it isn't a deposit."""
    for account_id, on, amount in (
        (test_account.id, "2023-10-01", "1000.00"),
        (credit_card.id, "2023-10-01", "0.00"),
    ):
        client.post("/accounts/balances", headers=auth_headers, json={
            "account_id": str(account_id), "date": on, "balance": amount,
        })

    client.post("/cashflow/transactions", headers=auth_headers, json={
        "account_id": str(credit_card.id),
        "category_id": str(expense_category.id),
        "date": "2023-10-05T12:00:00Z",
        "amount": "300.00",
        "description": "Groceries",
    })

    resp = client.post("/cashflow/transfers", headers=auth_headers, json={
        "from_account_id": str(test_account.id),
        "to_account_id": str(credit_card.id),
        "date": "2023-10-20T12:00:00Z",
        "amount": "200.00",
        "description": "Card payment",
    })
    assert resp.status_code == 201, resp.text

    db_session.expire_all()
    balances = {
        b.date: b.balance
        for b in db_session.query(models.AccountBalance).filter_by(account_id=credit_card.id).all()
    }
    assert balances[date(2023, 10, 5)] == Decimal("300.00")
    assert balances[date(2023, 10, 20)] == Decimal("100.00")
    # The bank really did lose the money.
    bank = db_session.query(models.AccountBalance).filter_by(
        account_id=test_account.id, date=date(2023, 10, 20)
    ).first()
    assert bank.balance == Decimal("800.00")


def test_reconciling_a_card_upwards_is_a_cost_not_income(
    client, auth_headers, credit_card, db_session
):
    """
    A reconciliation reads its direction off the account's kind, not off the
    sign alone: finding more owed on a card than the chain said is a cost. The
    ledger's equity plug has to move the same way, or the journal pays the card
    down while `account_balances` raises it.
    """
    client.post("/accounts/balances", headers=auth_headers, json={
        "account_id": str(credit_card.id), "date": "2023-10-01", "balance": "100.00",
    })
    resp = client.post("/accounts/balances", headers=auth_headers, json={
        "account_id": str(credit_card.id), "date": "2023-10-10", "balance": "180.00",
    })
    assert resp.status_code == 201, resp.text

    # The opening balance books one of these too; this is the reconciliation.
    adjustment = db_session.query(models.Transaction).filter(
        models.Transaction.account_id == credit_card.id,
        models.Transaction.description == "Automated reconciliation for 2023-10-10",
    ).one()
    assert adjustment.transaction_type == models.TransactionType.expense
    assert adjustment.amount == Decimal("80.00")

    entry = db_session.query(models.JournalEntry).filter_by(source_id=adjustment.id).one()
    card_line = db_session.query(models.LedgerAccount).filter_by(
        financial_account_id=credit_card.id
    ).one()
    card_leg = next(l for l in entry.lines if l.ledger_account_id == card_line.id)
    # Credit-normal: more debt is a credit.
    assert card_leg.credit == Decimal("80.00")
    assert card_leg.debit == Decimal("0")
