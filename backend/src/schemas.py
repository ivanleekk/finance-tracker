# src/schemas.py

from pydantic import BaseModel, ConfigDict, EmailStr, Field
from typing import List, Optional
from datetime import date, datetime
from decimal import Decimal

# Import our enums from models so Pydantic can validate them
from src.models import (
    LiquidityStatus,
    TaxTreatment,
    TransactionType,
    HouseholdRoleType,
    TradeType,
)

# ----------------------------------------
# 1. USERS & HOUSEHOLDS
# ----------------------------------------


class UserBase(BaseModel):
    email: EmailStr
    preferred_timezone: str = "UTC"
    name: str


class UserCreate(UserBase):
    password: str


class UserUpdate(BaseModel):
    preferred_timezone: Optional[str] = None
    name: Optional[str] = None
    password: Optional[str] = None


class UserResponse(UserBase):
    id: int
    model_config = ConfigDict(from_attributes=True)


class HouseholdBase(BaseModel):
    name: str
    base_currency: str
    country_code: str


class HouseholdCreate(HouseholdBase):
    pass


class HouseholdUpdate(BaseModel):
    name: Optional[str] = None
    base_currency: Optional[str] = None
    country_code: Optional[str] = None


class HouseholdResponse(HouseholdBase):
    id: int
    model_config = ConfigDict(from_attributes=True)


class HouseholdMemberBase(BaseModel):
    user_id: int
    household_id: int
    role: HouseholdRoleType


class HouseholdMemberCreate(HouseholdMemberBase):
    id: int


class HouseholdMemberUpdate(BaseModel):
    role: Optional[HouseholdRoleType] = None


class HouseholdMemberResponse(HouseholdMemberBase):
    id: int
    model_config = ConfigDict(from_attributes=True)


# ----------------------------------------
# 2. FINANCIAL ACCOUNTS & BALANCES
# ----------------------------------------


class AccountBase(BaseModel):
    name: str
    liquidity: LiquidityStatus
    tax_status: TaxTreatment
    currency: str


class AccountCreate(AccountBase):
    household_id: int


class AccountUpdate(BaseModel):
    name: Optional[str] = None
    liquidity: Optional[LiquidityStatus] = None
    tax_status: Optional[TaxTreatment] = None
    currency: Optional[str] = None


class AccountResponse(AccountBase):
    id: int
    household_id: int
    model_config = ConfigDict(from_attributes=True)


class BalanceBase(BaseModel):
    date: date
    balance: Decimal


class BalanceCreate(BalanceBase):
    account_id: int


class BalanceUpdate(BaseModel):
    date: Optional[date] = None
    balance: Optional[Decimal] = None


class BalanceResponse(BalanceBase):
    id: int
    account_id: int
    model_config = ConfigDict(from_attributes=True)


class AccountAccessBase(BaseModel):
    account_id: int
    user_id: int
    role: str


class AccountAccessCreate(AccountAccessBase):
    id: int


class AccountAccessUpdate(BaseModel):
    role: Optional[str] = None


class AccountAccessResponse(AccountAccessBase):
    id: int
    model_config = ConfigDict(from_attributes=True)


class PortfolioAccessBase(BaseModel):
    sub_portfolio_id: int
    user_id: int
    role: str


class PortfolioAccessCreate(PortfolioAccessBase):
    id: int


class PortfolioAccessUpdate(BaseModel):
    role: Optional[str] = None


class PortfolioAccessResponse(PortfolioAccessBase):
    id: int
    model_config = ConfigDict(from_attributes=True)


# ----------------------------------------
# 3. CASH FLOW (CATEGORIES & TRANSACTIONS)
# ----------------------------------------


class CategoryBase(BaseModel):
    name: str
    type: TransactionType


class CategoryCreate(CategoryBase):
    household_id: int


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[TransactionType] = None


class CategoryResponse(CategoryBase):
    id: int
    household_id: int
    model_config = ConfigDict(from_attributes=True)


class TransactionBase(BaseModel):
    date: datetime
    amount: Decimal
    description: Optional[str] = None


class TransactionCreate(TransactionBase):
    account_id: int
    category_id: int


class TransactionUpdate(BaseModel):
    date: Optional[datetime] = None
    amount: Optional[Decimal] = None
    description: Optional[str] = None
    account_id: Optional[int] = None
    category_id: Optional[int] = None


class TransactionResponse(TransactionBase):
    id: int
    account_id: int
    category_id: int
    model_config = ConfigDict(from_attributes=True)


# ----------------------------------------
# 4. PORTFOLIO & ASSETS
# ----------------------------------------


class AssetBase(BaseModel):
    ticker: str
    name: str
    type: str
    currency: str


class AssetCreate(AssetBase):
    id: int


class AssetUpdate(BaseModel):
    ticker: Optional[str] = None
    name: Optional[str] = None
    type: Optional[str] = None
    currency: Optional[str] = None


class AssetResponse(AssetBase):
    id: int
    model_config = ConfigDict(from_attributes=True)


class SubPortfolioBase(BaseModel):
    name: str
    risk_profile: str
    target_date: Optional[date] = None


class SubPortfolioCreate(SubPortfolioBase):
    household_id: int


class SubPortfolioResponse(SubPortfolioBase):
    id: int
    household_id: int
    model_config = ConfigDict(from_attributes=True)


class TradeBase(BaseModel):
    type: TradeType
    date: datetime
    quantity: float
    price: Decimal
    exchange_rate: float


class TradeCreate(TradeBase):
    household_id: int
    sub_portfolio_id: int
    asset_id: int
    account_id: int


class TradeUpdate(BaseModel):
    type: Optional[TradeType] = None
    date: Optional[datetime] = None
    quantity: Optional[float] = None
    price: Optional[Decimal] = None
    exchange_rate: Optional[float] = None
    household_id: Optional[int] = None
    sub_portfolio_id: Optional[int] = None
    asset_id: Optional[int] = None
    account_id: Optional[int] = None


class TradeResponse(TradeBase):
    id: int
    household_id: int
    sub_portfolio_id: int
    asset_id: int
    account_id: int
    model_config = ConfigDict(from_attributes=True)


class PortfolioSnapshotBase(BaseModel):
    date: date
    quantity: float
    price: Decimal
    exchange_rate_used: float
    current_value_home_currency: Decimal
    averge_cost_basis: Decimal


class PortfolioSnapshotCreate(PortfolioSnapshotBase):
    household_id: int
    sub_portfolio_id: int
    asset_id: int


class PortfolioSnapshotUpdate(BaseModel):
    date: Optional[date] = None
    quantity: Optional[float] = None
    price: Optional[Decimal] = None
    exchange_rate_used: Optional[float] = None
    current_value_home_currency: Optional[Decimal] = None
    averge_cost_basis: Optional[Decimal] = None
    household_id: Optional[int] = None
    sub_portfolio_id: Optional[int] = None
    asset_id: Optional[int] = None


class PortfolioSnapshotResponse(PortfolioSnapshotBase):
    id: int
    household_id: int
    sub_portfolio_id: int
    asset_id: int
    model_config = ConfigDict(from_attributes=True)


class DividendBase(BaseModel):
    date: datetime
    amount: Decimal
    exchange_rate: float


class DividendCreate(DividendBase):
    household_id: int
    sub_portfolio_id: int
    asset_id: int
    account_id: int


class DividendUpdate(BaseModel):
    date: Optional[datetime] = None
    amount: Optional[Decimal] = None
    exchange_rate: Optional[float] = None
    household_id: Optional[int] = None
    sub_portfolio_id: Optional[int] = None
    asset_id: Optional[int] = None
    account_id: Optional[int] = None


class DividendResponse(DividendBase):
    id: int
    household_id: int
    sub_portfolio_id: int
    asset_id: int
    account_id: int
    model_config = ConfigDict(from_attributes=True)


class ExchangeRateBase(BaseModel):
    date: date
    base_currency: str
    target_currency: str
    rate: float


class ExchangeRateCreate(ExchangeRateBase):
    id: int


class ExchangeRateUpdate(BaseModel):
    date: Optional[date] = None
    base_currency: Optional[str] = None
    target_currency: Optional[str] = None
    rate: Optional[float] = None


class ExchangeRateResponse(ExchangeRateBase):
    id: int
    model_config = ConfigDict(from_attributes=True)
