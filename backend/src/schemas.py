# src/schemas.py

from pydantic import BaseModel, ConfigDict, EmailStr, Field
from typing import List, Literal, Optional
from datetime import date, datetime
from decimal import Decimal
import uuid

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


class UserCreate(UserBase):
    password: str


class UserUpdate(BaseModel):
    preferred_timezone: Optional[str] = None
    name: Optional[str] = None
    password: Optional[str] = None
    email: Optional[EmailStr] = None
    theme_mode: Optional[ThemeMode] = None
    primary_color: Optional[str] = None
    secondary_color: Optional[str] = None
    base_color: Optional[str] = None
    hide_private_from_household: Optional[bool] = None
    require_face_id_for_vault: Optional[bool] = None
    default_new_items_private: Optional[bool] = None


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


class HouseholdCreate(HouseholdBase):
    pass


class HouseholdUpdate(BaseModel):
    name: Optional[str] = None
    base_currency: Optional[str] = None
    country_code: Optional[str] = None
    default_funding_account_id: Optional[uuid.UUID] = None
    default_sub_portfolio_id: Optional[uuid.UUID] = None
    default_split_mode: Optional[SplitMode] = None


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
    share_percent: Decimal


class HouseholdSplitShareResponse(BaseModel):
    id: uuid.UUID
    household_id: uuid.UUID
    user_id: uuid.UUID
    share_percent: Decimal
    model_config = ConfigDict(from_attributes=True)


# ----------------------------------------
# 2. FINANCIAL ACCOUNTS & BALANCES
# ----------------------------------------


class AccountBase(BaseModel):
    name: str
    liquidity: LiquidityStatus
    tax_status: TaxTreatment
    kind: AccountKind = AccountKind.asset
    currency: str
    owner_user_id: Optional[uuid.UUID] = None


class AccountCreate(AccountBase):
    household_id: uuid.UUID


class AccountUpdate(BaseModel):
    name: Optional[str] = None
    liquidity: Optional[LiquidityStatus] = None
    tax_status: Optional[TaxTreatment] = None
    kind: Optional[AccountKind] = None
    currency: Optional[str] = None
    owner_user_id: Optional[uuid.UUID] = None


class AccountResponse(AccountBase):
    id: uuid.UUID
    household_id: uuid.UUID
    model_config = ConfigDict(from_attributes=True)


class BalanceBase(BaseModel):
    date: date
    balance: Decimal
    is_manual: bool = True


class BalanceCreate(BalanceBase):
    account_id: uuid.UUID


class BalanceUpdate(BaseModel):
    date: Optional[date] = None
    balance: Optional[Decimal] = None
    balance_home_currency: Optional[Decimal] = None


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
    amount: Decimal
    amount_home_currency: Optional[Decimal] = None
    currency: Optional[str] = None
    exchange_rate: Optional[float] = None
    description: Optional[str] = None


class TransactionCreate(TransactionBase):
    account_id: uuid.UUID
    category_id: uuid.UUID


class TransactionUpdate(BaseModel):
    date: Optional[datetime] = None
    amount: Optional[Decimal] = None
    amount_home_currency: Optional[Decimal] = None
    currency: Optional[str] = None
    exchange_rate: Optional[float] = None
    description: Optional[str] = None
    account_id: Optional[int] = None
    category_id: Optional[int] = None


class TransactionResponse(TransactionBase):
    id: uuid.UUID
    account_id: uuid.UUID
    category_id: uuid.UUID
    currency: Optional[str] = None
    exchange_rate: Optional[float] = None
    transaction_type: TransactionType
    transfer_id: Optional[uuid.UUID] = None
    model_config = ConfigDict(from_attributes=True)


class TransferCreate(BaseModel):
    from_account_id: uuid.UUID
    to_account_id: uuid.UUID
    amount: Decimal
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
    amount: Decimal = Field(gt=0)
    currency: str
    date: datetime
    exchange_rate: float = 1.0  # Rate from cash currency to the funding account currency
    description: Optional[str] = None


class TradeBase(BaseModel):
    type: TradeType
    date: datetime
    quantity: float
    price: Decimal
    currency: Optional[str] = None
    exchange_rate: float
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
    quantity: Optional[float] = None
    price: Optional[Decimal] = None
    currency: Optional[str] = None
    exchange_rate: Optional[float] = None
    description: Optional[str] = None
    household_id: Optional[int] = None
    sub_portfolio_id: Optional[int] = None
    asset_id: Optional[int] = None
    account_id: Optional[int] = None


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
    quantity: float
    price: Decimal
    exchange_rate_used: float
    # These mirror nullable DB columns; manual snapshots may omit them.
    current_value_home_currency: Optional[Decimal] = None
    average_cost_basis: Optional[Decimal] = None
    average_cost_basis_home_currency: Optional[Decimal] = None


class PortfolioSnapshotCreate(PortfolioSnapshotBase):
    household_id: uuid.UUID
    sub_portfolio_id: uuid.UUID
    asset_id: uuid.UUID


class PortfolioSnapshotUpdate(BaseModel):
    date: Optional[date] = None
    quantity: Optional[float] = None
    price: Optional[Decimal] = None
    exchange_rate_used: Optional[float] = None
    current_value_home_currency: Optional[Decimal] = None
    average_cost_basis: Optional[Decimal] = None
    household_id: Optional[int] = None
    sub_portfolio_id: Optional[int] = None
    asset_id: Optional[int] = None


class PortfolioSnapshotResponse(PortfolioSnapshotBase):
    id: uuid.UUID
    household_id: uuid.UUID
    sub_portfolio_id: uuid.UUID
    asset_id: uuid.UUID
    model_config = ConfigDict(from_attributes=True)


class DividendBase(BaseModel):
    date: datetime
    amount: Decimal
    exchange_rate: float
    per_share_amount: Optional[Decimal] = None
    quantity: Optional[float] = None
    amount_home_currency: Optional[Decimal] = None
    is_manual: Optional[bool] = None


class DividendCreate(DividendBase):
    household_id: uuid.UUID
    sub_portfolio_id: uuid.UUID
    asset_id: uuid.UUID
    account_id: uuid.UUID


class DividendUpdate(BaseModel):
    date: Optional[datetime] = None
    amount: Optional[Decimal] = None
    exchange_rate: Optional[float] = None
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
    rate: float


class ExchangeRateCreate(ExchangeRateBase):
    id: uuid.UUID


class ExchangeRateUpdate(BaseModel):
    date: Optional[date] = None
    base_currency: Optional[str] = None
    target_currency: Optional[str] = None
    rate: Optional[float] = None


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
