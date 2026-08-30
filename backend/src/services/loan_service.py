"""
Loan amortization and forward-looking net worth projection.

Two problems this solves for a user who has just taken on a mortgage:

1.  A liability account is otherwise a number the user has to retype every
    month. Given the loan terms (principal, rate, term) we can amortize it
    forward, so the debt line falls on its own and the payoff date is knowable.

2.  Net worth looks catastrophic on day one of a 25-year mortgage: the debt is
    recorded in full, and the asset it bought is not recorded at all (until
    ``LiquidityStatus.illiquid`` accounts existed there was nowhere to put it).
    ``project_household_net_worth`` walks assets and debts forward together so
    the user can see the crossover date rather than a permanent deficit.

All money here is Decimal. Rates are percent-per-year (3.5 means 3.5%).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Dict, Iterable, List, Optional

from sqlalchemy.orm import Session

from src import models

CENTS = Decimal("0.01")

# A loan that never amortizes would loop forever; cap the schedule at a length
# no consumer loan exceeds (60 years) so bad input can't hang a request.
MAX_SCHEDULE_MONTHS = 720


def _money(value: Decimal) -> Decimal:
    return value.quantize(CENTS, rounding=ROUND_HALF_UP)


def _dec(value) -> Optional[Decimal]:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


# Re-exported so existing callers (and tests) keep importing them from here.
from src.services.date_utils import add_months, months_between  # noqa: E402,F401


def monthly_payment_for(
    principal: Decimal, annual_rate_percent: Decimal, term_months: int
) -> Decimal:
    """
    Standard amortizing payment: P * i / (1 - (1+i)^-n).

    A zero-interest loan degenerates to principal / term.
    """
    if term_months <= 0:
        raise ValueError("term_months must be positive")
    if principal <= 0:
        return Decimal("0")

    monthly_rate = annual_rate_percent / Decimal("100") / Decimal("12")
    if monthly_rate == 0:
        return _money(principal / Decimal(term_months))

    growth = (Decimal("1") + monthly_rate) ** term_months
    return _money(principal * monthly_rate * growth / (growth - Decimal("1")))


@dataclass
class AmortizationRow:
    period: int
    date: date
    payment: Decimal
    interest: Decimal
    principal: Decimal
    balance: Decimal


@dataclass
class LoanTerms:
    principal: Decimal
    annual_rate_percent: Decimal
    term_months: int
    payment: Decimal
    start_date: date


def loan_terms_for(account: models.FinancialAccount) -> Optional[LoanTerms]:
    """
    Read loan terms off an account, or None if it isn't a fully-specified loan.

    A liability without terms is still perfectly valid — it just keeps the old
    behaviour of holding whatever balance the user last entered.
    """
    if account.kind != models.AccountKind.liability:
        return None

    principal = _dec(account.original_principal)
    rate = _dec(account.interest_rate_annual)
    term = account.loan_term_months
    start = account.loan_start_date

    if principal is None or principal <= 0 or not term or term <= 0 or start is None:
        return None
    if rate is None or rate < 0:
        return None

    payment = _dec(account.monthly_payment)
    if payment is None or payment <= 0:
        payment = monthly_payment_for(principal, rate, term)

    return LoanTerms(
        principal=principal,
        annual_rate_percent=rate,
        term_months=term,
        payment=payment,
        start_date=start,
    )


def amortization_schedule(terms: LoanTerms) -> List[AmortizationRow]:
    """
    Full month-by-month schedule until the balance reaches zero.

    The final payment is trimmed to whatever is actually left, so the balance
    lands exactly on zero rather than drifting a few cents either way. If the
    payment is too small to cover the interest the loan never amortizes; we stop
    at MAX_SCHEDULE_MONTHS rather than looping forever, and the caller can see
    the balance is still outstanding.
    """
    monthly_rate = terms.annual_rate_percent / Decimal("100") / Decimal("12")
    balance = terms.principal
    rows: List[AmortizationRow] = []

    limit = min(max(terms.term_months, 1), MAX_SCHEDULE_MONTHS)
    for period in range(1, limit + 1):
        interest = _money(balance * monthly_rate)
        payment = terms.payment
        principal_part = payment - interest

        if principal_part <= 0:
            # Negative amortization: the debt is growing. Record it honestly
            # instead of pretending the loan closes.
            balance = _money(balance + (interest - payment))
            rows.append(
                AmortizationRow(
                    period=period,
                    date=add_months(terms.start_date, period),
                    payment=_money(payment),
                    interest=interest,
                    principal=_money(principal_part),
                    balance=balance,
                )
            )
            continue

        # The last payment is adjusted, exactly as a real lender does it: the
        # monthly figure is rounded to cents, so 360 identical payments leave a
        # few dollars either way. Settle the remainder here so the schedule
        # lands on zero on the contractual payoff date.
        if principal_part >= balance or period == limit:
            principal_part = balance
            payment = _money(principal_part + interest)
            balance = Decimal("0.00")
        else:
            balance = _money(balance - principal_part)

        rows.append(
            AmortizationRow(
                period=period,
                date=add_months(terms.start_date, period),
                payment=_money(payment),
                interest=interest,
                principal=_money(principal_part),
                balance=balance,
            )
        )

        if balance <= 0:
            break

    return rows


def projected_loan_balance(terms: LoanTerms, on_date: date) -> Decimal:
    """Outstanding balance on `on_date` (full principal before the first payment)."""
    elapsed = months_between(terms.start_date, on_date)
    if elapsed <= 0:
        return _money(terms.principal)

    schedule = amortization_schedule(terms)
    balance = _money(terms.principal)
    for row in schedule:
        if row.date > on_date:
            break
        balance = row.balance
    return balance


def payoff_date(terms: LoanTerms) -> Optional[date]:
    """Date of the final payment, or None if the loan never amortizes."""
    schedule = amortization_schedule(terms)
    if not schedule:
        return None
    last = schedule[-1]
    return last.date if last.balance <= 0 else None


# --------------------------------------------------------------------------
# Net worth projection
# --------------------------------------------------------------------------


@dataclass
class ProjectionPoint:
    date: date
    assets: Decimal
    liabilities: Decimal
    net_worth: Decimal


@dataclass
class NetWorthProjection:
    points: List[ProjectionPoint]
    net_worth_positive_date: Optional[date]
    debt_free_date: Optional[date]
    total_interest_remaining: Decimal


def _latest_balance_home(
    account: models.FinancialAccount, balances: Iterable[models.AccountBalance]
) -> Decimal:
    latest: Optional[models.AccountBalance] = None
    for bal in balances:
        if latest is None or bal.date > latest.date:
            latest = bal
    if latest is None:
        return Decimal("0")
    value = _dec(latest.balance_home_currency)
    if value is None:
        value = _dec(latest.balance) or Decimal("0")
    return value


def project_household_net_worth(
    db: Session,
    household_id,
    accounts: List[models.FinancialAccount],
    *,
    start: date,
    months: int,
    monthly_contribution: Decimal = Decimal("0"),
    portfolio_value: Decimal = Decimal("0"),
    portfolio_growth_rate_annual: Decimal = Decimal("0"),
) -> NetWorthProjection:
    """
    Walk every account forward month by month.

    - Liability accounts with loan terms amortize down; those without hold flat.
    - Illiquid (property) accounts grow at their own `appreciation_rate_annual`.
    - Other asset accounts hold flat, plus any `monthly_contribution` the caller
      supplies (savings the user expects to keep adding).
    - Investments grow at `portfolio_growth_rate_annual`.

    Holding cash flat is deliberately conservative: this is a debt-vs-asset
    trajectory, not a retirement calculator, and inventing an income curve would
    make the crossover date look better than the user has any reason to expect.
    """
    account_ids = [a.id for a in accounts]
    balances_by_account: Dict = {aid: [] for aid in account_ids}
    if account_ids:
        rows = (
            db.query(models.AccountBalance)
            .filter(models.AccountBalance.account_id.in_(account_ids))
            .all()
        )
        for row in rows:
            balances_by_account.setdefault(row.account_id, []).append(row)

    # Snapshot today's position, then define how each bucket evolves.
    flat_assets = Decimal("0")
    property_accounts: List[tuple[Decimal, Decimal]] = []  # (value, monthly growth rate)
    flat_liabilities = Decimal("0")
    loans: List[LoanTerms] = []

    for account in accounts:
        current = _latest_balance_home(account, balances_by_account.get(account.id, []))
        if account.kind == models.AccountKind.liability:
            terms = loan_terms_for(account)
            if terms:
                loans.append(terms)
            else:
                flat_liabilities += current
            continue

        if account.liquidity == models.LiquidityStatus.illiquid:
            rate = _dec(account.appreciation_rate_annual) or Decimal("0")
            monthly_growth = rate / Decimal("100") / Decimal("12")
            property_accounts.append((current, monthly_growth))
        else:
            flat_assets += current

    portfolio_monthly_growth = (
        portfolio_growth_rate_annual / Decimal("100") / Decimal("12")
    )

    # Pre-compute each loan's balance trajectory keyed by month offset.
    loan_curves: List[List[Decimal]] = []
    total_interest_remaining = Decimal("0")
    for terms in loans:
        schedule = amortization_schedule(terms)
        # Single pass over the schedule: advance through payments as the
        # projection date moves forward, rather than rescanning per month.
        curve: List[Decimal] = []
        balance = _money(terms.principal)
        cursor = 0
        for offset in range(months + 1):
            at = add_months(start, offset)
            while cursor < len(schedule) and schedule[cursor].date <= at:
                balance = schedule[cursor].balance
                cursor += 1
            curve.append(balance)
        loan_curves.append(curve)
        for row in schedule:
            if row.date >= start:
                total_interest_remaining += row.interest

    points: List[ProjectionPoint] = []
    net_worth_positive_date: Optional[date] = None
    debt_free_date: Optional[date] = None
    had_debt = False

    for offset in range(months + 1):
        at = add_months(start, offset)

        assets = flat_assets + monthly_contribution * Decimal(offset)
        for value, monthly_growth in property_accounts:
            assets += value * (Decimal("1") + monthly_growth) ** offset
        assets += portfolio_value * (Decimal("1") + portfolio_monthly_growth) ** offset

        liabilities = flat_liabilities
        for curve in loan_curves:
            liabilities += curve[offset]

        assets = _money(assets)
        liabilities = _money(liabilities)
        net = _money(assets - liabilities)

        if net_worth_positive_date is None and net >= 0:
            net_worth_positive_date = at
        if liabilities > 0:
            had_debt = True
        # Only a household that actually carried debt at some point in the
        # projection can become "debt free" — a household with none to begin
        # with satisfies liabilities <= 0 on day one (offset 0), which is not
        # the same fact and must not report today's date as a payoff.
        if debt_free_date is None and had_debt and liabilities <= 0:
            debt_free_date = at

        points.append(
            ProjectionPoint(date=at, assets=assets, liabilities=liabilities, net_worth=net)
        )

    return NetWorthProjection(
        points=points,
        net_worth_positive_date=net_worth_positive_date,
        debt_free_date=debt_free_date,
        total_interest_remaining=_money(total_interest_remaining),
    )
