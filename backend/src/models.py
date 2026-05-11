import enum
import uuid
from sqlalchemy import (
    Column,
    Integer,
    String,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Enum,
    Numeric,
    UUID,
    UniqueConstraint,
    Boolean,
    func
)
from sqlalchemy.orm import relationship, Mapped, mapped_column
from src.database import Base


# --- ENUMS ---
class LiquidityStatus(enum.Enum):
    liquid = "liquid"
    market_liquid = "market_liquid"
    time_locked = "time_locked"
    retirement = "retirement"


class TaxTreatment(enum.Enum):
    taxable = "taxable"
    tax_deferred = "tax_deferred"
    tax_free = "tax_free"


class TransactionType(enum.Enum):
    income = "income"
    expense = "expense"


class HouseholdRoleType(enum.Enum):
    owner = "owner"
    editor = "editor"
    viewer = "viewer"

class AccountRoleType(enum.Enum):
    owner = "owner"
    editor = "editor"
    viewer = "viewer"

class TradeType(enum.Enum):
    buy = "buy"
    sell = "sell"


class ThemeMode(enum.Enum):
    light = "light"
    dark = "dark"
    system = "system"


# --- 1. ACCESS & TENANCY ---


class User(Base):
    __tablename__ = "users"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, index=True, default=uuid.uuid7)
    email: Mapped[str] = mapped_column(String, unique=True, index=True)
    preferred_timezone: Mapped[str] = mapped_column(String, default="UTC")
    salted_hashed_password: Mapped[str] = mapped_column(String)
    name: Mapped[str] = mapped_column(String)
    salt: Mapped[str] = mapped_column(String)
    theme_mode: Mapped[ThemeMode] = mapped_column(Enum(ThemeMode, native_enum=False), default=ThemeMode.system)
    primary_color: Mapped[str] = mapped_column(String, default="sky")
    secondary_color: Mapped[str] = mapped_column(String, default="fuchsia")
    base_color: Mapped[str] = mapped_column(String, default="mauve")

    # Relationships
    household_memberships = relationship("HouseholdMember", back_populates="user")
    account_accesses = relationship("AccountAccess", back_populates="user")
    portfolio_accesses = relationship("PortfolioAccess", back_populates="user")


class Household(Base):
    __tablename__ = "households"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, index=True, default=uuid.uuid7)
    name = Column(String)
    base_currency = Column(String)
    country_code = Column(String)
    owner_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    default_funding_account_id = Column(UUID(as_uuid=True), ForeignKey("financial_accounts.id"), nullable=True)
    default_sub_portfolio_id = Column(UUID(as_uuid=True), ForeignKey("sub_portfolios.id"), nullable=True)


    # Relationships
    members = relationship("HouseholdMember", back_populates="household", cascade="all, delete-orphan")
    accounts = relationship("FinancialAccount", back_populates="household", cascade="all, delete-orphan", foreign_keys="[FinancialAccount.household_id]")
    categories = relationship("Category", back_populates="household", cascade="all, delete-orphan")
    sub_portfolios = relationship("SubPortfolio", back_populates="household", cascade="all, delete-orphan", foreign_keys="[SubPortfolio.household_id]")
    trades = relationship("Trade", back_populates="household", cascade="all, delete-orphan")
    dividends = relationship("Dividend", back_populates="household", cascade="all, delete-orphan")
    portfolio_snapshots = relationship("PortfolioSnapshot", back_populates="household", cascade="all, delete-orphan")
    
    # Defaults
    default_funding_account = relationship("FinancialAccount", foreign_keys=[default_funding_account_id])
    default_sub_portfolio = relationship("SubPortfolio", foreign_keys=[default_sub_portfolio_id])



class HouseholdMember(Base):
    __tablename__ = "household_members"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, index=True, default=uuid.uuid7)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    household_id = Column(UUID(as_uuid=True), ForeignKey("households.id"))
    role = Column(Enum(HouseholdRoleType, name="household_role_type", schema="finance_tracker"))

    user = relationship("User", back_populates="household_memberships")
    household = relationship("Household", back_populates="members")


# --- ACCESS CONTROL MAPPING ---


class AccountAccess(Base):
    __tablename__ = "account_access"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, index=True, default=uuid.uuid7)
    account_id = Column(UUID(as_uuid=True), ForeignKey("financial_accounts.id"))
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    role = Column(Enum(AccountRoleType, name="account_role_type", schema="finance_tracker"))

    account = relationship("FinancialAccount", back_populates="access_controls")
    user = relationship("User", back_populates="account_accesses")


class PortfolioAccess(Base):
    __tablename__ = "portfolio_access"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, index=True, default=uuid.uuid7)
    sub_portfolio_id = Column(UUID(as_uuid=True), ForeignKey("sub_portfolios.id"))
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    role = Column(String)

    sub_portfolio = relationship("SubPortfolio", back_populates="access_controls")
    user = relationship("User", back_populates="portfolio_accesses")


# --- 2. UNIVERSAL ACCOUNTS & CASH BALANCES ---


class FinancialAccount(Base):
    __tablename__ = "financial_accounts"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, index=True, default=uuid.uuid7)
    household_id = Column(UUID(as_uuid=True), ForeignKey("households.id"))
    name = Column(String)
    liquidity = Column(Enum(LiquidityStatus, name="liquidity_status", schema="finance_tracker"))
    tax_status = Column(Enum(TaxTreatment, name="tax_treatment", schema="finance_tracker"))
    currency = Column(String)

    household = relationship("Household", back_populates="accounts", foreign_keys=[household_id])
    access_controls = relationship("AccountAccess", back_populates="account")
    balances = relationship("AccountBalance", back_populates="account")
    transactions = relationship("Transaction", back_populates="account")
    trades = relationship("Trade", back_populates="account")
    dividends = relationship("Dividend", back_populates="account")


class AccountBalance(Base):
    __tablename__ = "account_balances"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, index=True, default=uuid.uuid7)
    account_id = Column(UUID(as_uuid=True), ForeignKey("financial_accounts.id"))
    date = Column(Date)
    balance = Column(Numeric)
    balance_home_currency = Column(Numeric, nullable=True)
    is_manual = Column(Boolean, default=True)

    account = relationship("FinancialAccount", back_populates="balances")


# --- 3. CASH FLOW (INCOME & EXPENSES) ---


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, index=True, default=uuid.uuid7)
    household_id = Column(UUID(as_uuid=True), ForeignKey("households.id"))
    name = Column(String)
    type = Column(String)

    household = relationship("Household", back_populates="categories")
    transactions = relationship("Transaction", back_populates="category")


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, index=True, default=uuid.uuid7)
    account_id = Column(UUID(as_uuid=True), ForeignKey("financial_accounts.id"))
    category_id = Column(UUID(as_uuid=True), ForeignKey("categories.id"))
    date = Column(DateTime(timezone=True))
    amount = Column(Numeric)
    description = Column(String)
    transaction_type = Column(Enum(TransactionType, name="transaction_type", schema="finance_tracker"))
    currency = Column(String, nullable=True) # If null, assume account currency
    exchange_rate = Column(Float, nullable=True) # Rate from currency to account currency
    transfer_id = Column(UUID(as_uuid=True), nullable=True, index=True)

    account = relationship("FinancialAccount", back_populates="transactions")
    category = relationship("Category", back_populates="transactions")


# --- 4. ASSETS, TRADES & PORTFOLIO ---


class Asset(Base):
    __tablename__ = "assets"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, index=True, default=uuid.uuid7)
    ticker = Column(String, index=True)
    name = Column(String)
    type = Column(String)
    currency = Column(String)

    trades = relationship("Trade", back_populates="asset")
    dividends = relationship("Dividend", back_populates="asset")
    portfolio_snapshots = relationship("PortfolioSnapshot", back_populates="asset")


class ExchangeRate(Base):
    __tablename__ = "exchange_rates"
    __table_args__ = (UniqueConstraint('base_currency', 'target_currency', 'date', name='uq_exchange_rate_base_target_date'),)

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, index=True, default=uuid.uuid7)
    base_currency = Column(String)
    target_currency = Column(String)
    date = Column(Date)
    rate = Column(Float)

class MarketPrice(Base):
    __tablename__ = "market_prices"
    __table_args__ = (UniqueConstraint('ticker', 'date', name='uq_market_price_ticker_date'),)

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, index=True, default=uuid.uuid7)
    ticker = Column(String, index=True)
    date = Column(Date, index=True)
    close_price = Column(Numeric)
    currency = Column(String)

class SubPortfolio(Base):
    __tablename__ = "sub_portfolios"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, index=True, default=uuid.uuid7)
    household_id = Column(UUID(as_uuid=True), ForeignKey("households.id"))
    name = Column(String)
    risk_profile = Column(String)
    target_date = Column(Date, nullable=True)
    target_amount = Column(Numeric, nullable=True)

    household = relationship("Household", back_populates="sub_portfolios", foreign_keys=[household_id])
    access_controls = relationship("PortfolioAccess", back_populates="sub_portfolio")
    trades = relationship("Trade", back_populates="sub_portfolio")
    portfolio_snapshots = relationship(
        "PortfolioSnapshot", back_populates="sub_portfolio"
    )
    dividends = relationship("Dividend", back_populates="sub_portfolio")


class Trade(Base):
    __tablename__ = "trades"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, index=True, default=uuid.uuid7)
    household_id = Column(UUID(as_uuid=True), ForeignKey("households.id"))
    sub_portfolio_id = Column(UUID(as_uuid=True), ForeignKey("sub_portfolios.id"))
    asset_id = Column(UUID(as_uuid=True), ForeignKey("assets.id"))
    account_id = Column(UUID(as_uuid=True), ForeignKey("financial_accounts.id"))
    transaction_id = Column(UUID(as_uuid=True), ForeignKey("transactions.id"), nullable=True)
    trade_type = Column(Enum(TradeType, name="trade_type", schema="finance_tracker"))
    date = Column(DateTime(timezone=True))
    quantity = Column(Float)
    price = Column(Numeric)
    currency = Column(String, nullable=True) # If null, assume asset currency
    exchange_rate = Column(Float)
    description = Column(String, nullable=True)


    household = relationship("Household", back_populates="trades")
    sub_portfolio = relationship("SubPortfolio", back_populates="trades")
    asset = relationship("Asset", back_populates="trades")
    account = relationship("FinancialAccount", back_populates="trades")
    transaction = relationship("Transaction")


class PortfolioSnapshot(Base):
    __tablename__ = "portfolio_snapshots"
    __table_args__ = (
        UniqueConstraint('sub_portfolio_id', 'asset_id', 'date', name='uq_portfolio_snapshot_sub_portfolio_asset_date'),
    )

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, index=True, default=uuid.uuid7)
    household_id = Column(UUID(as_uuid=True), ForeignKey("households.id"))
    sub_portfolio_id = Column(UUID(as_uuid=True), ForeignKey("sub_portfolios.id"))
    asset_id = Column(UUID(as_uuid=True), ForeignKey("assets.id"))
    date = Column(Date)
    quantity = Column(Float)
    current_price = Column(Numeric)
    exchange_rate_used = Column(Float)
    current_value_home_currency = Column(Numeric, nullable=True)
    average_cost_basis = Column(Numeric, nullable=True) # Price in asset currency
    average_cost_basis_home_currency = Column(Numeric, nullable=True) # Converted price
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    household = relationship("Household", back_populates="portfolio_snapshots")
    sub_portfolio = relationship("SubPortfolio", back_populates="portfolio_snapshots")
    asset = relationship("Asset", back_populates="portfolio_snapshots")


class Dividend(Base):
    __tablename__ = "dividends"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, index=True, default=uuid.uuid7)
    household_id = Column(UUID(as_uuid=True), ForeignKey("households.id"))
    sub_portfolio_id = Column(UUID(as_uuid=True), ForeignKey("sub_portfolios.id"))
    asset_id = Column(UUID(as_uuid=True), ForeignKey("assets.id"))
    account_id = Column(UUID(as_uuid=True), ForeignKey("financial_accounts.id"))
    date = Column(DateTime(timezone=True))
    amount = Column(Numeric)
    exchange_rate = Column(Float)

    household = relationship("Household", back_populates="dividends")
    sub_portfolio = relationship("SubPortfolio", back_populates="dividends")
    asset = relationship("Asset", back_populates="dividends")
    account = relationship("FinancialAccount", back_populates="dividends")
