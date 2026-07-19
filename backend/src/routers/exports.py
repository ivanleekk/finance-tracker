import csv
import io
import uuid
import zipfile
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Callable

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from src import models, schemas
from src.auth import get_current_user, verify_household_access
from src.database import get_db

router = APIRouter(prefix="/exports", tags=["Data Export"])


def _dec(value) -> Decimal | None:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def _enum_value(value) -> str | None:
    return value.value if value is not None else None


class ExportContext:
    """Pre-loaded, visibility-filtered data shared by every dataset builder.

    Accounts and sub-portfolios follow the private-ownership rule (NULL owner =
    shared with the household, otherwise owner-only); everything downstream
    (balances, transactions, trades, dividends, snapshots) is filtered through
    those visible sets so a private item never leaks into another member's export.
    """

    def __init__(self, db: Session, household: models.Household, user: models.User):
        self.db = db
        self.household = household
        self.user = user

        self.accounts = (
            db.query(models.FinancialAccount)
            .filter(
                models.FinancialAccount.household_id == household.id,
                (models.FinancialAccount.owner_user_id.is_(None))
                | (models.FinancialAccount.owner_user_id == user.id),
            )
            .order_by(models.FinancialAccount.name)
            .all()
        )
        self.account_ids = [a.id for a in self.accounts]
        self.account_names = {a.id: a.name for a in self.accounts}

        self.sub_portfolios = (
            db.query(models.SubPortfolio)
            .filter(
                models.SubPortfolio.household_id == household.id,
                (models.SubPortfolio.owner_user_id.is_(None))
                | (models.SubPortfolio.owner_user_id == user.id),
            )
            .order_by(models.SubPortfolio.name)
            .all()
        )
        self.sub_portfolio_ids = [sp.id for sp in self.sub_portfolios]
        self.sub_portfolio_names = {sp.id: sp.name for sp in self.sub_portfolios}

        self.categories = (
            db.query(models.Category)
            .filter(models.Category.household_id == household.id)
            .order_by(models.Category.name)
            .all()
        )
        self.category_names = {c.id: c.name for c in self.categories}

        self.assets = {a.id: a for a in db.query(models.Asset).all()}

    def asset_ticker(self, asset_id) -> str | None:
        asset = self.assets.get(asset_id)
        return asset.ticker if asset else None

    def asset_name(self, asset_id) -> str | None:
        asset = self.assets.get(asset_id)
        return asset.name if asset else None


def _accounts_rows(ctx: ExportContext):
    headers = ["id", "name", "kind", "currency", "liquidity", "tax_status", "visibility"]
    rows = [
        [
            a.id,
            a.name,
            _enum_value(a.kind),
            a.currency,
            _enum_value(a.liquidity),
            _enum_value(a.tax_status),
            "private" if a.owner_user_id else "shared",
        ]
        for a in ctx.accounts
    ]
    return headers, rows


def _balances_rows(ctx: ExportContext):
    headers = ["account_id", "account_name", "date", "balance", "balance_home_currency", "is_manual"]
    if not ctx.account_ids:
        return headers, []
    balances = (
        ctx.db.query(models.AccountBalance)
        .filter(models.AccountBalance.account_id.in_(ctx.account_ids))
        .order_by(models.AccountBalance.account_id, models.AccountBalance.date)
        .all()
    )
    rows = [
        [
            b.account_id,
            ctx.account_names.get(b.account_id),
            b.date,
            b.balance,
            b.balance_home_currency,
            b.is_manual,
        ]
        for b in balances
    ]
    return headers, rows


def _transactions_rows(ctx: ExportContext):
    headers = [
        "id", "date", "account_name", "category", "type", "amount", "currency",
        "amount_home_currency", "exchange_rate", "description", "transfer_id",
    ]
    if not ctx.account_ids:
        return headers, []
    transactions = (
        ctx.db.query(models.Transaction)
        .filter(models.Transaction.account_id.in_(ctx.account_ids))
        .order_by(models.Transaction.date)
        .all()
    )
    rows = [
        [
            t.id,
            t.date,
            ctx.account_names.get(t.account_id),
            ctx.category_names.get(t.category_id),
            _enum_value(t.transaction_type),
            t.amount,
            t.currency,
            t.amount_home_currency,
            t.exchange_rate,
            t.description,
            t.transfer_id,
        ]
        for t in transactions
    ]
    return headers, rows


def _trades_rows(ctx: ExportContext):
    headers = [
        "id", "date", "sub_portfolio", "ticker", "asset_name", "type", "quantity",
        "price", "currency", "exchange_rate", "funding_account", "description",
        "settled_from_cash",
    ]
    if not ctx.sub_portfolio_ids:
        return headers, []
    trades = (
        ctx.db.query(models.Trade)
        .filter(
            models.Trade.household_id == ctx.household.id,
            models.Trade.sub_portfolio_id.in_(ctx.sub_portfolio_ids),
        )
        .order_by(models.Trade.date)
        .all()
    )
    rows = [
        [
            t.id,
            t.date,
            ctx.sub_portfolio_names.get(t.sub_portfolio_id),
            ctx.asset_ticker(t.asset_id),
            ctx.asset_name(t.asset_id),
            _enum_value(t.trade_type),
            t.quantity,
            t.price,
            t.currency or (ctx.assets.get(t.asset_id).currency if ctx.assets.get(t.asset_id) else None),
            t.exchange_rate,
            ctx.account_names.get(t.account_id),
            t.description,
            t.settlement_trade_id is not None,
        ]
        for t in trades
    ]
    return headers, rows


def _dividends_rows(ctx: ExportContext):
    headers = [
        "id", "date", "sub_portfolio", "ticker", "asset_name", "amount",
        "amount_home_currency", "per_share_amount", "quantity", "exchange_rate", "is_manual",
    ]
    if not ctx.sub_portfolio_ids:
        return headers, []
    dividends = (
        ctx.db.query(models.Dividend)
        .filter(
            models.Dividend.household_id == ctx.household.id,
            models.Dividend.sub_portfolio_id.in_(ctx.sub_portfolio_ids),
        )
        .order_by(models.Dividend.date)
        .all()
    )
    rows = [
        [
            d.id,
            d.date,
            ctx.sub_portfolio_names.get(d.sub_portfolio_id),
            ctx.asset_ticker(d.asset_id),
            ctx.asset_name(d.asset_id),
            d.amount,
            d.amount_home_currency,
            d.per_share_amount,
            d.quantity,
            d.exchange_rate,
            d.is_manual,
        ]
        for d in dividends
    ]
    return headers, rows


def _scheduled_dividends_rows(ctx: ExportContext):
    headers = ["id", "payment_date", "sub_portfolio", "ticker", "amount", "description", "materialized"]
    if not ctx.sub_portfolio_ids:
        return headers, []
    scheduled = (
        ctx.db.query(models.ScheduledDividend)
        .filter(
            models.ScheduledDividend.household_id == ctx.household.id,
            models.ScheduledDividend.sub_portfolio_id.in_(ctx.sub_portfolio_ids),
        )
        .order_by(models.ScheduledDividend.date)
        .all()
    )
    rows = [
        [
            s.id,
            s.date,
            ctx.sub_portfolio_names.get(s.sub_portfolio_id),
            ctx.asset_ticker(s.asset_id),
            s.amount,
            s.description,
            s.materialized_at is not None,
        ]
        for s in scheduled
    ]
    return headers, rows


def latest_snapshots(ctx: ExportContext) -> list[models.PortfolioSnapshot]:
    """Latest snapshot row per (sub-portfolio, asset) across visible sub-portfolios."""
    if not ctx.sub_portfolio_ids:
        return []
    snapshots = (
        ctx.db.query(models.PortfolioSnapshot)
        .filter(models.PortfolioSnapshot.sub_portfolio_id.in_(ctx.sub_portfolio_ids))
        .order_by(models.PortfolioSnapshot.date)
        .all()
    )
    latest: dict[tuple, models.PortfolioSnapshot] = {}
    for s in snapshots:
        latest[(s.sub_portfolio_id, s.asset_id)] = s
    return list(latest.values())


def _holdings_rows(ctx: ExportContext):
    headers = [
        "as_of", "sub_portfolio", "ticker", "asset_name", "asset_type", "quantity",
        "price", "currency", "value_home_currency", "avg_cost_basis", "cost_basis_home_currency",
        "unrealized_gain_home_currency",
    ]
    rows = []
    for s in sorted(
        latest_snapshots(ctx),
        key=lambda s: (ctx.sub_portfolio_names.get(s.sub_portfolio_id) or "", ctx.asset_ticker(s.asset_id) or ""),
    ):
        if not s.quantity or abs(s.quantity) < 1e-9:
            continue
        asset = ctx.assets.get(s.asset_id)
        quantity = _dec(s.quantity)
        cost_total = (
            _dec(s.average_cost_basis_home_currency) * quantity
            if s.average_cost_basis_home_currency is not None
            else None
        )
        value = _dec(s.current_value_home_currency)
        rows.append([
            s.date,
            ctx.sub_portfolio_names.get(s.sub_portfolio_id),
            asset.ticker if asset else None,
            asset.name if asset else None,
            asset.type if asset else None,
            s.quantity,
            s.current_price,
            asset.currency if asset else None,
            value,
            s.average_cost_basis,
            cost_total,
            (value - cost_total) if value is not None and cost_total is not None else None,
        ])
    return headers, rows


def _goals_rows(ctx: ExportContext):
    headers = ["id", "name", "risk_profile", "target_amount", "target_date", "visibility"]
    rows = [
        [
            sp.id,
            sp.name,
            sp.risk_profile,
            sp.target_amount,
            sp.target_date,
            "private" if sp.owner_user_id else "shared",
        ]
        for sp in ctx.sub_portfolios
    ]
    return headers, rows


def _categories_rows(ctx: ExportContext):
    headers = ["id", "name", "type"]
    rows = [[c.id, c.name, c.type] for c in ctx.categories]
    return headers, rows


DATASETS: dict[str, Callable[[ExportContext], tuple[list[str], list[list]]]] = {
    "accounts": _accounts_rows,
    "balances": _balances_rows,
    "transactions": _transactions_rows,
    "trades": _trades_rows,
    "dividends": _dividends_rows,
    "scheduled_dividends": _scheduled_dividends_rows,
    "holdings": _holdings_rows,
    "goals": _goals_rows,
    "categories": _categories_rows,
}


def _to_csv(headers: list[str], rows: list[list]) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(headers)
    for row in rows:
        writer.writerow(["" if v is None else v for v in row])
    return buf.getvalue()


def _load_context(
    household_id: uuid.UUID, db: Session, current_user: models.User
) -> ExportContext:
    verify_household_access(household_id, current_user, db)
    household = db.query(models.Household).filter(models.Household.id == household_id).first()
    if not household:
        raise HTTPException(status_code=404, detail="Household not found")
    return ExportContext(db, household, current_user)


@router.get("/household/{household_id}/csv")
def export_household_zip(
    household_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Full data export: one ZIP archive containing a CSV per dataset."""
    ctx = _load_context(household_id, db, current_user)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, builder in DATASETS.items():
            headers, rows = builder(ctx)
            zf.writestr(f"{name}.csv", _to_csv(headers, rows))

    filename = f"finance-export-{date.today().isoformat()}.zip"
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/household/{household_id}/csv/{dataset}")
def export_household_dataset(
    household_id: uuid.UUID,
    dataset: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Single dataset as CSV (see DATASETS for valid names)."""
    builder = DATASETS.get(dataset)
    if builder is None:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown dataset '{dataset}'. Valid datasets: {', '.join(DATASETS)}",
        )
    ctx = _load_context(household_id, db, current_user)
    headers, rows = builder(ctx)

    filename = f"{dataset}-{date.today().isoformat()}.csv"
    return Response(
        content=_to_csv(headers, rows),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/household/{household_id}/report", response_model=schemas.HouseholdReportResponse)
def household_report(
    household_id: uuid.UUID,
    start: date | None = None,
    end: date | None = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Aggregated financial summary used by the printable report page.

    ``start``/``end`` bound the cash-flow and period-dividend sections
    (defaulting to the current calendar year); net worth, holdings and goals
    are always as of the latest available data.
    """
    ctx = _load_context(household_id, db, current_user)
    today = date.today()
    period_start = start or date(today.year, 1, 1)
    period_end = end or today
    if period_start > period_end:
        raise HTTPException(status_code=400, detail="start must be on or before end")

    zero = Decimal("0")

    # --- Net worth from the latest balance per visible account ---
    latest_balance: dict[uuid.UUID, models.AccountBalance] = {}
    if ctx.account_ids:
        balances = (
            db.query(models.AccountBalance)
            .filter(models.AccountBalance.account_id.in_(ctx.account_ids))
            .order_by(models.AccountBalance.date)
            .all()
        )
        for b in balances:
            latest_balance[b.account_id] = b

    total_assets = zero
    total_liabilities = zero
    account_rows: list[schemas.ReportAccountRow] = []
    for a in ctx.accounts:
        b = latest_balance.get(a.id)
        home = _dec(b.balance_home_currency) if b else None
        if home is None and b is not None and (a.currency or "?") == (ctx.household.base_currency or "?"):
            home = _dec(b.balance)
        if home is not None:
            if a.kind == models.AccountKind.liability:
                total_liabilities += home
            else:
                total_assets += home
        account_rows.append(
            schemas.ReportAccountRow(
                id=a.id,
                name=a.name,
                kind=a.kind or models.AccountKind.asset,
                currency=a.currency,
                liquidity=a.liquidity,
                is_private=a.owner_user_id is not None,
                balance=_dec(b.balance) if b else None,
                balance_home_currency=home,
                balance_as_of=b.date if b else None,
            )
        )

    # --- Holdings from the latest snapshot per (sub-portfolio, asset) ---
    portfolio_value = zero
    portfolio_cost = zero
    holding_rows: list[schemas.ReportHoldingRow] = []
    goal_value: dict[uuid.UUID, Decimal] = {sp.id: zero for sp in ctx.sub_portfolios}
    for s in sorted(
        latest_snapshots(ctx),
        key=lambda s: (ctx.sub_portfolio_names.get(s.sub_portfolio_id) or "", ctx.asset_ticker(s.asset_id) or ""),
    ):
        if not s.quantity or abs(s.quantity) < 1e-9:
            continue
        asset = ctx.assets.get(s.asset_id)
        value = _dec(s.current_value_home_currency)
        cost = (
            _dec(s.average_cost_basis_home_currency) * _dec(s.quantity)
            if s.average_cost_basis_home_currency is not None
            else None
        )
        if value is not None:
            portfolio_value += value
            goal_value[s.sub_portfolio_id] = goal_value.get(s.sub_portfolio_id, zero) + value
        if cost is not None:
            portfolio_cost += cost
        holding_rows.append(
            schemas.ReportHoldingRow(
                sub_portfolio=ctx.sub_portfolio_names.get(s.sub_portfolio_id) or "",
                ticker=asset.ticker if asset else "",
                asset_name=asset.name if asset else None,
                asset_type=asset.type if asset else None,
                quantity=s.quantity,
                price=_dec(s.current_price),
                currency=asset.currency if asset else None,
                value_home_currency=value,
                cost_basis_home_currency=cost,
                unrealized_gain_home_currency=(value - cost) if value is not None and cost is not None else None,
                as_of=s.date,
            )
        )

    # --- Cash flow by category within the period ---
    income_total = zero
    expense_total = zero
    flows: dict[tuple[str, models.TransactionType], list] = {}
    if ctx.account_ids:
        transactions = (
            db.query(models.Transaction)
            .filter(
                models.Transaction.account_id.in_(ctx.account_ids),
                models.Transaction.date >= datetime.combine(period_start, datetime.min.time(), tzinfo=timezone.utc),
                models.Transaction.date <= datetime.combine(period_end, datetime.max.time(), tzinfo=timezone.utc),
                models.Transaction.transfer_id.is_(None),  # Transfers are not income/expense
            )
            .all()
        )
        for t in transactions:
            if t.transaction_type is None:
                continue
            amount = _dec(t.amount_home_currency)
            if amount is None:
                amount = _dec(t.amount) or zero
            if t.transaction_type == models.TransactionType.income:
                income_total += amount
            else:
                expense_total += amount
            key = (ctx.category_names.get(t.category_id) or "Uncategorized", t.transaction_type)
            entry = flows.setdefault(key, [zero, 0])
            entry[0] += amount
            entry[1] += 1

    cashflow_rows = [
        schemas.ReportCategoryFlow(
            category=category, type=tx_type, total_home_currency=total, transaction_count=count
        )
        for (category, tx_type), (total, count) in sorted(
            flows.items(), key=lambda item: item[1][0], reverse=True
        )
    ]

    # --- Dividends (home currency) ---
    dividends_period = zero
    dividends_all_time = zero
    if ctx.sub_portfolio_ids:
        dividends = (
            db.query(models.Dividend)
            .filter(
                models.Dividend.household_id == household_id,
                models.Dividend.sub_portfolio_id.in_(ctx.sub_portfolio_ids),
            )
            .all()
        )
        for d in dividends:
            amount = _dec(d.amount_home_currency)
            if amount is None:
                amount = _dec(d.amount) or zero
            dividends_all_time += amount
            if d.date is not None and period_start <= d.date.date() <= period_end:
                dividends_period += amount

    # --- Goals ---
    goal_rows = []
    for sp in ctx.sub_portfolios:
        current = goal_value.get(sp.id, zero)
        target = _dec(sp.target_amount)
        goal_rows.append(
            schemas.ReportGoalRow(
                id=sp.id,
                name=sp.name,
                is_private=sp.owner_user_id is not None,
                target_amount=target,
                target_date=sp.target_date,
                current_value_home_currency=current,
                progress_percent=float(current / target * 100) if target else None,
            )
        )

    return schemas.HouseholdReportResponse(
        household_id=household_id,
        household_name=ctx.household.name,
        base_currency=ctx.household.base_currency,
        generated_at=datetime.now(timezone.utc),
        prepared_for=current_user.name,
        period_start=period_start,
        period_end=period_end,
        total_assets=total_assets,
        total_liabilities=total_liabilities,
        net_worth=total_assets - total_liabilities,
        accounts=account_rows,
        portfolio_value=portfolio_value,
        portfolio_cost_basis=portfolio_cost,
        portfolio_unrealized_gain=portfolio_value - portfolio_cost,
        holdings=holding_rows,
        income_total=income_total,
        expense_total=expense_total,
        net_cashflow=income_total - expense_total,
        cashflow_by_category=cashflow_rows,
        dividends_period_total=dividends_period,
        dividends_all_time_total=dividends_all_time,
        goals=goal_rows,
    )
