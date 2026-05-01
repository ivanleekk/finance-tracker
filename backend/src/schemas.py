# src/schemas.py

from pydantic import BaseModel, ConfigDict, EmailStr, Field
from typing import List, Optional
from datetime import date, datetime
from decimal import Decimal

# Import our enums from models so Pydantic can validate them
from src.models import LiquidityStatus, TaxTreatment

# ----------------------------------------
# 1. USERS & HOUSEHOLDS
# ----------------------------------------


class UserBase(BaseModel):
    email: EmailStr
    preferred_timezone: str = "UTC"


class UserCreate(UserBase):
    password: str  # We accept this on creation...


class UserResponse(UserBase):
    id: int
    # Notice we do NOT include the password here!
    # This prevents it from ever being sent to the frontend.
    model_config = ConfigDict(from_attributes=True)


class HouseholdBase(BaseModel):
    name: str
    base_currency: str
    country_code: str


class HouseholdCreate(HouseholdBase):
    pass


class HouseholdResponse(HouseholdBase):
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


class AccountResponse(AccountBase):
    id: int
    household_id: int
    model_config = ConfigDict(from_attributes=True)


class BalanceBase(BaseModel):
    date: date
    balance: Decimal


class BalanceCreate(BalanceBase):
    account_id: int


class BalanceResponse(BalanceBase):
    id: int
    account_id: int
    model_config = ConfigDict(from_attributes=True)


# ----------------------------------------
# 3. CASH FLOW (CATEGORIES & TRANSACTIONS)
# ----------------------------------------


class CategoryBase(BaseModel):
    name: str
    type: str  # 'INCOME' or 'EXPENSE'


class CategoryCreate(CategoryBase):
    household_id: int


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
    pass


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
    type: str  # 'BUY' or 'SELL'
    date: datetime
    quantity: float
    price: Decimal
    exchange_rate: float


class TradeCreate(TradeBase):
    household_id: int
    sub_portfolio_id: int
    asset_id: int
    account_id: int


class TradeResponse(TradeBase):
    id: int
    household_id: int
    sub_portfolio_id: int
    asset_id: int
    account_id: int
    model_config = ConfigDict(from_attributes=True)
