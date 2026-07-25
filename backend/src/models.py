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
    # Physical / non-tradeable assets: property, vehicles, jewellery. They count
    # towards net worth but never towards "liquid now", and they are valued from
    # manual valuations (optionally grown by `appreciation_rate_annual`) rather
    # than from a market feed.
    illiquid = "illiquid"


class TaxTreatment(enum.Enum):
    taxable = "taxable"
    tax_deferred = "tax_deferred"
    tax_free = "tax_free"


class AccountKind(enum.Enum):
    asset = "asset"
    liability = "liability"


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


class HouseholdInviteStatus(enum.Enum):
    pending = "pending"
    accepted = "accepted"
    revoked = "revoked"


class SplitMode(enum.Enum):
    even = "even"
    by_income = "by_income"
    custom = "custom"


# Categories the app creates on the user's behalf, not categories a user chose.
# They record bookkeeping rather than discretionary spending, so the
# emergency-fund burn rate skips them: if your income stopped you would stop
# buying shares, and a balance reconciliation was never a purchase. Budgets are
# per-category and deliberately still count them — budgeting "Investment" to cap
# how much you put in the market each month is a legitimate thing to want.
SYSTEM_CATEGORY_INVESTMENT = "Investment"
SYSTEM_CATEGORY_BALANCE_ADJUSTMENT = "Balance Adjustment"
SYSTEM_CATEGORY_TRANSFER = "Transfer"
SYSTEM_CATEGORY_NAMES = frozenset(
    {SYSTEM_CATEGORY_INVESTMENT, SYSTEM_CATEGORY_BALANCE_ADJUSTMENT, SYSTEM_CATEGORY_TRANSFER}
)


class RecurrenceFrequency(enum.Enum):
    weekly = "weekly"
    biweekly = "biweekly"
    monthly = "monthly"
    quarterly = "quarterly"
    yearly = "yearly"


class BudgetPeriod(enum.Enum):
    monthly = "monthly"
    yearly = "yearly"


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
    hide_private_from_household: Mapped[bool] = mapped_column(Boolean, default=True)
    require_face_id_for_vault: Mapped[bool] = mapped_column(Boolean, default=True)
    default_new_items_private: Mapped[bool] = mapped_column(Boolean, default=True)

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
    default_split_mode = Column(Enum(SplitMode, name="split_mode", schema="finance_tracker"), default=SplitMode.even)
    # How many months of expenses the household wants held in liquid cash.
    # Drives the emergency-fund runway readout; 6 is the conventional advice.
    emergency_fund_target_months = Column(Numeric, nullable=False, default=6, server_default="6")


    # Relationships
    members = relationship("HouseholdMember", back_populates="household", cascade="all, delete-orphan")
    accounts = relationship("FinancialAccount", back_populates="household", cascade="all, delete-orphan", foreign_keys="[FinancialAccount.household_id]")
    categories = relationship("Category", back_populates="household", cascade="all, delete-orphan")
    sub_portfolios = relationship("SubPortfolio", back_populates="household", cascade="all, delete-orphan", foreign_keys="[SubPortfolio.household_id]")
    trades = relationship("Trade", back_populates="household", cascade="all, delete-orphan")
    dividends = relationship("Dividend", back_populates="household", cascade="all, delete-orphan")
    scheduled_dividends = relationship("ScheduledDividend", back_populates="household", cascade="all, delete-orphan")
    portfolio_snapshots = relationship("PortfolioSnapshot", back_populates="household", cascade="all, delete-orphan")
    invites = relationship("HouseholdInvite", back_populates="household", cascade="all, delete-orphan")
    split_shares = relationship("HouseholdSplitShare", back_populates="household", cascade="all, delete-orphan")
    recurring_transactions = relationship("RecurringTransaction", back_populates="household", cascade="all, delete-orphan")
    budgets = relationship("Budget", back_populates="household", cascade="all, delete-orphan")

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


class HouseholdInvite(Base):
    __tablename__ = "household_invites"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, index=True, default=uuid.uuid7)
    household_id = Column(UUID(as_uuid=True), ForeignKey("households.id"))
    email: Mapped[str] = mapped_column(String, index=True)
    role = Column(Enum(HouseholdRoleType, name="household_role_type", schema="finance_tracker"))
    invited_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    status = Column(Enum(HouseholdInviteStatus, name="household_invite_status", schema="finance_tracker"), default=HouseholdInviteStatus.pending)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    household = relationship("Household", back_populates="invites")
    invited_by = relationship("User", foreign_keys=[invited_by_user_id])


class HouseholdSplitShare(Base):
    __tablename__ = "household_split_shares"
    __table_args__ = (UniqueConstraint('household_id', 'user_id', name='uq_household_split_share_household_user'),)

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, index=True, default=uuid.uuid7)
    household_id = Column(UUID(as_uuid=True), ForeignKey("households.id"))
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    share_percent = Column(Numeric)

    household = relationship("Household", back_populates="split_shares")
    user = relationship("User")


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
    # Liability accounts (loans, mortgages, credit) store their outstanding balance
    # as a positive number; aggregates subtract them instead of adding.
    kind = Column(Enum(AccountKind, native_enum=False), nullable=False, default=AccountKind.asset, server_default="asset")
    currency = Column(String)
    # NULL = shared with the whole household (default). Non-null = private, visible only to that user.
    owner_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    # --- Loan terms (liability accounts only) ---
    # Set together, these let the app amortize the debt forward instead of
    # waiting for the user to retype the balance every month. All optional: a
    # liability with no terms behaves exactly as it did before (flat balance).
    original_principal = Column(Numeric, nullable=True)  # amount borrowed, positive
    interest_rate_annual = Column(Numeric, nullable=True)  # nominal APR in percent, e.g. 3.5
    loan_term_months = Column(Integer, nullable=True)
    monthly_payment = Column(Numeric, nullable=True)  # if NULL, derived from the other three
    loan_start_date = Column(Date, nullable=True)

    # --- Property terms (illiquid asset accounts only) ---
    # Percent per year applied to the latest manual valuation when projecting
    # forward. NULL means "hold today's valuation flat", the conservative default.
    appreciation_rate_annual = Column(Numeric, nullable=True)

    # Ties a property to the loan secured against it (set on either side; the
    # app treats the pair symmetrically). Drives the "home equity" figure.
    linked_account_id = Column(UUID(as_uuid=True), ForeignKey("financial_accounts.id", ondelete="SET NULL"), nullable=True)

    household = relationship("Household", back_populates="accounts", foreign_keys=[household_id])
    owner = relationship("User", foreign_keys=[owner_user_id])
    linked_account = relationship("FinancialAccount", remote_side=[id], foreign_keys=[linked_account_id])
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
    amount_home_currency = Column(Numeric, nullable=True) # Converted amount in household base currency
    description = Column(String)
    transaction_type = Column(Enum(TransactionType, name="transaction_type", schema="finance_tracker"))
    currency = Column(String, nullable=True) # If null, assume account currency
    exchange_rate = Column(Float, nullable=True) # Rate from currency to account currency
    transfer_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    # Set when this row was generated by a recurring rule rather than logged by
    # hand. Deleting the rule leaves the history it already posted intact.
    recurring_transaction_id = Column(
        UUID(as_uuid=True), ForeignKey("recurring_transactions.id", ondelete="SET NULL"), nullable=True, index=True
    )

    account = relationship("FinancialAccount", back_populates="transactions")
    category = relationship("Category", back_populates="transactions")


class RecurringTransaction(Base):
    """
    A transaction the household knows is coming again: salary, rent, a
    subscription, a loan repayment.

    ``next_due_date`` is the single source of truth for what still needs
    posting. Materialization (services/recurring_service.materialize_due) creates
    a real ``Transaction`` and advances the pointer, so it is naturally
    idempotent and can catch up several missed periods in one run after the app
    has been idle. Posted transactions carry ``recurring_transaction_id`` so the
    UI can show what a rule has generated and so a rule is never double-posted.
    """

    __tablename__ = "recurring_transactions"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, index=True, default=uuid.uuid7)
    household_id = Column(UUID(as_uuid=True), ForeignKey("households.id"), index=True)
    account_id = Column(UUID(as_uuid=True), ForeignKey("financial_accounts.id"))
    category_id = Column(UUID(as_uuid=True), ForeignKey("categories.id"))

    amount = Column(Numeric)  # positive magnitude; direction comes from the category
    currency = Column(String, nullable=True)  # NULL = account currency
    description = Column(String, nullable=True)

    frequency = Column(Enum(RecurrenceFrequency, native_enum=False), nullable=False)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=True)  # NULL = runs forever
    next_due_date = Column(Date, nullable=False, index=True)
    last_posted_date = Column(Date, nullable=True)

    # Paused rules keep their schedule but post nothing; un-pausing resumes from
    # next_due_date rather than back-filling the gap.
    is_active = Column(Boolean, nullable=False, default=True, server_default="true")

    # NULL = shared with the household, a user id = private to that user.
    owner_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    household = relationship("Household", back_populates="recurring_transactions")
    account = relationship("FinancialAccount")
    category = relationship("Category")
    owner = relationship("User", foreign_keys=[owner_user_id])


class Budget(Base):
    """
    A spending limit for one category over a repeating period.

    One budget per (household, category, owner) so a shared budget and a private
    one can coexist for the same category without silently overwriting.
    """

    __tablename__ = "budgets"
    __table_args__ = (
        UniqueConstraint("household_id", "category_id", "owner_user_id", name="uq_budget_household_category_owner"),
    )

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, index=True, default=uuid.uuid7)
    household_id = Column(UUID(as_uuid=True), ForeignKey("households.id"), index=True)
    category_id = Column(UUID(as_uuid=True), ForeignKey("categories.id"))
    amount = Column(Numeric)  # the limit, in the household base currency
    period = Column(Enum(BudgetPeriod, native_enum=False), nullable=False, default=BudgetPeriod.monthly)
    owner_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    household = relationship("Household", back_populates="budgets")
    category = relationship("Category")
    owner = relationship("User", foreign_keys=[owner_user_id])


# --- 4. ASSETS, TRADES & PORTFOLIO ---


# Assets with this type represent uninvested cash held inside a sub-portfolio.
# They are always priced at 1.0 in their own currency and are excluded from
# market-data lookups (prices, dividends).
CASH_ASSET_TYPE = "cash"

# Asset.pricing_mode values. Market assets get prices from yfinance; manual
# assets (unlisted bonds, SSBs) are valued from user-recorded prices in
# market_prices, falling back to average cost when none is recorded.
PRICING_MODE_MARKET = "market"
PRICING_MODE_MANUAL = "manual"


def cash_ticker(currency: str) -> str:
    return f"CASH.{currency.upper()}"


class Asset(Base):
    __tablename__ = "assets"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, index=True, default=uuid.uuid7)
    ticker = Column(String, index=True)
    name = Column(String)
    type = Column(String)
    currency = Column(String)
    pricing_mode = Column(String, nullable=False, default=PRICING_MODE_MARKET, server_default=PRICING_MODE_MARKET)

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
    # NULL = shared goal, visible to the whole household. Non-null = private to that user.
    owner_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    household = relationship("Household", back_populates="sub_portfolios", foreign_keys=[household_id])
    owner = relationship("User", foreign_keys=[owner_user_id])
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
    # Points at the companion cash trade (or vice versa) when this trade was
    # settled against sub-portfolio cash instead of a funding-account transaction.
    settlement_trade_id = Column(UUID(as_uuid=True), ForeignKey("trades.id", ondelete="SET NULL"), nullable=True)


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
    __table_args__ = (
        UniqueConstraint('sub_portfolio_id', 'asset_id', 'date', name='uq_dividend_sub_portfolio_asset_date'),
    )

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, index=True, default=uuid.uuid7)
    household_id = Column(UUID(as_uuid=True), ForeignKey("households.id"))
    sub_portfolio_id = Column(UUID(as_uuid=True), ForeignKey("sub_portfolios.id"))
    asset_id = Column(UUID(as_uuid=True), ForeignKey("assets.id"))
    account_id = Column(UUID(as_uuid=True), ForeignKey("financial_accounts.id"))
    transaction_id = Column(UUID(as_uuid=True), ForeignKey("transactions.id"), nullable=True)
    date = Column(DateTime(timezone=True))
    amount = Column(Numeric)  # Total payout in asset currency (per_share * quantity)
    amount_home_currency = Column(Numeric, nullable=True)  # Converted to household base currency
    per_share_amount = Column(Numeric, nullable=True)  # Per-share dividend in asset currency
    quantity = Column(Float, nullable=True)  # Shares held on the ex-dividend date
    exchange_rate = Column(Float)
    is_manual = Column(Boolean, default=True)  # False for auto-tracked dividends
    # The buy trade of the sub-portfolio's cash pseudo-asset that credits this
    # payout as cash (see services/dividend_engine.sync_dividend_cash_credit).
    cash_trade_id = Column(UUID(as_uuid=True), ForeignKey("trades.id", ondelete="SET NULL"), nullable=True)

    household = relationship("Household", back_populates="dividends")
    sub_portfolio = relationship("SubPortfolio", back_populates="dividends")
    asset = relationship("Asset", back_populates="dividends")
    account = relationship("FinancialAccount", back_populates="dividends")
    transaction = relationship("Transaction")


class ScheduledDividend(Base):
    """
    A future dividend/coupon payment known in advance (bond coupons, SSB step-up
    schedules). Rows are materialized into real manual Dividend rows once their
    payment date arrives (services/dividend_engine.materialize_scheduled_dividends);
    ``materialized_at`` is the idempotency marker so deleting the resulting
    dividend never resurrects it.
    """
    __tablename__ = "scheduled_dividends"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, index=True, default=uuid.uuid7)
    household_id = Column(UUID(as_uuid=True), ForeignKey("households.id"), index=True)
    sub_portfolio_id = Column(UUID(as_uuid=True), ForeignKey("sub_portfolios.id"))
    asset_id = Column(UUID(as_uuid=True), ForeignKey("assets.id"))
    account_id = Column(UUID(as_uuid=True), ForeignKey("financial_accounts.id"))
    date = Column(Date)  # payment date
    amount = Column(Numeric)  # total payout in asset currency
    description = Column(String, nullable=True)
    dividend_id = Column(UUID(as_uuid=True), ForeignKey("dividends.id", ondelete="SET NULL"), nullable=True)
    materialized_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    household = relationship("Household", back_populates="scheduled_dividends")
    sub_portfolio = relationship("SubPortfolio")
    asset = relationship("Asset")
    account = relationship("FinancialAccount")
    dividend = relationship("Dividend")
