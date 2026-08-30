"""
Property (illiquid) accounts, loan amortization, home equity and the forward
net worth projection.

The scenario under test throughout is the one that motivated the feature: a
young household buys a 500k home with a 400k mortgage. Before this existed the
app could record the mortgage but not the house, so net worth read -400k
forever.
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest

from src import models
from src.services import loan_service


# ---------------------------------------------------------------------------
# Pure amortization math (no DB)
# ---------------------------------------------------------------------------


def test_monthly_payment_matches_standard_formula():
    # 400,000 over 30 years at 6% -> the textbook 2,398.20/month.
    payment = loan_service.monthly_payment_for(Decimal("400000"), Decimal("6"), 360)
    assert payment == Decimal("2398.20")


def test_zero_interest_loan_is_straight_line():
    payment = loan_service.monthly_payment_for(Decimal("12000"), Decimal("0"), 12)
    assert payment == Decimal("1000.00")


def test_monthly_payment_rejects_non_positive_term():
    with pytest.raises(ValueError):
        loan_service.monthly_payment_for(Decimal("1000"), Decimal("5"), 0)


def test_schedule_ends_exactly_at_zero():
    terms = loan_service.LoanTerms(
        principal=Decimal("400000"),
        annual_rate_percent=Decimal("6"),
        term_months=360,
        payment=loan_service.monthly_payment_for(Decimal("400000"), Decimal("6"), 360),
        start_date=date(2026, 1, 1),
    )
    schedule = loan_service.amortization_schedule(terms)

    assert len(schedule) == 360
    assert schedule[-1].balance == Decimal("0.00")
    # Principal repaid over the life of the loan is exactly the amount borrowed.
    total_principal = sum(row.principal for row in schedule)
    assert total_principal == Decimal("400000.00")
    # Early payments are mostly interest — the intuition the schedule should convey.
    assert schedule[0].interest > schedule[0].principal
    assert schedule[-1].interest < schedule[-1].principal


def test_payoff_date_is_the_final_payment():
    terms = loan_service.LoanTerms(
        principal=Decimal("12000"),
        annual_rate_percent=Decimal("0"),
        term_months=12,
        payment=Decimal("1000"),
        start_date=date(2026, 1, 15),
    )
    assert loan_service.payoff_date(terms) == date(2027, 1, 15)


def test_negative_amortization_reports_no_payoff():
    # Payment below the monthly interest: the balance grows forever.
    terms = loan_service.LoanTerms(
        principal=Decimal("100000"),
        annual_rate_percent=Decimal("12"),
        term_months=360,
        payment=Decimal("100"),  # interest alone is ~1000/month
        start_date=date(2026, 1, 1),
    )
    schedule = loan_service.amortization_schedule(terms)
    assert schedule[-1].balance > terms.principal
    assert loan_service.payoff_date(terms) is None


def test_projected_balance_before_start_is_full_principal():
    terms = loan_service.LoanTerms(
        principal=Decimal("400000"),
        annual_rate_percent=Decimal("6"),
        term_months=360,
        payment=Decimal("2398.20"),
        start_date=date(2026, 1, 1),
    )
    assert loan_service.projected_loan_balance(terms, date(2025, 6, 1)) == Decimal("400000.00")
    # One year in, a 30-year mortgage has barely moved.
    one_year_in = loan_service.projected_loan_balance(terms, date(2027, 1, 1))
    assert Decimal("393000") < one_year_in < Decimal("396000")


def test_add_months_clamps_short_months():
    assert loan_service.add_months(date(2026, 1, 31), 1) == date(2026, 2, 28)
    assert loan_service.add_months(date(2026, 12, 15), 3) == date(2027, 3, 15)


def test_months_between_counts_whole_months():
    assert loan_service.months_between(date(2026, 1, 15), date(2026, 3, 14)) == 1
    assert loan_service.months_between(date(2026, 1, 15), date(2026, 3, 15)) == 2
    assert loan_service.months_between(date(2026, 3, 15), date(2026, 1, 15)) == -2


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def owner(db_session):
    user = models.User(
        id=uuid.uuid7(),
        email="property_owner@example.com",
        name="Property Owner",
        salted_hashed_password="fakehash",
        salt="fakesalt",
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def owner_headers(client, owner):
    from src.auth import create_access_token

    return {"Authorization": f"Bearer {create_access_token(data={'sub': str(owner.id)})}"}


@pytest.fixture
def stranger(db_session):
    user = models.User(
        id=uuid.uuid7(),
        email="property_stranger@example.com",
        name="Stranger",
        salted_hashed_password="fakehash",
        salt="fakesalt",
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def stranger_headers(client, stranger):
    from src.auth import create_access_token

    return {"Authorization": f"Bearer {create_access_token(data={'sub': str(stranger.id)})}"}


@pytest.fixture
def household(db_session, owner):
    hh = models.Household(
        id=uuid.uuid7(),
        name="Property Household",
        base_currency="USD",
        country_code="US",
        owner_id=owner.id,
    )
    db_session.add(hh)
    db_session.commit()
    db_session.refresh(hh)
    return hh


def _account(db_session, household, **kwargs):
    account = models.FinancialAccount(
        id=uuid.uuid7(),
        household_id=household.id,
        name=kwargs.pop("name", "Account"),
        liquidity=kwargs.pop("liquidity", models.LiquidityStatus.liquid),
        tax_status=kwargs.pop("tax_status", models.TaxTreatment.taxable),
        kind=kwargs.pop("kind", models.AccountKind.asset),
        currency=kwargs.pop("currency", "USD"),
        **kwargs,
    )
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)
    return account


def _balance(db_session, account, amount, on=date(2026, 1, 1)):
    row = models.AccountBalance(
        id=uuid.uuid7(),
        account_id=account.id,
        date=on,
        balance=Decimal(str(amount)),
        balance_home_currency=Decimal(str(amount)),
        is_manual=True,
    )
    db_session.add(row)
    db_session.commit()
    return row


# ---------------------------------------------------------------------------
# Property accounts
# ---------------------------------------------------------------------------


def test_create_property_account_with_appreciation(client, owner_headers, household):
    response = client.post(
        "/accounts/",
        headers=owner_headers,
        json={
            "household_id": str(household.id),
            "name": "Family Home",
            "liquidity": "illiquid",
            "tax_status": "taxable",
            "kind": "asset",
            "currency": "USD",
            "appreciation_rate_annual": "3",
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["liquidity"] == "illiquid"
    assert Decimal(data["appreciation_rate_annual"]) == Decimal("3")


def test_create_mortgage_with_loan_terms(client, owner_headers, household):
    response = client.post(
        "/accounts/",
        headers=owner_headers,
        json={
            "household_id": str(household.id),
            "name": "Mortgage",
            "liquidity": "liquid",
            "tax_status": "taxable",
            "kind": "liability",
            "currency": "USD",
            "original_principal": "400000",
            "interest_rate_annual": "6",
            "loan_term_months": 360,
            "loan_start_date": "2026-01-01",
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["loan_term_months"] == 360
    assert data["loan_start_date"] == "2026-01-01"


@pytest.mark.parametrize(
    "field,value",
    [
        ("interest_rate_annual", "-1"),
        ("interest_rate_annual", "101"),
        ("loan_term_months", 0),
        ("loan_term_months", 5000),
        ("original_principal", "0"),
        ("appreciation_rate_annual", "500"),
    ],
)
def test_nonsense_loan_terms_are_rejected(client, owner_headers, household, field, value):
    payload = {
        "household_id": str(household.id),
        "name": "Bad Loan",
        "liquidity": "liquid",
        "tax_status": "taxable",
        "kind": "liability",
        "currency": "USD",
        field: value,
    }
    assert client.post("/accounts/", headers=owner_headers, json=payload).status_code == 422


# ---------------------------------------------------------------------------
# Loan schedule endpoint
# ---------------------------------------------------------------------------


def test_loan_schedule_endpoint(client, owner_headers, household, db_session):
    mortgage = _account(
        db_session,
        household,
        name="Mortgage",
        kind=models.AccountKind.liability,
        original_principal=Decimal("400000"),
        interest_rate_annual=Decimal("6"),
        loan_term_months=360,
        loan_start_date=date(2026, 1, 1),
    )

    response = client.get(f"/accounts/{mortgage.id}/loan-schedule", headers=owner_headers)
    assert response.status_code == 200
    data = response.json()

    assert len(data["schedule"]) == 360
    assert Decimal(data["monthly_payment"]) == Decimal("2398.20")
    assert data["payoff_date"] == "2056-01-01"
    # A 30-year 6% mortgage costs roughly as much in interest as it does in principal.
    assert Decimal("450000") < Decimal(data["total_interest"]) < Decimal("470000")
    assert Decimal(data["principal_paid"]) + Decimal(data["current_balance"]) == Decimal("400000.00")


def test_loan_schedule_requires_terms(client, owner_headers, household, db_session):
    plain = _account(db_session, household, name="Credit Card", kind=models.AccountKind.liability)
    response = client.get(f"/accounts/{plain.id}/loan-schedule", headers=owner_headers)
    assert response.status_code == 400
    assert "loan terms" in response.json()["detail"]


def test_loan_schedule_hidden_from_other_households(
    client, stranger_headers, household, db_session
):
    mortgage = _account(
        db_session,
        household,
        name="Mortgage",
        kind=models.AccountKind.liability,
        original_principal=Decimal("400000"),
        interest_rate_annual=Decimal("6"),
        loan_term_months=360,
        loan_start_date=date(2026, 1, 1),
    )
    response = client.get(f"/accounts/{mortgage.id}/loan-schedule", headers=stranger_headers)
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# Home equity
# ---------------------------------------------------------------------------


def test_equity_nets_property_against_its_mortgage(client, owner_headers, household, db_session):
    home = _account(
        db_session, household, name="Family Home", liquidity=models.LiquidityStatus.illiquid
    )
    mortgage = _account(
        db_session,
        household,
        name="Mortgage",
        kind=models.AccountKind.liability,
        linked_account_id=home.id,
    )
    _balance(db_session, home, 500000)
    _balance(db_session, mortgage, 400000)

    response = client.get(f"/accounts/household/{household.id}/equity", headers=owner_headers)
    assert response.status_code == 200
    rows = response.json()
    assert len(rows) == 1
    row = rows[0]
    assert Decimal(row["asset_value"]) == Decimal("500000")
    assert Decimal(row["loan_balance"]) == Decimal("400000")
    assert Decimal(row["equity"]) == Decimal("100000")
    assert row["equity_percent"] == pytest.approx(20.0)
    assert row["loan_account_name"] == "Mortgage"


def test_equity_link_works_from_the_property_side(client, owner_headers, household, db_session):
    mortgage = _account(
        db_session, household, name="Mortgage", kind=models.AccountKind.liability
    )
    home = _account(
        db_session,
        household,
        name="Family Home",
        liquidity=models.LiquidityStatus.illiquid,
        linked_account_id=mortgage.id,
    )
    _balance(db_session, home, 500000)
    _balance(db_session, mortgage, 400000)

    rows = client.get(
        f"/accounts/household/{household.id}/equity", headers=owner_headers
    ).json()
    assert Decimal(rows[0]["equity"]) == Decimal("100000")


def test_unencumbered_property_is_all_equity(client, owner_headers, household, db_session):
    car = _account(
        db_session, household, name="Car", liquidity=models.LiquidityStatus.illiquid
    )
    _balance(db_session, car, 20000)

    rows = client.get(
        f"/accounts/household/{household.id}/equity", headers=owner_headers
    ).json()
    assert len(rows) == 1
    assert Decimal(rows[0]["equity"]) == Decimal("20000")
    assert rows[0]["loan_account_id"] is None


def test_cannot_link_an_account_to_itself(client, owner_headers, household, db_session):
    home = _account(
        db_session, household, name="Home", liquidity=models.LiquidityStatus.illiquid
    )
    response = client.put(
        f"/accounts/{home.id}",
        headers=owner_headers,
        json={"linked_account_id": str(home.id)},
    )
    assert response.status_code == 400


def test_cannot_link_across_households(client, owner_headers, household, db_session, stranger):
    other_hh = models.Household(
        id=uuid.uuid7(),
        name="Elsewhere",
        base_currency="USD",
        country_code="US",
        owner_id=stranger.id,
    )
    db_session.add(other_hh)
    db_session.commit()
    foreign = _account(db_session, other_hh, name="Their Loan")
    home = _account(
        db_session, household, name="Home", liquidity=models.LiquidityStatus.illiquid
    )

    response = client.put(
        f"/accounts/{home.id}",
        headers=owner_headers,
        json={"linked_account_id": str(foreign.id)},
    )
    assert response.status_code == 404


def test_cannot_link_to_another_members_private_account(
    client, owner_headers, household, db_session, stranger
):
    db_session.add(
        models.HouseholdMember(
            id=uuid.uuid7(),
            user_id=stranger.id,
            household_id=household.id,
            role=models.HouseholdRoleType.editor,
        )
    )
    db_session.commit()

    private_loan = _account(
        db_session,
        household,
        name="Their Private Loan",
        kind=models.AccountKind.liability,
        owner_user_id=stranger.id,
    )
    home = _account(
        db_session, household, name="Home", liquidity=models.LiquidityStatus.illiquid
    )

    response = client.put(
        f"/accounts/{home.id}",
        headers=owner_headers,
        json={"linked_account_id": str(private_loan.id)},
    )
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# Net worth projection
# ---------------------------------------------------------------------------


def test_projection_shows_the_crossover_out_of_negative_net_worth(
    client, owner_headers, household, db_session
):
    """
    The motivating case: house + mortgage recorded together. Net worth starts
    negative (deposit spent, full debt outstanding) but must climb as the loan
    amortizes — not sit underwater forever.
    """
    home = _account(
        db_session,
        household,
        name="Family Home",
        liquidity=models.LiquidityStatus.illiquid,
        appreciation_rate_annual=Decimal("0"),
    )
    mortgage = _account(
        db_session,
        household,
        name="Mortgage",
        kind=models.AccountKind.liability,
        linked_account_id=home.id,
        original_principal=Decimal("400000"),
        interest_rate_annual=Decimal("6"),
        loan_term_months=360,
        # Must match the UTC date the endpoint projects from. Seeding this with
        # the *local* date makes the test flake for anyone east of UTC between
        # midnight and their offset: the loan's final payment lands one day past
        # the end of the 360-month window, so it never reads as paid off.
        loan_start_date=datetime.now(timezone.utc).date(),
    )
    _balance(db_session, home, 390000)
    _balance(db_session, mortgage, 400000)

    response = client.get(
        f"/accounts/household/{household.id}/projection?months=360", headers=owner_headers
    )
    assert response.status_code == 200
    data = response.json()

    assert Decimal(data["current_net_worth"]) == Decimal("-10000.00")
    # Underwater today, above water later, and monotonically improving.
    assert data["net_worth_positive_date"] is not None
    assert data["debt_free_date"] is not None
    first, last = data["points"][0], data["points"][-1]
    assert Decimal(first["net_worth"]) < 0
    assert Decimal(last["net_worth"]) == Decimal("390000.00")
    assert Decimal(last["liabilities"]) == Decimal("0.00")


def test_projection_appreciates_property(client, owner_headers, household, db_session):
    home = _account(
        db_session,
        household,
        name="Family Home",
        liquidity=models.LiquidityStatus.illiquid,
        appreciation_rate_annual=Decimal("3"),
    )
    _balance(db_session, home, 500000)

    data = client.get(
        f"/accounts/household/{household.id}/projection?months=12", headers=owner_headers
    ).json()

    # 3%/yr compounded monthly on 500k ≈ 515,209 after a year.
    final = Decimal(data["points"][-1]["assets"])
    assert Decimal("515000") < final < Decimal("515500")


def test_projection_holds_ordinary_cash_flat(client, owner_headers, household, db_session):
    savings = _account(db_session, household, name="Savings")
    _balance(db_session, savings, 25000)

    data = client.get(
        f"/accounts/household/{household.id}/projection?months=24", headers=owner_headers
    ).json()
    assert Decimal(data["points"][0]["assets"]) == Decimal("25000.00")
    assert Decimal(data["points"][-1]["assets"]) == Decimal("25000.00")
    # No liability account exists at all, so there's nothing to be "free" of —
    # this must not read like a mortgage that happened to be paid off today.
    assert data["debt_free_date"] is None


def test_projection_applies_monthly_contribution(client, owner_headers, household, db_session):
    savings = _account(db_session, household, name="Savings")
    _balance(db_session, savings, 1000)

    data = client.get(
        f"/accounts/household/{household.id}/projection?months=12&monthly_contribution=500",
        headers=owner_headers,
    ).json()
    assert Decimal(data["points"][-1]["net_worth"]) == Decimal("7000.00")


def test_liability_without_terms_stays_flat(client, owner_headers, household, db_session):
    card = _account(
        db_session, household, name="Credit Card", kind=models.AccountKind.liability
    )
    _balance(db_session, card, 3000)

    data = client.get(
        f"/accounts/household/{household.id}/projection?months=24", headers=owner_headers
    ).json()
    assert Decimal(data["points"][0]["liabilities"]) == Decimal("3000.00")
    assert Decimal(data["points"][-1]["liabilities"]) == Decimal("3000.00")
    assert data["debt_free_date"] is None


@pytest.mark.parametrize(
    "query",
    [
        "months=0",
        "months=1000",
        "monthly_contribution=-100",
        "portfolio_growth_rate_annual=500",
    ],
)
def test_projection_rejects_out_of_range_inputs(client, owner_headers, household, query):
    response = client.get(
        f"/accounts/household/{household.id}/projection?{query}", headers=owner_headers
    )
    assert response.status_code == 400


def test_projection_excludes_another_members_private_accounts(
    client, owner_headers, household, db_session, stranger
):
    db_session.add(
        models.HouseholdMember(
            id=uuid.uuid7(),
            user_id=stranger.id,
            household_id=household.id,
            role=models.HouseholdRoleType.editor,
        )
    )
    db_session.commit()

    shared = _account(db_session, household, name="Joint Savings")
    private = _account(
        db_session, household, name="Their Secret Stash", owner_user_id=stranger.id
    )
    _balance(db_session, shared, 10000)
    _balance(db_session, private, 999999)

    data = client.get(
        f"/accounts/household/{household.id}/projection?months=1", headers=owner_headers
    ).json()
    assert Decimal(data["current_net_worth"]) == Decimal("10000.00")


def test_projection_requires_household_access(client, stranger_headers, household):
    response = client.get(
        f"/accounts/household/{household.id}/projection", headers=stranger_headers
    )
    assert response.status_code == 403
