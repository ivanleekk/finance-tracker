import csv
import io
import uuid
import zipfile
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from src import models


@pytest.fixture
def owner_user(db_session):
    user = models.User(
        id=uuid.uuid7(),
        email="owner_export@example.com",
        name="Export Owner",
        salted_hashed_password="fakehash",
        salt="fakesalt",
    )
    db_session.add(user)
    db_session.commit()
    return user


@pytest.fixture
def member_user(db_session):
    user = models.User(
        id=uuid.uuid7(),
        email="member_export@example.com",
        name="Export Member",
        salted_hashed_password="fakehash",
        salt="fakesalt",
    )
    db_session.add(user)
    db_session.commit()
    return user


@pytest.fixture
def outsider_user(db_session):
    user = models.User(
        id=uuid.uuid7(),
        email="outsider_export@example.com",
        name="Outsider",
        salted_hashed_password="fakehash",
        salt="fakesalt",
    )
    db_session.add(user)
    db_session.commit()
    return user


def _auth(user):
    from src.auth import create_access_token
    token = create_access_token(data={"sub": str(user.id)})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def owner_auth_headers(owner_user):
    return _auth(owner_user)


@pytest.fixture
def member_auth_headers(member_user):
    return _auth(member_user)


@pytest.fixture
def outsider_auth_headers(outsider_user):
    return _auth(outsider_user)


@pytest.fixture
def household(db_session, owner_user, member_user):
    household = models.Household(
        id=uuid.uuid7(),
        name="Export Test Household",
        base_currency="USD",
        country_code="US",
        owner_id=owner_user.id,
    )
    db_session.add(household)
    db_session.commit()

    db_session.add_all([
        models.HouseholdMember(
            id=uuid.uuid7(), household_id=household.id, user_id=owner_user.id,
            role=models.HouseholdRoleType.owner,
        ),
        models.HouseholdMember(
            id=uuid.uuid7(), household_id=household.id, user_id=member_user.id,
            role=models.HouseholdRoleType.editor,
        ),
    ])
    db_session.commit()
    return household


@pytest.fixture
def seeded(db_session, household, owner_user):
    """A household with shared + private accounts, transactions, a liability,
    a portfolio with snapshots, and a dividend."""
    shared_account = models.FinancialAccount(
        id=uuid.uuid7(), household_id=household.id, name="Shared Checking",
        liquidity="liquid", tax_status="taxable", currency="USD",
        kind=models.AccountKind.asset, owner_user_id=None,
    )
    private_account = models.FinancialAccount(
        id=uuid.uuid7(), household_id=household.id, name="Owner Private Vault",
        liquidity="liquid", tax_status="taxable", currency="USD",
        kind=models.AccountKind.asset, owner_user_id=owner_user.id,
    )
    loan_account = models.FinancialAccount(
        id=uuid.uuid7(), household_id=household.id, name="Car Loan",
        liquidity="liquid", tax_status="taxable", currency="USD",
        kind=models.AccountKind.liability, owner_user_id=None,
    )
    db_session.add_all([shared_account, private_account, loan_account])
    db_session.flush()

    db_session.add_all([
        models.AccountBalance(
            id=uuid.uuid7(), account_id=shared_account.id, date=date(2026, 1, 1),
            balance=Decimal("1000"), balance_home_currency=Decimal("1000"),
        ),
        models.AccountBalance(
            id=uuid.uuid7(), account_id=shared_account.id, date=date(2026, 6, 1),
            balance=Decimal("5000"), balance_home_currency=Decimal("5000"),
        ),
        models.AccountBalance(
            id=uuid.uuid7(), account_id=private_account.id, date=date(2026, 6, 1),
            balance=Decimal("2000"), balance_home_currency=Decimal("2000"),
        ),
        models.AccountBalance(
            id=uuid.uuid7(), account_id=loan_account.id, date=date(2026, 6, 1),
            balance=Decimal("3000"), balance_home_currency=Decimal("3000"),
        ),
    ])

    salary_cat = models.Category(
        id=uuid.uuid7(), household_id=household.id, name="Salary", type="income",
    )
    food_cat = models.Category(
        id=uuid.uuid7(), household_id=household.id, name="Food", type="expense",
    )
    db_session.add_all([salary_cat, food_cat])
    db_session.flush()

    transfer_id = uuid.uuid7()
    db_session.add_all([
        models.Transaction(
            id=uuid.uuid7(), account_id=shared_account.id, category_id=salary_cat.id,
            date=datetime(2026, 3, 1, tzinfo=timezone.utc), amount=Decimal("4000"),
            amount_home_currency=Decimal("4000"), description="March salary",
            transaction_type=models.TransactionType.income,
        ),
        models.Transaction(
            id=uuid.uuid7(), account_id=shared_account.id, category_id=food_cat.id,
            date=datetime(2026, 3, 5, tzinfo=timezone.utc), amount=Decimal("250"),
            amount_home_currency=Decimal("250"), description="Groceries",
            transaction_type=models.TransactionType.expense,
        ),
        models.Transaction(
            id=uuid.uuid7(), account_id=private_account.id, category_id=food_cat.id,
            date=datetime(2026, 3, 7, tzinfo=timezone.utc), amount=Decimal("99"),
            amount_home_currency=Decimal("99"), description="Private expense",
            transaction_type=models.TransactionType.expense,
        ),
        # Transfer legs must be excluded from income/expense in the report
        models.Transaction(
            id=uuid.uuid7(), account_id=shared_account.id, category_id=food_cat.id,
            date=datetime(2026, 3, 9, tzinfo=timezone.utc), amount=Decimal("500"),
            amount_home_currency=Decimal("500"), description="Transfer out",
            transaction_type=models.TransactionType.expense, transfer_id=transfer_id,
        ),
    ])

    asset = models.Asset(
        id=uuid.uuid7(), ticker="VWRA.L", name="Vanguard FTSE All-World",
        type="etf", currency="USD",
    )
    db_session.add(asset)
    db_session.flush()

    shared_sp = models.SubPortfolio(
        id=uuid.uuid7(), household_id=household.id, name="Retirement",
        risk_profile="balanced", target_amount=Decimal("100000"),
        target_date=date(2050, 1, 1), owner_user_id=None,
    )
    private_sp = models.SubPortfolio(
        id=uuid.uuid7(), household_id=household.id, name="Owner Secret Goal",
        risk_profile="aggressive", owner_user_id=owner_user.id,
    )
    db_session.add_all([shared_sp, private_sp])
    db_session.flush()

    db_session.add_all([
        models.Trade(
            id=uuid.uuid7(), household_id=household.id, sub_portfolio_id=shared_sp.id,
            asset_id=asset.id, account_id=shared_account.id,
            trade_type=models.TradeType.buy, date=datetime(2026, 2, 1, tzinfo=timezone.utc),
            quantity=10, price=Decimal("100"), exchange_rate=1.0,
        ),
        models.Trade(
            id=uuid.uuid7(), household_id=household.id, sub_portfolio_id=private_sp.id,
            asset_id=asset.id, account_id=private_account.id,
            trade_type=models.TradeType.buy, date=datetime(2026, 2, 2, tzinfo=timezone.utc),
            quantity=5, price=Decimal("100"), exchange_rate=1.0,
        ),
    ])

    db_session.add_all([
        # Older snapshot that must be superseded by the newer one
        models.PortfolioSnapshot(
            id=uuid.uuid7(), household_id=household.id, sub_portfolio_id=shared_sp.id,
            asset_id=asset.id, date=date(2026, 5, 1), quantity=10,
            current_price=Decimal("110"), exchange_rate_used=1.0,
            current_value_home_currency=Decimal("1100"),
            average_cost_basis=Decimal("100"), average_cost_basis_home_currency=Decimal("100"),
        ),
        models.PortfolioSnapshot(
            id=uuid.uuid7(), household_id=household.id, sub_portfolio_id=shared_sp.id,
            asset_id=asset.id, date=date(2026, 6, 1), quantity=10,
            current_price=Decimal("120"), exchange_rate_used=1.0,
            current_value_home_currency=Decimal("1200"),
            average_cost_basis=Decimal("100"), average_cost_basis_home_currency=Decimal("100"),
        ),
        models.PortfolioSnapshot(
            id=uuid.uuid7(), household_id=household.id, sub_portfolio_id=private_sp.id,
            asset_id=asset.id, date=date(2026, 6, 1), quantity=5,
            current_price=Decimal("120"), exchange_rate_used=1.0,
            current_value_home_currency=Decimal("600"),
            average_cost_basis=Decimal("100"), average_cost_basis_home_currency=Decimal("100"),
        ),
    ])

    db_session.add(models.Dividend(
        id=uuid.uuid7(), household_id=household.id, sub_portfolio_id=shared_sp.id,
        asset_id=asset.id, account_id=shared_account.id,
        date=datetime(2026, 4, 1, tzinfo=timezone.utc), amount=Decimal("30"),
        amount_home_currency=Decimal("30"), exchange_rate=1.0,
    ))

    db_session.commit()
    return {
        "shared_account": shared_account,
        "private_account": private_account,
        "loan_account": loan_account,
        "shared_sp": shared_sp,
        "private_sp": private_sp,
        "asset": asset,
    }


def _read_zip_csv(resp, name):
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    with zf.open(name) as f:
        return list(csv.DictReader(io.TextIOWrapper(f, encoding="utf-8")))


def test_zip_export_contains_all_datasets(client, owner_auth_headers, household, seeded):
    resp = client.get(f"/exports/household/{household.id}/csv", headers=owner_auth_headers)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/zip"
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    assert sorted(zf.namelist()) == sorted([
        "accounts.csv", "balances.csv", "transactions.csv", "trades.csv",
        "dividends.csv", "scheduled_dividends.csv", "holdings.csv",
        "goals.csv", "categories.csv",
    ])

    accounts = _read_zip_csv(resp, "accounts.csv")
    names = {a["name"] for a in accounts}
    assert names == {"Shared Checking", "Owner Private Vault", "Car Loan"}

    trades = _read_zip_csv(resp, "trades.csv")
    assert len(trades) == 2
    assert {t["ticker"] for t in trades} == {"VWRA.L"}
    assert {t["sub_portfolio"] for t in trades} == {"Retirement", "Owner Secret Goal"}


def test_zip_export_hides_private_items_from_other_member(client, member_auth_headers, household, seeded):
    resp = client.get(f"/exports/household/{household.id}/csv", headers=member_auth_headers)
    assert resp.status_code == 200

    accounts = _read_zip_csv(resp, "accounts.csv")
    assert {a["name"] for a in accounts} == {"Shared Checking", "Car Loan"}

    transactions = _read_zip_csv(resp, "transactions.csv")
    assert all(t["account_name"] != "Owner Private Vault" for t in transactions)
    assert all(t["description"] != "Private expense" for t in transactions)

    trades = _read_zip_csv(resp, "trades.csv")
    assert {t["sub_portfolio"] for t in trades} == {"Retirement"}

    goals = _read_zip_csv(resp, "goals.csv")
    assert {g["name"] for g in goals} == {"Retirement"}

    holdings = _read_zip_csv(resp, "holdings.csv")
    assert {h["sub_portfolio"] for h in holdings} == {"Retirement"}


def test_single_dataset_csv(client, owner_auth_headers, household, seeded):
    resp = client.get(
        f"/exports/household/{household.id}/csv/transactions", headers=owner_auth_headers
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/csv")
    rows = list(csv.DictReader(io.StringIO(resp.text)))
    assert len(rows) == 4
    salary = next(r for r in rows if r["description"] == "March salary")
    assert salary["account_name"] == "Shared Checking"
    assert salary["category"] == "Salary"
    assert salary["type"] == "income"
    assert Decimal(salary["amount"]) == Decimal("4000")


def test_unknown_dataset_404(client, owner_auth_headers, household):
    resp = client.get(
        f"/exports/household/{household.id}/csv/nonsense", headers=owner_auth_headers
    )
    assert resp.status_code == 404


def test_export_forbidden_for_outsider(client, outsider_auth_headers, household, seeded):
    for path in ["csv", "csv/accounts", "report"]:
        resp = client.get(
            f"/exports/household/{household.id}/{path}", headers=outsider_auth_headers
        )
        assert resp.status_code == 403


def test_report_math_for_owner(client, owner_auth_headers, household, seeded):
    resp = client.get(
        f"/exports/household/{household.id}/report",
        params={"start": "2026-01-01", "end": "2026-12-31"},
        headers=owner_auth_headers,
    )
    assert resp.status_code == 200
    report = resp.json()

    # Net worth: 5000 (latest shared) + 2000 (private) - 3000 (loan)
    assert Decimal(str(report["total_assets"])) == Decimal("7000")
    assert Decimal(str(report["total_liabilities"])) == Decimal("3000")
    assert Decimal(str(report["net_worth"])) == Decimal("4000")

    # Latest snapshot only (June, not May): 1200 + 600
    assert Decimal(str(report["portfolio_value"])) == Decimal("1800")
    assert Decimal(str(report["portfolio_cost_basis"])) == Decimal("1500")
    assert Decimal(str(report["portfolio_unrealized_gain"])) == Decimal("300")
    assert len(report["holdings"]) == 2

    # Cash flow: income 4000, expenses 250 + 99; the 500 transfer leg excluded
    assert Decimal(str(report["income_total"])) == Decimal("4000")
    assert Decimal(str(report["expense_total"])) == Decimal("349")
    assert Decimal(str(report["net_cashflow"])) == Decimal("3651")

    assert Decimal(str(report["dividends_period_total"])) == Decimal("30")
    assert Decimal(str(report["dividends_all_time_total"])) == Decimal("30")

    retirement = next(g for g in report["goals"] if g["name"] == "Retirement")
    assert Decimal(str(retirement["current_value_home_currency"])) == Decimal("1200")
    assert retirement["progress_percent"] == pytest.approx(1.2)

    shared_checking = next(a for a in report["accounts"] if a["name"] == "Shared Checking")
    assert Decimal(str(shared_checking["balance"])) == Decimal("5000")
    assert shared_checking["balance_as_of"] == "2026-06-01"


def test_report_respects_privacy_for_member(client, member_auth_headers, household, seeded):
    resp = client.get(
        f"/exports/household/{household.id}/report",
        params={"start": "2026-01-01", "end": "2026-12-31"},
        headers=member_auth_headers,
    )
    assert resp.status_code == 200
    report = resp.json()

    # Private vault (2000) excluded: 5000 - 3000
    assert Decimal(str(report["net_worth"])) == Decimal("2000")
    assert {a["name"] for a in report["accounts"]} == {"Shared Checking", "Car Loan"}
    # Private sub-portfolio holding (600) excluded
    assert Decimal(str(report["portfolio_value"])) == Decimal("1200")
    assert {g["name"] for g in report["goals"]} == {"Retirement"}
    # Private expense (99) excluded
    assert Decimal(str(report["expense_total"])) == Decimal("250")


def test_report_rejects_inverted_period(client, owner_auth_headers, household):
    resp = client.get(
        f"/exports/household/{household.id}/report",
        params={"start": "2026-12-31", "end": "2026-01-01"},
        headers=owner_auth_headers,
    )
    assert resp.status_code == 400
