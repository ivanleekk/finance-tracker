# src/schemas.py

from pydantic import BaseModel, ConfigDict, EmailStr, Field
from typing import List, Optional
from datetime import date, datetime
from decimal import Decimal
import uuid

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
    id: uuid.UUID
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
    id: uuid.UUID
    model_config = ConfigDict(from_attributes=True)


class HouseholdMemberBase(BaseModel):
    user_id: uuid.UUID
    household_id: uuid.UUID
    role: HouseholdRoleType


class HouseholdMemberCreate(HouseholdMemberBase):
    id: uuid.UUID


class HouseholdMemberUpdate(BaseModel):
    role: Optional[HouseholdRoleType] = None


class HouseholdMemberResponse(HouseholdMemberBase):
    id: uuid.UUID
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
    household_id: uuid.UUID


class AccountUpdate(BaseModel):
    name: Optional[str] = None
    liquidity: Optional[LiquidityStatus] = None
    tax_status: Optional[TaxTreatment] = None
    currency: Optional[str] = None


class AccountResponse(AccountBase):
    id: uuid.UUID
    household_id: uuid.UUID
    model_config = ConfigDict(from_attributes=True)


class BalanceBase(BaseModel):
    date: date
    balance: Decimal


class BalanceCreate(BalanceBase):
    account_id: uuid.UUID


class BalanceUpdate(BaseModel):
    date: Optional[date] = None
    balance: Optional[Decimal] = None


class BalanceResponse(BalanceBase):
    id: uuid.UUID
    account_id: uuid.UUID
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
    description: Optional[str] = None


class TransactionCreate(TransactionBase):
    account_id: uuid.UUID
    category_id: uuid.UUID


class TransactionUpdate(BaseModel):
    date: Optional[datetime] = None
    amount: Optional[Decimal] = None
    description: Optional[str] = None
    account_id: Optional[int] = None
    category_id: Optional[int] = None


class TransactionResponse(TransactionBase):
    id: uuid.UUID
    account_id: uuid.UUID
    category_id: uuid.UUID
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
    id: uuid.UUID


class AssetUpdate(BaseModel):
    ticker: Optional[str] = None
    name: Optional[str] = None
    type: Optional[str] = None
    currency: Optional[str] = None


class AssetResponse(AssetBase):
    id: uuid.UUID
    model_config = ConfigDict(from_attributes=True)


class SubPortfolioBase(BaseModel):
    name: str
    risk_profile: str
    target_date: Optional[date] = None


class SubPortfolioCreate(SubPortfolioBase):
    household_id: uuid.UUID


class SubPortfolioResponse(SubPortfolioBase):
    id: uuid.UUID
    household_id: uuid.UUID
    model_config = ConfigDict(from_attributes=True)


class TradeBase(BaseModel):
    type: TradeType
    date: datetime
    quantity: float
    price: Decimal
    exchange_rate: float


class TradeCreate(TradeBase):
    household_id: uuid.UUID
    sub_portfolio_id: uuid.UUID
    asset_id: uuid.UUID
    account_id: uuid.UUID


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
    id: uuid.UUID
    household_id: uuid.UUID
    sub_portfolio_id: uuid.UUID
    asset_id: uuid.UUID
    account_id: uuid.UUID
    model_config = ConfigDict(from_attributes=True)


class PortfolioSnapshotBase(BaseModel):
    date: date
    quantity: float
    price: Decimal
    exchange_rate_used: float
    current_value_home_currency: Decimal
    averge_cost_basis: Decimal


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
    averge_cost_basis: Optional[Decimal] = None
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
