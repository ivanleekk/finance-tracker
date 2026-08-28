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
    Index,
    Boolean,
    func
)
from sqlalchemy.orm import relationship, Mapped, mapped_column
from src.database import Base

# Cards live in their own module — they are a self-contained subdomain, and
# inlining them pushed this file past 1,100 lines. Re-exported here so every
# caller keeps saying `models.Card`, and so importing `models` still registers
# them on `Base.metadata` before Alembic reads it.
from src.card_models import (  # noqa: F401
    Card,
    CardCategory,
    CardLimit,
    CycleBasis,
    LimitDirection,
    LimitResetBasis,
)


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
# Settling up with someone you fronted money for, or who fronted it for you. The
# spend was already recorded when the bill was paid — the household's own share
# hit a category then, and the rest went to a receivable/payable. Counting the
# settlement as spending too would charge the same dinner twice.
SYSTEM_CATEGORY_REIMBURSEMENT = "Reimbursement"
SYSTEM_CATEGORY_NAMES = frozenset(
    {
        SYSTEM_CATEGORY_INVESTMENT,
        SYSTEM_CATEGORY_BALANCE_ADJUSTMENT,
        SYSTEM_CATEGORY_TRANSFER,
        SYSTEM_CATEGORY_REIMBURSEMENT,
    }
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
    # Reveals the optional MCC field on the transaction form. Off by default and
    # per-user rather than per-household: it is a preference about how *you* enter
    # data, and a four-digit code field on every form would tax everyone for a
    # minority feature. Nothing behaves differently when it is on — the code is
    # recorded, never evaluated (see Transaction.mcc).
    record_merchant_codes: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False
    )
    # Preselected account for new expense/income transactions (web quick-add, CommandBar, iOS QuickAdd).
    # Nullable: falls back to first accessible account when unset. ON DELETE SET NULL so
    # closing the account just clears the preference instead of blocking the delete.
    default_account_id = Column(UUID(as_uuid=True), ForeignKey("financial_accounts.id", ondelete="SET NULL"), nullable=True)

    # Relationships
    household_memberships = relationship("HouseholdMember", back_populates="user")
    account_accesses = relationship("AccountAccess", back_populates="user")
    portfolio_accesses = relationship("PortfolioAccess", back_populates="user")
    default_account = relationship("FinancialAccount", foreign_keys=[default_account_id])


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
    # verify_household_access filters on (user_id, household_id) together on
    # nearly every authenticated request, so this is the single hottest lookup
    # in the app.
    __table_args__ = (
        Index("ix_household_members_user_household", "user_id", "household_id"),
    )

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, index=True, default=uuid.uuid7)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    household_id = Column(UUID(as_uuid=True), ForeignKey("households.id"))
    role = Column(Enum(HouseholdRoleType, name="household_role_type", schema="finance_tracker"))

    user = relationship("User", back_populates="household_memberships")
    household = relationship("Household", back_populates="members")


class HouseholdInvite(Base):
    __tablename__ = "household_invites"
    __table_args__ = (
        Index("ix_household_invites_email_status", "email", "status"),
    )

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
    account_id = Column(UUID(as_uuid=True), ForeignKey("financial_accounts.id"), index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), index=True)
    role = Column(Enum(AccountRoleType, name="account_role_type", schema="finance_tracker"))

    account = relationship("FinancialAccount", back_populates="access_controls")
    user = relationship("User", back_populates="account_accesses")


class PortfolioAccess(Base):
    __tablename__ = "portfolio_access"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, index=True, default=uuid.uuid7)
    sub_portfolio_id = Column(UUID(as_uuid=True), ForeignKey("sub_portfolios.id"), index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), index=True)
    role = Column(String)

    sub_portfolio = relationship("SubPortfolio", back_populates="access_controls")
    user = relationship("User", back_populates="portfolio_accesses")


# --- 2. UNIVERSAL ACCOUNTS & CASH BALANCES ---


class FinancialAccount(Base):
    __tablename__ = "financial_accounts"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, index=True, default=uuid.uuid7)
    household_id = Column(UUID(as_uuid=True), ForeignKey("households.id"), index=True)
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

    # Earmarks this account to a sub-portfolio/goal (#252): the balance still
    # belongs to the account for net-worth purposes, but also counts towards that
    # sub-portfolio's value and goal progress. For money you can't move into the
    # portfolio proper -- CPF OA towards a housing goal being the motivating case.
    # SET NULL on delete: dropping a goal must never take a real account with it.
    sub_portfolio_id = Column(UUID(as_uuid=True), ForeignKey("sub_portfolios.id", ondelete="SET NULL"), nullable=True, index=True)

    # Closed, but keep its history. Archiving is what a used account gets instead
    # of deletion: every journal entry spans two accounts, so deleting one side
    # would silently rewrite the other's balance — and receivables reach net
    # worth, so "close an old account" could change what you are worth.
    #
    # It hides the account from the places you *start* new work — the account
    # list and every picker — and takes it out of current totals. It is not a
    # tombstone: the balances, transactions and journal entries all stay exactly
    # where they were, so past figures do not move, and un-archiving is a
    # one-field edit.
    is_archived = Column(Boolean, nullable=False, default=False, server_default="false")

    household = relationship("Household", back_populates="accounts", foreign_keys=[household_id])
    owner = relationship("User", foreign_keys=[owner_user_id])
    linked_account = relationship("FinancialAccount", remote_side=[id], foreign_keys=[linked_account_id])
    sub_portfolio = relationship("SubPortfolio", back_populates="linked_accounts", foreign_keys=[sub_portfolio_id])
    access_controls = relationship("AccountAccess", back_populates="account")
    balances = relationship("AccountBalance", back_populates="account")
    transactions = relationship("Transaction", back_populates="account")
    trades = relationship("Trade", back_populates="account")
    dividends = relationship("Dividend", back_populates="account")


class AccountBalance(Base):
    __tablename__ = "account_balances"
    # sync_transaction_to_balances / propagate_balance_change filter by
    # account_id plus a date comparison on every single transaction/trade
    # posted, so this composite is on the hottest write path in the app.
    __table_args__ = (
        Index("ix_account_balances_account_date", "account_id", "date"),
    )

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
    household_id = Column(UUID(as_uuid=True), ForeignKey("households.id"), index=True)
    name = Column(String)
    type = Column(String)

    household = relationship("Household", back_populates="categories")
    transactions = relationship("Transaction", back_populates="category")


class Transaction(Base):
    __tablename__ = "transactions"
    __table_args__ = (
        Index("ix_transactions_account_date", "account_id", "date"),
    )

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, index=True, default=uuid.uuid7)
    account_id = Column(UUID(as_uuid=True), ForeignKey("financial_accounts.id"))
    category_id = Column(UUID(as_uuid=True), ForeignKey("categories.id"), index=True)
    date = Column(DateTime(timezone=True))
    amount = Column(Numeric)
    amount_home_currency = Column(Numeric, nullable=True) # Converted amount in household base currency
    description = Column(String)
    transaction_type = Column(Enum(TransactionType, name="transaction_type", schema="finance_tracker"))
    currency = Column(String, nullable=True) # If null, assume account currency
    exchange_rate = Column(Float, nullable=True) # Rate from currency to account currency
    transfer_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    # The merchant category code the acquirer assigned, when the user happens to
    # know it. Recorded, never evaluated: nothing in the app derives a category,
    # a budget or a limit from it. That constraint is the point — the app has no
    # bank feed and cannot discover an MCC, so anything depending on one being
    # present would simply not work. Kept because a code the user records is
    # knowledge that cannot be bought, and because it sharpens later suggestions.
    mcc = Column(String(4), nullable=True)
    # Which of the card's own categories this spend counts towards. Null falls
    # to the card's default category, so an untagged transaction is still
    # metered rather than silently missing from the card's totals.
    #
    # ON DELETE RESTRICT is deliberate — the delete endpoint returns a 409 with
    # an explanation instead, the same treatment deleting a category still used
    # by a recurring rule already gets. Tripping the FK into a 500 is a failure
    # mode this codebase has already decided against.
    card_category_id = Column(
        UUID(as_uuid=True),
        ForeignKey("card_categories.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
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
    A spending limit for one or more categories over a repeating period.

    A category can only belong to one budget per (household, owner) scope —
    see BudgetCategory's own unique constraint — so a shared budget and a
    private one can coexist for the same category without silently overwriting,
    and two budgets can't double-count the same category's spend.
    """

    __tablename__ = "budgets"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, index=True, default=uuid.uuid7)
    household_id = Column(UUID(as_uuid=True), ForeignKey("households.id"), index=True)
    amount = Column(Numeric)  # the limit, in the household base currency
    period = Column(Enum(BudgetPeriod, native_enum=False), nullable=False, default=BudgetPeriod.monthly)
    owner_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    household = relationship("Household", back_populates="budgets")
    owner = relationship("User", foreign_keys=[owner_user_id])
    budget_categories = relationship(
        "BudgetCategory", back_populates="budget", cascade="all, delete-orphan"
    )

    @property
    def category_ids(self) -> list:
        return [bc.category_id for bc in self.budget_categories]


class BudgetCategory(Base):
    """
    One category attached to a Budget.

    household_id/owner_user_id are denormalized from the parent Budget (both
    are immutable after creation) so Postgres — not application code — can
    enforce that a category belongs to at most one budget per (household,
    owner) scope, the same guarantee the old single-category Budget row gave
    us via its own unique constraint.
    """

    __tablename__ = "budget_categories"
    __table_args__ = (
        UniqueConstraint(
            "household_id", "category_id", "owner_user_id",
            name="uq_budget_category_household_category_owner",
        ),
    )

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, index=True, default=uuid.uuid7)
    budget_id = Column(UUID(as_uuid=True), ForeignKey("budgets.id"), index=True, nullable=False)
    category_id = Column(UUID(as_uuid=True), ForeignKey("categories.id"), index=True, nullable=False)
    household_id = Column(UUID(as_uuid=True), ForeignKey("households.id"), index=True, nullable=False)
    owner_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    budget = relationship("Budget", back_populates="budget_categories")
    category = relationship("Category")


# --- 4. ASSETS, TRADES & PORTFOLIO ---


# Assets with this type represent uninvested cash held inside a sub-portfolio.
# They are always priced at 1.0 in their own currency and are excluded from
# market-data lookups (prices, dividends).
CASH_ASSET_TYPE = "cash"

# Assets with this type stand in for a real household account that has been
# earmarked to a sub-portfolio (FinancialAccount.sub_portfolio_id) -- e.g. a
# Singapore CPF OA balance counting towards a housing goal. One pseudo-asset per
# linked account, valued each day at that account's own balance rather than at a
# market price, so the money shows up in the sub-portfolio's value, goal progress
# and equity curve without any trade ever being recorded (see #252).
#
# These are DELIBERATELY excluded from the return metrics (TWR, IRR, Sharpe,
# Sortino, Treynor, alpha/beta) in services/performance.py: a CPF contribution is
# a deposit, not investment performance, and counting it as one silently inflates
# every ratio on the Portfolio tab.
LINKED_ACCOUNT_ASSET_TYPE = "linked_account"

# Asset types that are stand-ins for money rather than tradable instruments.
# Neither gets a yfinance price or dividend lookup.
PSEUDO_ASSET_TYPES = frozenset({CASH_ASSET_TYPE, LINKED_ACCOUNT_ASSET_TYPE})

# Asset.pricing_mode values. Market assets get prices from yfinance; manual
# assets (unlisted bonds, SSBs) are valued from user-recorded prices in
# market_prices, falling back to average cost when none is recorded.
PRICING_MODE_MARKET = "market"
PRICING_MODE_MANUAL = "manual"


def cash_ticker(currency: str) -> str:
    return f"CASH.{currency.upper()}"


def linked_account_ticker(account_id) -> str:
    """
    Ticker for a linked account's pseudo-asset. Keyed by account id rather than
    name so renaming an account doesn't orphan its snapshot history.
    """
    return f"ACCT.{account_id}"


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
    household_id = Column(UUID(as_uuid=True), ForeignKey("households.id"), index=True)
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
    # Real household accounts earmarked to this sub-portfolio (#252).
    linked_accounts = relationship(
        "FinancialAccount",
        back_populates="sub_portfolio",
        foreign_keys="FinancialAccount.sub_portfolio_id",
    )


class Trade(Base):
    __tablename__ = "trades"
    __table_args__ = (
        Index("ix_trades_household_date", "household_id", "date"),
        Index("ix_trades_sub_portfolio_asset", "sub_portfolio_id", "asset_id"),
    )

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, index=True, default=uuid.uuid7)
    household_id = Column(UUID(as_uuid=True), ForeignKey("households.id"))
    sub_portfolio_id = Column(UUID(as_uuid=True), ForeignKey("sub_portfolios.id"))
    asset_id = Column(UUID(as_uuid=True), ForeignKey("assets.id"))
    account_id = Column(UUID(as_uuid=True), ForeignKey("financial_accounts.id"), index=True)
    transaction_id = Column(UUID(as_uuid=True), ForeignKey("transactions.id"), nullable=True, index=True)
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
        # calculate_performance_metrics / snapshot_engine group and range-filter
        # by (household_id, date) on every dashboard and portfolio metrics load.
        Index("ix_portfolio_snapshots_household_date", "household_id", "date"),
    )

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, index=True, default=uuid.uuid7)
    household_id = Column(UUID(as_uuid=True), ForeignKey("households.id"))
    sub_portfolio_id = Column(UUID(as_uuid=True), ForeignKey("sub_portfolios.id"))
    asset_id = Column(UUID(as_uuid=True), ForeignKey("assets.id"), index=True)
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
        Index("ix_dividends_household_date", "household_id", "date"),
    )

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, index=True, default=uuid.uuid7)
    household_id = Column(UUID(as_uuid=True), ForeignKey("households.id"))
    sub_portfolio_id = Column(UUID(as_uuid=True), ForeignKey("sub_portfolios.id"))
    asset_id = Column(UUID(as_uuid=True), ForeignKey("assets.id"), index=True)
    account_id = Column(UUID(as_uuid=True), ForeignKey("financial_accounts.id"), index=True)
    transaction_id = Column(UUID(as_uuid=True), ForeignKey("transactions.id"), nullable=True, index=True)
    date = Column(DateTime(timezone=True))
    amount = Column(Numeric)  # Total payout in asset currency (per_share * quantity)
    amount_home_currency = Column(Numeric, nullable=True)  # Converted to household base currency
    per_share_amount = Column(Numeric, nullable=True)  # Per-share dividend in asset currency
    quantity = Column(Float, nullable=True)  # Shares held on the ex-dividend date
    exchange_rate = Column(Float)
    is_manual = Column(Boolean, nullable=False, default=True)  # False for auto-tracked dividends
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
    sub_portfolio_id = Column(UUID(as_uuid=True), ForeignKey("sub_portfolios.id"), index=True)
    asset_id = Column(UUID(as_uuid=True), ForeignKey("assets.id"), index=True)
    account_id = Column(UUID(as_uuid=True), ForeignKey("financial_accounts.id"), index=True)
    date = Column(Date, index=True)  # payment date
    amount = Column(Numeric)  # total payout in asset currency
    description = Column(String, nullable=True)
    dividend_id = Column(UUID(as_uuid=True), ForeignKey("dividends.id", ondelete="SET NULL"), nullable=True, index=True)
    materialized_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    household = relationship("Household", back_populates="scheduled_dividends")
    sub_portfolio = relationship("SubPortfolio")
    asset = relationship("Asset")
    account = relationship("FinancialAccount")
    dividend = relationship("Dividend")


# ---------------------------------------------------------------------------
# Double-entry ledger
# ---------------------------------------------------------------------------
#
# Every movement of money is a JournalEntry whose JournalLines debit and credit
# LedgerAccounts, and whose debits equal its credits. That single invariant is
# what buys the things single-entry could not express:
#
#  - **Paying on behalf of someone.** A $200 dinner where $150 is owed back is
#    one entry: Dr Dining 50, Dr Receivable-Alice 150, Cr Bank 200. The budget
#    reads the Dining line and sees 50, because only 50 was ever spent. The
#    repayment (Dr Bank 150, Cr Receivable-Alice 150) touches no expense account
#    at all, so it can't inflate anything either. Neither needs a special case in
#    the budget code — it falls out of the structure.
#  - **Contra entries.** A refund is a *credit* to the category it came from, not
#    income. Single-entry had nowhere to put it: `Transaction.amount` is positive
#    and `TransactionType` has only income and expense, so refunds and cashback
#    were logged as income and inflated both income and the savings rate.
#  - **Receivables and payables as real balances.** Money owed to the household
#    is an asset and belongs in net worth; money it owes is a liability. They are
#    ordinary accounts here, so every rollup picks them up without being taught to.
#
# What is deliberately *not* in the journal: the daily mark-to-market of
# investment holdings. Valuing a position at today's close is a revaluation, not
# a transaction, and posting one entry per holding per day would be an enormous
# volume of rows against `snapshot_engine`, which already does this well. Trades
# and dividends post entries for the *cash* they move; the holdings themselves
# stay valued by the snapshot engine. See `services/ledger_service.py`.


class LedgerAccountType(enum.Enum):
    asset = "asset"
    liability = "liability"
    equity = "equity"
    income = "income"
    expense = "expense"


#: Which side increases an account of each type. Assets and expenses are
#: debit-normal (spending money debits an expense, receiving it debits the bank);
#: liabilities, equity and income are credit-normal.
DEBIT_NORMAL_TYPES = frozenset({LedgerAccountType.asset, LedgerAccountType.expense})


class LedgerAccountRole(enum.Enum):
    """
    What a chart account *is*, beyond its accounting type, so the app can find the
    ones it needs without matching on names.

    `cash` and `category` accounts mirror rows the app already had — a
    FinancialAccount and a Category respectively — and are created for them
    automatically. `receivable` / `payable` are the new ones: a person who owes
    the household money, or is owed it, identified by a plain name.
    """

    cash = "cash"                    # mirrors a FinancialAccount (asset or liability)
    category = "category"            # mirrors a Category (income or expense)
    receivable = "receivable"        # someone owes the household
    payable = "payable"              # the household owes someone
    opening_balance = "opening_balance"  # the equity plug a new account starts from
    adjustment = "adjustment"        # the equity plug a manual reconciliation lands in


class LedgerAccount(Base):
    """
    One account in the household's chart of accounts.

    Accounts that mirror an existing row carry a link to it (`financial_account_id`
    or `category_id`), so the ledger can be introduced without moving the app's
    existing objects: a Category is still what a budget is written against, and a
    FinancialAccount is still what a balance belongs to. The ledger account is the
    same thing seen from the bookkeeping side.
    """

    __tablename__ = "ledger_accounts"
    __table_args__ = (
        # One chart account per underlying row — two would silently split a balance.
        UniqueConstraint("financial_account_id", name="uq_ledger_accounts_financial_account"),
        UniqueConstraint("category_id", name="uq_ledger_accounts_category"),
        # Counterparty names are per household and per direction: "Alice" owing the
        # household and the household owing "Alice" are two accounts, and netting
        # them by hand is the user's business, not the ledger's.
        UniqueConstraint(
            "household_id", "role", "counterparty_name", "owner_user_id",
            name="uq_ledger_accounts_counterparty",
        ),
        Index("ix_ledger_accounts_household_role", "household_id", "role"),
    )

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, index=True, default=uuid.uuid7)
    household_id = Column(UUID(as_uuid=True), ForeignKey("households.id"), index=True, nullable=False)
    name = Column(String, nullable=False)
    type = Column(Enum(LedgerAccountType, name="ledger_account_type", schema="finance_tracker"), nullable=False)
    role = Column(Enum(LedgerAccountRole, name="ledger_account_role", schema="finance_tracker"), nullable=False)

    #: A contra account sits against the normal side of its own type — accumulated
    #: depreciation against an asset, a discount against income. Kept as a flag
    #: rather than a negative balance so reports can show gross and net.
    is_contra = Column(Boolean, nullable=False, default=False)

    financial_account_id = Column(
        UUID(as_uuid=True), ForeignKey("financial_accounts.id", ondelete="CASCADE"), nullable=True
    )
    category_id = Column(UUID(as_uuid=True), ForeignKey("categories.id", ondelete="CASCADE"), nullable=True)

    #: Free-text person for receivable/payable accounts ("Alice", "Mum", "Work").
    counterparty_name = Column(String, nullable=True)

    #: NULL = shared with the household, a user id = private to that user. Same
    #: rule as FinancialAccount / SubPortfolio; see AGENTS.md 4a.
    owner_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    household = relationship("Household")
    financial_account = relationship("FinancialAccount")
    category = relationship("Category")
    lines = relationship("JournalLine", back_populates="ledger_account")

    @property
    def is_debit_normal(self) -> bool:
        """Contra accounts sit on the opposite side to their type's normal one."""
        normal = self.type in DEBIT_NORMAL_TYPES
        return not normal if self.is_contra else normal


class JournalSource(enum.Enum):
    """
    What created an entry. `source_id` points back at the originating row, which is
    what lets the backfill be re-run without duplicating and lets an edit to a
    transaction find and replace the entry it posted.
    """

    manual = "manual"
    transaction = "transaction"
    transfer = "transfer"
    trade = "trade"
    dividend = "dividend"
    balance_adjustment = "balance_adjustment"
    opening_balance = "opening_balance"


class JournalEntry(Base):
    """One balanced event: its lines' debits equal their credits in home currency."""

    __tablename__ = "journal_entries"
    __table_args__ = (
        Index("ix_journal_entries_household_date", "household_id", "date"),
        # At most one entry per source row, so a backfill or a re-post is idempotent.
        UniqueConstraint("source", "source_id", name="uq_journal_entries_source"),
    )

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, index=True, default=uuid.uuid7)
    household_id = Column(UUID(as_uuid=True), ForeignKey("households.id"), index=True, nullable=False)
    date = Column(DateTime(timezone=True), nullable=False)
    description = Column(String, nullable=True)
    source = Column(
        Enum(JournalSource, name="journal_source", schema="finance_tracker"),
        nullable=False,
        default=JournalSource.manual,
    )
    source_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    household = relationship("Household")
    lines = relationship(
        "JournalLine", back_populates="entry", cascade="all, delete-orphan", order_by="JournalLine.id"
    )


class JournalLine(Base):
    """
    One side of one entry. Exactly one of `debit` / `credit` is non-zero, both are
    non-negative, and both are in the household's **base currency** — that is the
    currency the entry balances in. `native_amount` / `native_currency` carry what
    actually moved, for display on a foreign-currency account.
    """

    __tablename__ = "journal_lines"
    __table_args__ = (
        Index("ix_journal_lines_account", "ledger_account_id"),
    )

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, index=True, default=uuid.uuid7)
    entry_id = Column(UUID(as_uuid=True), ForeignKey("journal_entries.id", ondelete="CASCADE"), nullable=False, index=True)
    ledger_account_id = Column(UUID(as_uuid=True), ForeignKey("ledger_accounts.id"), nullable=False)

    debit = Column(Numeric, nullable=False, default=0)
    credit = Column(Numeric, nullable=False, default=0)

    native_amount = Column(Numeric, nullable=True)
    native_currency = Column(String, nullable=True)
    exchange_rate = Column(Float, nullable=True)

    memo = Column(String, nullable=True)

    entry = relationship("JournalEntry", back_populates="lines")
    ledger_account = relationship("LedgerAccount", back_populates="lines")
