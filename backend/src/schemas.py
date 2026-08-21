# src/schemas.py

from pydantic import BaseModel, ConfigDict, EmailStr, Field
from typing import Annotated, List, Literal, Optional
from datetime import date, datetime
from decimal import Decimal
import uuid

# ----------------------------------------
# Reusable hardened numeric types
#
# Money and quantities enter the system as untrusted JSON. Python's json parser
# accepts the non-standard tokens ``NaN``/``Infinity``/``-Infinity`` and Pydantic
# floats accept them by default, so an attacker can otherwise poison every
# downstream aggregate (net worth, balances, performance) with a single request.
# ``allow_inf_nan=False`` rejects those; ``gt``/``ge``/``le`` pin the sign and
# range where a value is semantically constrained (a price/quantity/rate is
# always positive, a share of an expense split is 0-100%).
# ----------------------------------------

# Floats
FiniteFloat = Annotated[float, Field(allow_inf_nan=False)]
PositiveFloat = Annotated[float, Field(gt=0, allow_inf_nan=False)]
NonNegativeFloat = Annotated[float, Field(ge=0, allow_inf_nan=False)]

# Decimals (Pydantic already rejects inf/nan Decimals, but be explicit)
FiniteDecimal = Annotated[Decimal, Field(allow_inf_nan=False)]
PositiveDecimal = Annotated[Decimal, Field(gt=0, allow_inf_nan=False)]
NonNegativeDecimal = Annotated[Decimal, Field(ge=0, allow_inf_nan=False)]
PercentDecimal = Annotated[Decimal, Field(ge=0, le=100, allow_inf_nan=False)]
# An emergency-fund target of 0 is meaningful ("I'm not targeting one"); 120
# months is already far beyond any advice, so it's a generous sanity ceiling.
EmergencyMonths = Annotated[Decimal, Field(ge=0, le=120, allow_inf_nan=False)]

# A password long enough to be meaningfully hashed. Empty/1-char passwords are
# a red flag for automated account creation.
Password = Annotated[str, Field(min_length=8, max_length=256)]

# Import our enums from models so Pydantic can validate them
from src.models import (
    AccountKind,
    LiquidityStatus,
    TaxTreatment,
    TransactionType,
    HouseholdRoleType,
    TradeType,
    ThemeMode,
    HouseholdInviteStatus,
    SplitMode,
    RecurrenceFrequency,
    BudgetPeriod,
)

# ----------------------------------------
# 1. USERS & HOUSEHOLDS
# ----------------------------------------


class UserBase(BaseModel):
    email: EmailStr
    preferred_timezone: str = "UTC"
    name: str
    theme_mode: ThemeMode = ThemeMode.system
    primary_color: str = "sky"
    secondary_color: str = "fuchsia"
    base_color: str = "mauve"
    hide_private_from_household: bool = True
    require_face_id_for_vault: bool = True
    default_new_items_private: bool = True
    default_account_id: Optional[uuid.UUID] = None


class UserCreate(UserBase):
    password: Password


class UserUpdate(BaseModel):
    preferred_timezone: Optional[str] = None
    name: Optional[str] = None
    password: Optional[Password] = None
    email: Optional[EmailStr] = None
    theme_mode: Optional[ThemeMode] = None
    primary_color: Optional[str] = None
    secondary_color: Optional[str] = None
    base_color: Optional[str] = None
    hide_private_from_household: Optional[bool] = None
    require_face_id_for_vault: Optional[bool] = None
    default_new_items_private: Optional[bool] = None
    default_account_id: Optional[uuid.UUID] = None
    clear_default_account: bool = False


class UserResponse(UserBase):
    id: uuid.UUID
    model_config = ConfigDict(from_attributes=True)


class HouseholdBase(BaseModel):
    name: str
    base_currency: str
    country_code: str
    default_funding_account_id: Optional[uuid.UUID] = None
    default_sub_portfolio_id: Optional[uuid.UUID] = None
    default_split_mode: SplitMode = SplitMode.even
    # Months of expenses the household wants held in liquid cash (emergency fund).
    emergency_fund_target_months: EmergencyMonths = Decimal("6")


class HouseholdCreate(HouseholdBase):
    pass


class HouseholdUpdate(BaseModel):
    name: Optional[str] = None
    base_currency: Optional[str] = None
    country_code: Optional[str] = None
    default_funding_account_id: Optional[uuid.UUID] = None
    default_sub_portfolio_id: Optional[uuid.UUID] = None
    default_split_mode: Optional[SplitMode] = None
    emergency_fund_target_months: Optional[EmergencyMonths] = None


class HouseholdResponse(HouseholdBase):
    id: uuid.UUID
    model_config = ConfigDict(from_attributes=True)


class HouseholdMemberBase(BaseModel):
    user_id: uuid.UUID
    household_id: uuid.UUID
    role: HouseholdRoleType


class HouseholdMemberCreate(HouseholdMemberBase):
    pass


class HouseholdMemberUpdate(BaseModel):
    role: Optional[HouseholdRoleType] = None


class HouseholdMemberResponse(HouseholdMemberBase):
    id: uuid.UUID
    model_config = ConfigDict(from_attributes=True)


class HouseholdMemberUserResponse(HouseholdMemberResponse):
    name: str
    email: str


class HouseholdInviteCreate(BaseModel):
    email: EmailStr
    role: HouseholdRoleType = HouseholdRoleType.editor


class HouseholdInviteResponse(BaseModel):
    id: uuid.UUID
    household_id: uuid.UUID
    email: str
    role: HouseholdRoleType
    invited_by_user_id: uuid.UUID
    status: HouseholdInviteStatus
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class HouseholdSplitShareCreate(BaseModel):
    user_id: uuid.UUID
    share_percent: PercentDecimal


class HouseholdSplitShareResponse(BaseModel):
    id: uuid.UUID
    household_id: uuid.UUID
    user_id: uuid.UUID
    share_percent: Decimal
    model_config = ConfigDict(from_attributes=True)


# ----------------------------------------
# 2. FINANCIAL ACCOUNTS & BALANCES
# ----------------------------------------


# Loan/property terms are optional everywhere: an account without them keeps
# the original behaviour of holding whatever balance was last entered.
# Rates are percent-per-year and capped well above any real consumer loan so a
# fat-fingered 3500 can't blow up a projection.
LoanRate = Annotated[Decimal, Field(ge=0, le=100, allow_inf_nan=False)]
# Property can fall in value, so appreciation is allowed to be negative.
AppreciationRate = Annotated[Decimal, Field(ge=-100, le=100, allow_inf_nan=False)]
LoanTermMonths = Annotated[int, Field(gt=0, le=720)]


class AccountLoanTerms(BaseModel):
    """Shared optional loan/property fields (see models.FinancialAccount)."""

    original_principal: Optional[PositiveDecimal] = None
    interest_rate_annual: Optional[LoanRate] = None
    loan_term_months: Optional[LoanTermMonths] = None
    monthly_payment: Optional[PositiveDecimal] = None
    loan_start_date: Optional[date] = None
    appreciation_rate_annual: Optional[AppreciationRate] = None
    linked_account_id: Optional[uuid.UUID] = None


class AccountBase(AccountLoanTerms):
    name: str
    liquidity: LiquidityStatus
    tax_status: TaxTreatment
    kind: AccountKind = AccountKind.asset
    currency: str
    owner_user_id: Optional[uuid.UUID] = None
    # Earmarks the account to a sub-portfolio/goal (#252). The balance still counts
    # once towards net worth; this additionally counts it towards that goal.
    sub_portfolio_id: Optional[uuid.UUID] = None


class AccountCreate(AccountBase):
    household_id: uuid.UUID


class AccountUpdate(AccountLoanTerms):
    name: Optional[str] = None
    liquidity: Optional[LiquidityStatus] = None
    tax_status: Optional[TaxTreatment] = None
    kind: Optional[AccountKind] = None
    currency: Optional[str] = None
    owner_user_id: Optional[uuid.UUID] = None
    # Send an explicit null to un-earmark; omitting the key leaves the link alone
    # (update_account uses exclude_unset).
    sub_portfolio_id: Optional[uuid.UUID] = None


class AccountResponse(AccountBase):
    id: uuid.UUID
    household_id: uuid.UUID
    model_config = ConfigDict(from_attributes=True)


# ----------------------------------------
# 2b. LOAN AMORTIZATION & NET WORTH PROJECTION
# ----------------------------------------


class AmortizationRow(BaseModel):
    period: int
    date: date
    payment: Decimal
    interest: Decimal
    principal: Decimal
    balance: Decimal


class LoanScheduleResponse(BaseModel):
    account_id: uuid.UUID
    account_name: str
    currency: str
    original_principal: Decimal
    interest_rate_annual: Decimal
    loan_term_months: int
    monthly_payment: Decimal
    loan_start_date: date
    # None when the payment is too small to ever clear the balance.
    payoff_date: Optional[date] = None
    current_balance: Decimal
    principal_paid: Decimal
    interest_paid: Decimal
    total_interest: Decimal
    remaining_interest: Decimal
    schedule: List[AmortizationRow]


class NetWorthProjectionPoint(BaseModel):
    date: date
    assets: Decimal
    liabilities: Decimal
    net_worth: Decimal


class NetWorthProjectionResponse(BaseModel):
    household_id: uuid.UUID
    base_currency: str
    start: date
    months: int
    current_net_worth: Decimal
    # The reassuring number: when the household stops being underwater. None if
    # it never crosses within the projected window.
    net_worth_positive_date: Optional[date] = None
    debt_free_date: Optional[date] = None
    total_interest_remaining: Decimal
    points: List[NetWorthProjectionPoint]


class LinkedEquityRow(BaseModel):
    """A property and the loan secured against it, netted to equity."""

    asset_account_id: uuid.UUID
    asset_account_name: str
    asset_value: Decimal
    loan_account_id: Optional[uuid.UUID] = None
    loan_account_name: Optional[str] = None
    loan_balance: Decimal
    equity: Decimal
    equity_percent: Optional[float] = None


class BalanceBase(BaseModel):
    date: date
    # Balances may be negative (liabilities, overdrawn accounts) but never
    # non-finite.
    balance: FiniteDecimal
    is_manual: bool = True


class BalanceCreate(BalanceBase):
    account_id: uuid.UUID


class BalanceUpdate(BaseModel):
    date: Optional[date] = None
    balance: Optional[FiniteDecimal] = None
    balance_home_currency: Optional[FiniteDecimal] = None


class BalanceResponse(BalanceBase):
    id: uuid.UUID
    account_id: uuid.UUID
    balance_home_currency: Optional[Decimal] = None
    model_config = ConfigDict(from_attributes=True)


class AccountAccessBase(BaseModel):
    account_id: uuid.UUID
    user_id: uuid.UUID
    role: str


class AccountAccessCreate(AccountAccessBase):
    id: uuid.UUID


class AccountAccessUpdate(BaseModel):
    role: Optional[str] = None


class AccountAccessResponse(AccountAccessBase):
    id: uuid.UUID
    model_config = ConfigDict(from_attributes=True)


class PortfolioAccessBase(BaseModel):
    sub_portfolio_id: uuid.UUID
    user_id: uuid.UUID
    role: str


class PortfolioAccessCreate(PortfolioAccessBase):
    id: uuid.UUID


class PortfolioAccessUpdate(BaseModel):
    role: Optional[str] = None


class PortfolioAccessResponse(PortfolioAccessBase):
    id: uuid.UUID
    model_config = ConfigDict(from_attributes=True)


# ----------------------------------------
# 3. CASH FLOW (CATEGORIES & TRANSACTIONS)
# ----------------------------------------


class CategoryBase(BaseModel):
    name: str
    type: TransactionType


class CategoryCreate(CategoryBase):
    household_id: uuid.UUID


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[TransactionType] = None


class CategoryResponse(CategoryBase):
    id: uuid.UUID
    household_id: uuid.UUID
    model_config = ConfigDict(from_attributes=True)


class TransactionBase(BaseModel):
    date: datetime
    # Income/expense sign is derived from the category, so the amount is a
    # positive magnitude. A negative amount would silently flip a logged expense
    # into income against the account balance.
    amount: PositiveDecimal
    amount_home_currency: Optional[FiniteDecimal] = None
    currency: Optional[str] = None
    exchange_rate: Optional[PositiveFloat] = None
    description: Optional[str] = None


class TransactionCreate(TransactionBase):
    account_id: uuid.UUID
    category_id: uuid.UUID


class TransactionUpdate(BaseModel):
    date: Optional[datetime] = None
    amount: Optional[PositiveDecimal] = None
    amount_home_currency: Optional[FiniteDecimal] = None
    currency: Optional[str] = None
    exchange_rate: Optional[PositiveFloat] = None
    description: Optional[str] = None
    account_id: Optional[uuid.UUID] = None
    category_id: Optional[uuid.UUID] = None


class TransactionResponse(TransactionBase):
    id: uuid.UUID
    account_id: uuid.UUID
    category_id: uuid.UUID
    currency: Optional[str] = None
    exchange_rate: Optional[float] = None
    transaction_type: TransactionType
    transfer_id: Optional[uuid.UUID] = None
    # Set when a recurring rule generated this row rather than a person.
    recurring_transaction_id: Optional[uuid.UUID] = None
    model_config = ConfigDict(from_attributes=True)


# ----------------------------------------
# 3b. RECURRING TRANSACTIONS
# ----------------------------------------


class RecurringTransactionBase(BaseModel):
    account_id: uuid.UUID
    category_id: uuid.UUID
    # Positive magnitude — direction comes from the category, as with a normal
    # transaction.
    amount: PositiveDecimal
    currency: Optional[str] = None
    description: Optional[str] = None
    frequency: RecurrenceFrequency
    start_date: date
    end_date: Optional[date] = None
    is_active: bool = True
    owner_user_id: Optional[uuid.UUID] = None


class RecurringTransactionCreate(RecurringTransactionBase):
    household_id: uuid.UUID


class RecurringTransactionUpdate(BaseModel):
    account_id: Optional[uuid.UUID] = None
    category_id: Optional[uuid.UUID] = None
    amount: Optional[PositiveDecimal] = None
    currency: Optional[str] = None
    description: Optional[str] = None
    frequency: Optional[RecurrenceFrequency] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    next_due_date: Optional[date] = None
    is_active: Optional[bool] = None


class RecurringTransactionResponse(RecurringTransactionBase):
    id: uuid.UUID
    household_id: uuid.UUID
    next_due_date: date
    last_posted_date: Optional[date] = None
    model_config = ConfigDict(from_attributes=True)


class UpcomingOccurrence(BaseModel):
    recurring_transaction_id: uuid.UUID
    description: Optional[str] = None
    category_name: str
    account_name: str
    date: date
    amount: Decimal
    currency: Optional[str] = None
    transaction_type: TransactionType


class RecurringRunResponse(BaseModel):
    posted: int


# ----------------------------------------
# 3c. BUDGETS & EMERGENCY FUND
# ----------------------------------------


class BudgetBase(BaseModel):
    category_ids: List[uuid.UUID] = Field(min_length=1)
    amount: PositiveDecimal  # the limit, in the household base currency
    period: BudgetPeriod = BudgetPeriod.monthly
    owner_user_id: Optional[uuid.UUID] = None


class BudgetCreate(BudgetBase):
    household_id: uuid.UUID


class BudgetUpdate(BaseModel):
    amount: Optional[PositiveDecimal] = None
    period: Optional[BudgetPeriod] = None


class BudgetResponse(BudgetBase):
    id: uuid.UUID
    household_id: uuid.UUID
    model_config = ConfigDict(from_attributes=True)


class BudgetStatusRow(BaseModel):
    budget_id: uuid.UUID
    category_ids: List[uuid.UUID]
    category_names: List[str]
    period: BudgetPeriod
    is_private: bool
    limit: Decimal
    spent: Decimal
    remaining: Decimal
    percent_used: float
    period_start: date
    period_end: date
    days_elapsed: int
    days_total: int
    # Spend extrapolated to the end of the period at the current daily rate.
    projected_spend: Decimal
    projected_over: bool


class BudgetStatusResponse(BaseModel):
    household_id: uuid.UUID
    base_currency: str
    as_of: date
    total_limit: Decimal
    total_spent: Decimal
    budgets: List[BudgetStatusRow]


class EmergencyFundResponse(BaseModel):
    household_id: uuid.UUID
    base_currency: str
    as_of: date
    liquid_total: Decimal
    average_monthly_expenses: Decimal
    # None when there is no recorded spending — an undefined runway, not an
    # infinite one.
    months_covered: Optional[Decimal] = None
    target_months: Decimal
    target_amount: Decimal
    shortfall: Decimal
    months_of_history: int
    on_track: bool


class TransferCreate(BaseModel):
    from_account_id: uuid.UUID
    to_account_id: uuid.UUID
    amount: PositiveDecimal
    date: datetime
    currency: Optional[str] = None
    description: Optional[str] = None


# ----------------------------------------
# 4. PORTFOLIO & ASSETS
# ----------------------------------------


class AssetBase(BaseModel):
    ticker: str
    name: str
    type: str
    currency: str
    # "market" = priced from yfinance; "manual" = priced from user-recorded
    # prices (unlisted bonds, Singapore Savings Bonds, ...).
    pricing_mode: Literal["market", "manual"] = "market"


class AssetCreate(AssetBase):
    id: uuid.UUID


class AssetUpdate(BaseModel):
    ticker: Optional[str] = None
    name: Optional[str] = None
    type: Optional[str] = None
    currency: Optional[str] = None
    pricing_mode: Optional[Literal["market", "manual"]] = None


class AssetResponse(AssetBase):
    id: uuid.UUID
    model_config = ConfigDict(from_attributes=True)


class ManualPriceCreate(BaseModel):
    """Record a price observation for a manually-priced asset."""
    household_id: uuid.UUID
    date: date
    price: Decimal = Field(gt=0)


class ManualPriceResponse(BaseModel):
    ticker: str
    date: date
    price: Decimal
    currency: str


class SubPortfolioBase(BaseModel):
    name: str
    risk_profile: str
    target_date: Optional[date] = None
    target_amount: Optional[Decimal] = None
    owner_user_id: Optional[uuid.UUID] = None


class SubPortfolioCreate(SubPortfolioBase):
    household_id: uuid.UUID


class SubPortfolioUpdate(BaseModel):
    name: Optional[str] = None
    risk_profile: Optional[str] = None
    target_date: Optional[date] = None
    target_amount: Optional[Decimal] = None
    owner_user_id: Optional[uuid.UUID] = None


class SubPortfolioResponse(SubPortfolioBase):
    id: uuid.UUID
    household_id: uuid.UUID
    model_config = ConfigDict(from_attributes=True)


class SubPortfolioCashCreate(BaseModel):
    """Deposit cash into (or withdraw it from) a sub-portfolio."""
    household_id: uuid.UUID
    account_id: uuid.UUID
    direction: Literal["deposit", "withdraw"]
    amount: PositiveDecimal
    currency: str
    date: datetime
    exchange_rate: PositiveFloat = 1.0  # Rate from cash currency to the funding account currency
    description: Optional[str] = None


class TradeBase(BaseModel):
    type: TradeType
    date: datetime
    quantity: PositiveFloat
    price: PositiveDecimal
    currency: Optional[str] = None
    exchange_rate: PositiveFloat
    description: Optional[str] = None


class TradeCreate(TradeBase):
    household_id: uuid.UUID
    sub_portfolio_id: uuid.UUID
    asset_id: uuid.UUID
    account_id: uuid.UUID
    # Settle against the sub-portfolio's own cash instead of debiting/crediting
    # a real funding-account transaction. Buys fail if cash is insufficient.
    settle_from_cash: bool = False


class TradeUpdate(BaseModel):
    type: Optional[TradeType] = None
    date: Optional[datetime] = None
    quantity: Optional[PositiveFloat] = None
    price: Optional[PositiveDecimal] = None
    currency: Optional[str] = None
    exchange_rate: Optional[PositiveFloat] = None
    description: Optional[str] = None
    # These are UUID foreign keys (they were mistakenly typed Optional[int],
    # which 422'd any attempt to reassign a trade's portfolio/asset/account).
    household_id: Optional[uuid.UUID] = None
    sub_portfolio_id: Optional[uuid.UUID] = None
    asset_id: Optional[uuid.UUID] = None
    account_id: Optional[uuid.UUID] = None


class TradeResponse(TradeBase):
    id: uuid.UUID
    household_id: uuid.UUID
    sub_portfolio_id: Optional[uuid.UUID] = None
    asset_id: Optional[uuid.UUID] = None
    account_id: Optional[uuid.UUID] = None
    transaction_id: Optional[uuid.UUID] = None
    settlement_trade_id: Optional[uuid.UUID] = None
    currency: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


class PortfolioSnapshotBase(BaseModel):
    date: date
    quantity: NonNegativeFloat
    price: NonNegativeDecimal
    exchange_rate_used: PositiveFloat
    # These mirror nullable DB columns; manual snapshots may omit them.
    current_value_home_currency: Optional[FiniteDecimal] = None
    average_cost_basis: Optional[FiniteDecimal] = None
    average_cost_basis_home_currency: Optional[FiniteDecimal] = None


class PortfolioSnapshotCreate(PortfolioSnapshotBase):
    household_id: uuid.UUID
    sub_portfolio_id: uuid.UUID
    asset_id: uuid.UUID


class PortfolioSnapshotUpdate(BaseModel):
    date: Optional[date] = None
    quantity: Optional[NonNegativeFloat] = None
    price: Optional[NonNegativeDecimal] = None
    exchange_rate_used: Optional[PositiveFloat] = None
    current_value_home_currency: Optional[FiniteDecimal] = None
    average_cost_basis: Optional[FiniteDecimal] = None
    household_id: Optional[int] = None
    sub_portfolio_id: Optional[int] = None
    asset_id: Optional[int] = None


class PortfolioSnapshotResponse(PortfolioSnapshotBase):
    id: uuid.UUID
    household_id: uuid.UUID
    sub_portfolio_id: uuid.UUID
    asset_id: uuid.UUID
    model_config = ConfigDict(from_attributes=True)


class PortfolioTimeseriesPoint(BaseModel):
    """
    One (date, sub_portfolio) total — the per-asset rows of PortfolioSnapshot summed
    server-side. Chart/projection consumers (net worth trend, goal pace) only ever need this
    granularity; see `get_household_portfolio_timeseries`.
    """
    date: date
    sub_portfolio_id: uuid.UUID
    total_value_home_currency: FiniteDecimal
    model_config = ConfigDict(from_attributes=True)


class DividendBase(BaseModel):
    date: datetime
    amount: PositiveDecimal
    exchange_rate: PositiveFloat
    per_share_amount: Optional[NonNegativeDecimal] = None
    quantity: Optional[NonNegativeFloat] = None
    amount_home_currency: Optional[FiniteDecimal] = None
    is_manual: Optional[bool] = None


class DividendCreate(DividendBase):
    household_id: uuid.UUID
    sub_portfolio_id: uuid.UUID
    asset_id: uuid.UUID
    account_id: uuid.UUID


class DividendUpdate(BaseModel):
    date: Optional[datetime] = None
    amount: Optional[PositiveDecimal] = None
    exchange_rate: Optional[PositiveFloat] = None
    household_id: Optional[int] = None
    sub_portfolio_id: Optional[int] = None
    asset_id: Optional[int] = None
    account_id: Optional[int] = None


class DividendResponse(DividendBase):
    id: uuid.UUID
    household_id: uuid.UUID
    sub_portfolio_id: uuid.UUID
    asset_id: uuid.UUID
    account_id: uuid.UUID
    cash_trade_id: Optional[uuid.UUID] = None
    model_config = ConfigDict(from_attributes=True)


class DividendSyncResponse(BaseModel):
    status: str
    count: int
    from_date: Optional[date] = None
    to_date: Optional[date] = None


class ScheduledDividendBase(BaseModel):
    date: date
    amount: Decimal = Field(gt=0)  # total payout in asset currency
    description: Optional[str] = None


class ScheduledDividendCreate(ScheduledDividendBase):
    household_id: uuid.UUID
    sub_portfolio_id: uuid.UUID
    asset_id: uuid.UUID
    account_id: uuid.UUID


class ScheduledDividendUpdate(BaseModel):
    date: Optional[date] = None
    amount: Optional[Decimal] = Field(default=None, gt=0)
    description: Optional[str] = None


class ScheduledDividendResponse(ScheduledDividendBase):
    id: uuid.UUID
    household_id: uuid.UUID
    sub_portfolio_id: uuid.UUID
    asset_id: uuid.UUID
    account_id: uuid.UUID
    dividend_id: Optional[uuid.UUID] = None
    materialized_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


class ExchangeRateBase(BaseModel):
    date: date
    base_currency: str
    target_currency: str
    rate: PositiveFloat


class ExchangeRateCreate(ExchangeRateBase):
    id: uuid.UUID


class ExchangeRateUpdate(BaseModel):
    date: Optional[date] = None
    base_currency: Optional[str] = None
    target_currency: Optional[str] = None
    rate: Optional[PositiveFloat] = None


class ExchangeRateResponse(ExchangeRateBase):
    id: uuid.UUID
    model_config = ConfigDict(from_attributes=True)


class TickerPriceResponse(BaseModel):
    ticker: str
    price: float
    date: date
    currency: str


class PerformanceMetrics(BaseModel):
    simple_return: float
    time_weighted_return: float
    money_weighted_return: float
    volatility: float
    sharpe_ratio: float
    sortino_ratio: float
    treynor_ratio: Optional[float] = None  # None when no benchmark data (beta unknown)
    alpha: Optional[float] = None  # Jensen's alpha vs benchmark; None when no benchmark data
    beta: Optional[float] = None
    dividend_income: float = 0.0  # Total dividends received in window (home currency)
    dividend_yield: float = 0.0  # dividend_income / current portfolio value


class SubPortfolioMetricsResponse(BaseModel):
    sub_portfolio_id: uuid.UUID
    name: str
    metrics: PerformanceMetrics


class PortfolioMetricsResponse(BaseModel):
    household_id: uuid.UUID
    overall_metrics: PerformanceMetrics
    sub_portfolio_metrics: List[SubPortfolioMetricsResponse]


# ----------------------------------------
# DATA EXPORT & REPORTS
# ----------------------------------------


class ReportAccountRow(BaseModel):
    id: uuid.UUID
    name: str
    kind: AccountKind
    currency: Optional[str] = None
    liquidity: Optional[LiquidityStatus] = None
    is_private: bool
    balance: Optional[Decimal] = None  # Native currency
    balance_home_currency: Optional[Decimal] = None
    balance_as_of: Optional[date] = None


class ReportHoldingRow(BaseModel):
    sub_portfolio: str
    ticker: str
    asset_name: Optional[str] = None
    asset_type: Optional[str] = None
    quantity: float
    price: Optional[Decimal] = None  # Asset currency
    currency: Optional[str] = None
    value_home_currency: Optional[Decimal] = None
    cost_basis_home_currency: Optional[Decimal] = None  # Total cost, not per share
    unrealized_gain_home_currency: Optional[Decimal] = None
    as_of: date


class ReportCategoryFlow(BaseModel):
    category: str
    type: TransactionType
    total_home_currency: Decimal
    transaction_count: int


class ReportGoalRow(BaseModel):
    id: uuid.UUID
    name: str
    is_private: bool
    target_amount: Optional[Decimal] = None
    target_date: Optional[date] = None
    current_value_home_currency: Decimal
    progress_percent: Optional[float] = None  # None when no target amount set


class HouseholdReportResponse(BaseModel):
    household_id: uuid.UUID
    household_name: Optional[str] = None
    base_currency: Optional[str] = None
    generated_at: datetime
    prepared_for: str
    period_start: date
    period_end: date
    # Net worth (home currency, from latest balance per account)
    total_assets: Decimal
    total_liabilities: Decimal
    net_worth: Decimal
    accounts: List[ReportAccountRow]
    # Portfolio (latest snapshot per sub-portfolio/asset)
    portfolio_value: Decimal
    portfolio_cost_basis: Decimal
    portfolio_unrealized_gain: Decimal
    holdings: List[ReportHoldingRow]
    # Cash flow within [period_start, period_end]
    income_total: Decimal
    expense_total: Decimal
    net_cashflow: Decimal
    cashflow_by_category: List[ReportCategoryFlow]
    # Dividends (home currency)
    dividends_period_total: Decimal
    dividends_all_time_total: Decimal
    # Goals
    goals: List[ReportGoalRow]
