# src/schemas.py

from pydantic import BaseModel, BeforeValidator, ConfigDict, EmailStr, Field, field_validator, model_validator
from typing import Annotated, List, Literal, Optional
from datetime import date, datetime
from decimal import Decimal
import enum
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


def _blank_to_none(value: object) -> object:
    """Treat an empty or whitespace-only string as "not given"."""
    if isinstance(value, str) and not value.strip():
        return None
    return value


# A merchant category code: four digits, or nothing at all.
#
# The blank-coercion is the load-bearing half. An MCC is optional even when the
# user has the field switched on -- most people do not know the code for most
# purchases -- and a cleared text field sends "" rather than null from all three
# clients. Without this, "I don't know it" would be a 422, and each client would
# separately have to remember to convert; that is exactly the sort of per-client
# detail this codebase has been bitten by before.
# Note the nesting: the pattern constrains the *str*, and Optional wraps the
# constrained type. Putting the pattern on the union instead makes `null` fail
# it too, which is the opposite of optional.
# `[0-9]` rather than `\d`: Python's `\d` matches Unicode decimal digits, so a
# full-width "５８１４" would validate and then never match a code in the catalogue.
MerchantCategoryCode = Annotated[
    Optional[Annotated[str, Field(pattern=r"^[0-9]{4}$")]],
    BeforeValidator(_blank_to_none),
]

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
    PRICING_MODE_MARKET,
    SYSTEM_CATEGORY_NAMES,
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
    require_face_id_for_vault: bool = False
    default_new_items_private: bool = True
    # Reveals the optional MCC field on the transaction form. See models.User.
    record_merchant_codes: bool = False
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
    record_merchant_codes: Optional[bool] = None
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
    # Close an account without erasing it. See models.FinancialAccount.is_archived.
    is_archived: Optional[bool] = None
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
    is_archived: bool = False
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
    # A category the app creates for its own bookkeeping (Transfer, Balance
    # Adjustment, Investment, Reimbursement — see models.SYSTEM_CATEGORY_NAMES),
    # not one a user chose. There is no stored flag: identity is the name, the
    # same way every find-or-create site and the budget/burn-rate exclusions
    # already recognize these. Clients use this to keep such categories out of
    # pickers (a recurring rule, say) where filing under one would misclassify
    # real spending and fight the balance-reconciliation logic that owns it.
    is_system: bool = False

    model_config = ConfigDict(from_attributes=True)

    @model_validator(mode="after")
    def _mark_system_category(self) -> "CategoryResponse":
        self.is_system = self.name in SYSTEM_CATEGORY_NAMES
        return self


class MccResponse(BaseModel):
    """
    A row of the merchant category code catalogue (`GET /reference/mccs`).

    A typed model rather than the `Dict[str, str]` its neighbours `/currencies`
    and `/timezones` return, because unlike those this row is not all strings:
    `is_brand` is a boolean, and squeezing it into `"true"`/`"false"` pushed the
    job of parsing it back out into three separate clients.
    """

    code: str
    name: str
    group: str
    # True for the 3000-3999 airline/hotel/car-rental brand block. Rows arrive
    # already ordered with these last, so this is for grouping and labelling —
    # no client needs to sort on it.
    is_brand: bool


# --- Cards & spend limits ---


def _enum_to_value(value: object) -> object:
    """
    Accept either the SQLAlchemy enum member or the wire string it serialises to.

    These fields are `Literal`s rather than the model enums so the JSON contract
    is a plain string, but reading a row back hands us the enum member. Coercing
    here keeps every response builder from having to remember `.value` — the
    kind of per-call-site detail that gets missed on exactly one endpoint.
    """
    return getattr(value, "value", value)


CycleBasisField = Annotated[Literal["statement", "calendar"], BeforeValidator(_enum_to_value)]
LimitDirectionField = Annotated[Literal["ceiling", "floor"], BeforeValidator(_enum_to_value)]
LimitResetField = Annotated[
    Literal["cycle", "calendar_month", "quarter", "year"], BeforeValidator(_enum_to_value)
]


class CardBase(BaseModel):
    cycle_basis: CycleBasisField = "statement"
    # 1-31, clamped to the end of shorter months so a card closing on the 31st
    # still closes in February.
    statement_day: int = Field(1, ge=1, le=31)


class CardCreate(CardBase):
    financial_account_id: uuid.UUID


class CardUpdate(BaseModel):
    cycle_basis: Optional[CycleBasisField] = None
    statement_day: Optional[int] = Field(None, ge=1, le=31)


class CardLimitBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    # Always a currency figure. A cap the issuer states in rewards ("max $60
    # cashback") has to be converted by the user, because nothing here knows a
    # rate — see the note on models.CardLimit.
    amount: PositiveDecimal
    direction: LimitDirectionField = "ceiling"
    reset_basis: LimitResetField = "cycle"


class CardLimitCreate(CardLimitBase):
    pass


class CardLimitUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    amount: Optional[PositiveDecimal] = None
    direction: Optional[LimitDirectionField] = None
    reset_basis: Optional[LimitResetField] = None


class CardLimitResponse(CardLimitBase):
    id: uuid.UUID
    card_id: uuid.UUID
    model_config = ConfigDict(from_attributes=True)


class CardCategoryBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    is_default: bool = False
    sort_order: int = 0


class CardCategoryCreate(CardCategoryBase):
    limit_id: Optional[uuid.UUID] = None


class CardCategoryUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    is_default: Optional[bool] = None
    sort_order: Optional[int] = None
    # Three states, the same rule the reimbursement split and `mcc` already use:
    # omitting the key leaves the limit alone, sending null detaches it. Without
    # the distinction there is no way to make a metered category unmetered.
    limit_id: Optional[uuid.UUID] = None


class CardCategoryResponse(CardCategoryBase):
    id: uuid.UUID
    card_id: uuid.UUID
    limit_id: Optional[uuid.UUID] = None
    model_config = ConfigDict(from_attributes=True)


class CardResponse(CardBase):
    id: uuid.UUID
    financial_account_id: uuid.UUID
    account_name: str
    currency: Optional[str] = None
    categories: List[CardCategoryResponse] = []
    limits: List[CardLimitResponse] = []
    model_config = ConfigDict(from_attributes=True)


class CardLimitStatusRow(BaseModel):
    """
    One limit and how the current window is tracking against it.

    Deliberately the same shape as `BudgetStatusRow`, so each client's existing
    budget presentation renders it without new maths. `direction` is the
    addition that tells the reader which way to read `remaining`.
    """

    limit_id: uuid.UUID
    name: str
    category_names: List[str]
    direction: LimitDirectionField
    amount: Decimal
    spent: Decimal
    # Ceiling: headroom left. Floor: how much more is still needed.
    remaining: Decimal
    percent_used: float
    period_start: date
    period_end: date
    days_elapsed: int
    days_total: int
    projected_spend: Decimal
    # Ceiling: on pace to burst. Floor: on pace to fall short.
    projected_missed: bool
    settled: bool


class CardCategorySpendRow(BaseModel):
    card_category_id: uuid.UUID
    name: str
    spent: Decimal


class CardStatusResponse(BaseModel):
    card_id: uuid.UUID
    account_name: str
    currency: Optional[str] = None
    cycle_start: date
    cycle_end: date
    limits: List[CardLimitStatusRow]
    categories: List[CardCategorySpendRow]


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
    # Optional, and recorded rather than evaluated — see models.Transaction.mcc.
    mcc: MerchantCategoryCode = None
    # Which of the card's own categories this counts towards. Null falls to the
    # card's default, so untagged spend is still metered.
    card_category_id: Optional[uuid.UUID] = None


class TransactionSplitInput(BaseModel):
    """One counterparty's share of a transaction being created or edited."""

    counterparty_id: uuid.UUID
    amount: PositiveDecimal


class TransactionSplitRow(BaseModel):
    """One counterparty's share of a transaction, read back from the ledger."""

    counterparty_id: uuid.UUID
    counterparty_name: str
    amount: Decimal
    # A recurring rule's standing split is an ORM row rather than a ledger line,
    # and it exposes `counterparty_name` as a property so it maps straight onto
    # this without the caller assembling it by hand.
    model_config = ConfigDict(from_attributes=True)


class TransactionCreate(TransactionBase):
    account_id: uuid.UUID
    category_id: uuid.UUID
    # Part of this expense was one or more other people's. `amount` stays the
    # full sum that left the account — that really happened — while each
    # split's amount is carved off onto that counterparty's receivable, so
    # budgets charge the household for its own share only.
    splits: Optional[List[TransactionSplitInput]] = None

    @model_validator(mode="after")
    def _check_split(self):
        if self.splits is not None:
            total_owed = sum((s.amount for s in self.splits), Decimal("0"))
            if total_owed > self.amount:
                raise ValueError("Split amounts cannot exceed the transaction amount.")
            counterparty_ids = [s.counterparty_id for s in self.splits]
            if len(set(counterparty_ids)) != len(counterparty_ids):
                raise ValueError("Each counterparty can only appear once in a split.")
        return self


class TransactionUpdate(BaseModel):
    date: Optional[datetime] = None
    amount: Optional[PositiveDecimal] = None
    amount_home_currency: Optional[FiniteDecimal] = None
    currency: Optional[str] = None
    exchange_rate: Optional[PositiveFloat] = None
    description: Optional[str] = None
    account_id: Optional[uuid.UUID] = None
    category_id: Optional[uuid.UUID] = None
    # Omit to leave the split already recorded alone; send `[]` to clear it and
    # make the whole expense the household's own again; send a populated list
    # to replace it wholesale. A list already has an unambiguous empty state,
    # so unlike `mcc`/`card_category_id` below there is no need for a separate
    # null-vs-omitted distinction.
    splits: Optional[List[TransactionSplitInput]] = None
    # Omit to leave it alone; send null or "" to clear one that was recorded.
    mcc: MerchantCategoryCode = None
    # Same three-state rule: omit to preserve, send null to untag.
    card_category_id: Optional[uuid.UUID] = None


class TransactionResponse(TransactionBase):
    id: uuid.UUID
    account_id: uuid.UUID
    category_id: uuid.UUID
    # Populated from the ledger where the row was split. Empty means none of it
    # was somebody else's — including for everything logged before the ledger.
    splits: List[TransactionSplitRow] = []
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
    # Carried onto every transaction the rule posts. A subscription's merchant
    # code and the card category it counts towards don't change month to month,
    # so recording them once on the rule is the difference between a rule that
    # describes a payment and one that only half-describes it.
    mcc: MerchantCategoryCode = None
    card_category_id: Optional[uuid.UUID] = None


class RecurringTransactionCreate(RecurringTransactionBase):
    household_id: uuid.UUID
    # A standing share of every occurrence — the flatmate's half of the rent,
    # without re-entering it each month. Absolute amounts, not fractions, for the
    # same reason a transaction's split is: a share is what somebody owes.
    splits: Optional[List[TransactionSplitInput]] = None


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
    # Three-state, like their counterparts on `TransactionUpdate`: leave the key
    # out to preserve what's recorded, send null (or "" for the code) to clear
    # it. Editing a rule's amount must not silently discard a code the user
    # looked up once.
    mcc: MerchantCategoryCode = None
    card_category_id: Optional[uuid.UUID] = None
    # Plain optional list, the same three states `TransactionUpdate.splits` uses:
    # omit to leave the recorded split alone, `[]` to clear it, a populated list
    # to replace it wholesale. An empty array is already unambiguous, so this
    # needs no tri-state wrapper.
    splits: Optional[List[TransactionSplitInput]] = None


class RecurringTransactionResponse(RecurringTransactionBase):
    id: uuid.UUID
    household_id: uuid.UUID
    next_due_date: date
    last_posted_date: Optional[date] = None
    # What the rule has actually done, as opposed to what it is scheduled to do.
    # `next_due_date` alone says a rule is healthy; these say whether it has ever
    # fired. A rule that has posted nothing in six months is either new or broken,
    # and the two look identical without a count.
    #
    # Defaulted rather than required so the create/update endpoints — which return
    # this schema straight off a freshly written row — stay correct without
    # recomputing: a rule that has just been created has posted nothing.
    posted_count: int = 0
    posted_total_home_currency: Decimal = Decimal("0")
    # What each occurrence will claim back. Named rows rather than ids so a
    # client can render the rule without a second lookup, matching
    # `TransactionResponse.splits`.
    splits: List[TransactionSplitRow] = []
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
# 3d. REIMBURSEMENTS
# ----------------------------------------


class CounterpartyDirection(str, enum.Enum):
    """Which way the debt runs, named from the household's point of view."""

    owed_to_you = "owed_to_you"
    you_owe = "you_owe"


class CounterpartyCreate(BaseModel):
    household_id: uuid.UUID
    name: str = Field(..., max_length=120)

    @field_validator("name")
    @classmethod
    def _name_not_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("name cannot be blank")
        return stripped


class CounterpartyUpdate(BaseModel):
    name: str = Field(..., max_length=120)

    @field_validator("name")
    @classmethod
    def _name_not_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("name cannot be blank")
        return stripped


class CounterpartyResponse(BaseModel):
    id: uuid.UUID
    household_id: uuid.UUID
    name: str

    model_config = ConfigDict(from_attributes=True)


class CounterpartyBalanceResponse(BaseModel):
    counterparty_id: uuid.UUID
    counterparty_name: str
    direction: CounterpartyDirection
    amount: Decimal
    # Which owner scope this specific debt belongs to (None = shared with the
    # household) — not which account happens to settle it. A client must echo
    # this back on `SettlementCreate` unchanged, or settling can silently miss
    # the debt it was shown and open an unrelated one instead.
    owner_user_id: Optional[uuid.UUID] = None


class SpendOnYourBehalfCreate(BaseModel):
    """
    Somebody else paid for something of yours.

    There is no account and no amount leaving one, because none did — which is
    exactly why this could not be logged before. It is real spending of yours and
    a real debt, and the ledger records both without inventing a cash movement.
    """

    household_id: uuid.UUID
    category_id: uuid.UUID
    counterparty_id: uuid.UUID
    amount: PositiveDecimal
    date: datetime
    description: Optional[str] = None
    owner_user_id: Optional[uuid.UUID] = None


class SettlementCreate(BaseModel):
    """Money actually changing hands to clear a debt."""

    account_id: uuid.UUID
    counterparty_id: uuid.UUID
    direction: CounterpartyDirection
    amount: PositiveDecimal
    date: datetime
    description: Optional[str] = None
    # The debt's own owner scope (from `CounterpartyBalanceResponse.owner_user_id`),
    # not the settling account's — see `post_settlement`.
    owner_user_id: Optional[uuid.UUID] = None


# ----------------------------------------
# 4. PORTFOLIO & ASSETS
# ----------------------------------------


# Spellings of ``pricing_mode`` that a client may send for a canonical value. The
# Android app shipped with "auto" where the backend says "market", so every
# non-manual asset it created came back 422. Folding the synonym in here keeps a
# single canonical value in the column: widening the Literal instead would let
# both spellings reach the database, and then every reader (snapshot_engine,
# dividend_engine, and all three clients' `isManualPriced`) would have to learn
# the synonym too. Applied on the way out as well, since AssetResponse inherits
# AssetBase — a legacy row would normalize rather than fail response validation.
PRICING_MODE_ALIASES = {"auto": PRICING_MODE_MARKET}


def normalize_pricing_mode(value: object) -> object:
    """Fold a client's pricing_mode spelling onto the canonical one.

    Non-strings pass through untouched so Pydantic still reports its normal type
    error, and ``None`` keeps meaning "leave this field alone" on an update.
    """
    if not isinstance(value, str):
        return value
    cleaned = value.strip().lower()
    return PRICING_MODE_ALIASES.get(cleaned, cleaned)


class AssetBase(BaseModel):
    ticker: str
    name: str
    type: str
    currency: str
    # "market" = priced from yfinance; "manual" = priced from user-recorded
    # prices (unlisted bonds, Singapore Savings Bonds, ...).
    pricing_mode: Literal["market", "manual"] = PRICING_MODE_MARKET

    @field_validator("pricing_mode", mode="before")
    @classmethod
    def _fold_pricing_mode_aliases(cls, value: object) -> object:
        return normalize_pricing_mode(value)


class AssetCreate(AssetBase):
    id: uuid.UUID


class AssetUpdate(BaseModel):
    ticker: Optional[str] = None
    name: Optional[str] = None
    type: Optional[str] = None
    currency: Optional[str] = None
    pricing_mode: Optional[Literal["market", "manual"]] = None

    @field_validator("pricing_mode", mode="before")
    @classmethod
    def _fold_pricing_mode_aliases(cls, value: object) -> object:
        return normalize_pricing_mode(value)


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
    # True when the window was long enough (>= 1 year) for time_weighted_return
    # and money_weighted_return to be annualized; False when they are the plain
    # period returns over the window. Clients label the stat accordingly —
    # annualizing a two-week window produced the nonsense figures in issue #256.
    annualized: bool = False
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
