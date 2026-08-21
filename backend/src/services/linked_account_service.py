"""
Accounts earmarked to a sub-portfolio (#252).

Some money that funds a goal can't be moved into the portfolio proper. A
Singapore CPF OA balance counts towards a housing goal but can't be withdrawn
and invested, so the existing sub-portfolio cash feature -- which moves real
money out of an account -- is the wrong shape for it.

Setting ``FinancialAccount.sub_portfolio_id`` instead *references* the account:
its balance stays exactly where it is for net-worth purposes, and additionally
shows up in that sub-portfolio's value, goal progress and equity curve. That is
achieved by giving each linked account a pseudo-asset (``ACCT.<uuid>``, type
``linked_account``) and writing one snapshot row per day valued at the account's
own balance -- the same trick the cash pseudo-asset already uses, so holdings,
timeseries and goal projection pick it up with no changes of their own.

The return metrics deliberately skip these rows; see ``services/performance.py``.
"""

import uuid
from datetime import date, timedelta
from typing import Dict, Iterable, List, Tuple

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models import (
    Asset,
    AccountBalance,
    FinancialAccount,
    LINKED_ACCOUNT_ASSET_TYPE,
    PRICING_MODE_MANUAL,
    linked_account_ticker,
)


def get_or_create_linked_account_asset(db: Session, account: FinancialAccount) -> Asset:
    """
    Find or create the pseudo-asset standing in for a linked account.

    Keyed on the account id, so renaming the account keeps its snapshot history
    attached. Priced manually -- there is no market to look this up in.
    """
    ticker = linked_account_ticker(account.id)
    asset = db.query(Asset).filter(Asset.ticker == ticker).first()
    if not asset:
        asset = Asset(
            id=uuid.uuid7(),
            ticker=ticker,
            name=account.name,
            type=LINKED_ACCOUNT_ASSET_TYPE,
            currency=account.currency,
            pricing_mode=PRICING_MODE_MANUAL,
        )
        db.add(asset)
        db.flush()
    elif asset.name != account.name or asset.currency != account.currency:
        # Keep the holdings row's label honest after an account rename or a
        # currency correction.
        asset.name = account.name
        asset.currency = account.currency
        db.flush()
    return asset


def get_linked_accounts(db: Session, household_id: uuid.UUID) -> List[FinancialAccount]:
    """Every account in the household earmarked to some sub-portfolio."""
    return list(
        db.execute(
            select(FinancialAccount)
            .where(FinancialAccount.household_id == household_id)
            .where(FinancialAccount.sub_portfolio_id.isnot(None))
        )
        .scalars()
        .all()
    )


def balance_series(
    db: Session,
    account_ids: Iterable[uuid.UUID],
    start_date: date,
    end_date: date,
) -> Dict[Tuple[date, uuid.UUID], float]:
    """
    ``{(day, account_id): balance}`` in the account's own currency for every day
    in the range, forward-filled from the most recent recorded balance.

    Forward-filling matters: balances are recorded on the days something happened,
    not daily, so a plain per-day join would value the account at zero on every
    quiet day and draw a goal's equity curve as a comb.

    Days before an account's first ever balance are omitted rather than zero-filled
    -- the account didn't exist yet as far as the data is concerned, and a leading
    run of zeroes would read as "the goal lost everything" on the chart.
    """
    account_ids = list(account_ids)
    if not account_ids:
        return {}

    rows = db.execute(
        select(AccountBalance.account_id, AccountBalance.date, AccountBalance.balance)
        .where(AccountBalance.account_id.in_(account_ids))
        .where(AccountBalance.date <= end_date)
        .order_by(AccountBalance.date.asc())
    ).all()

    by_account: Dict[uuid.UUID, List[Tuple[date, float]]] = {}
    for account_id, row_date, balance in rows:
        by_account.setdefault(account_id, []).append((row_date, float(balance or 0.0)))

    series: Dict[Tuple[date, uuid.UUID], float] = {}
    for account_id, entries in by_account.items():
        idx = 0
        last: float | None = None
        current = start_date
        # Consume everything strictly before the window so `last` starts correct.
        while idx < len(entries) and entries[idx][0] < start_date:
            last = entries[idx][1]
            idx += 1
        while current <= end_date:
            while idx < len(entries) and entries[idx][0] == current:
                last = entries[idx][1]
                idx += 1
            if last is not None:
                series[(current, account_id)] = last
            current += timedelta(days=1)
    return series
