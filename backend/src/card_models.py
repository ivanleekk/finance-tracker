"""
Cards, their own spend taxonomy, and the limits measured against them.

Split out of `models.py` rather than appended to it: cards are a self-contained
subdomain (three tables and three enums that nothing outside them declares), and
adding them inline pushed that module past 1,100 lines. Everything is still
reachable as `models.Card` — `models.py` re-exports these names, which is also
what guarantees they are registered on `Base.metadata` before Alembic looks at
it.

Relationships to tables declared in `models.py` are resolved by class name
through SQLAlchemy's registry, so there is no import back the other way and no
cycle.
"""

import enum
import uuid

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.database import Base


class CycleBasis(enum.Enum):
    """
    Which clock a card's spend limits reset on.

    Stated per card, never inferred. A card closing on the 18th usually runs its
    "month" from the 19th to the 18th, but some issuers reset bonus caps on the
    calendar month regardless of when the statement closes, and nothing about the
    statement date tells you which. Getting this wrong is silent: every meter is
    simply measured over the wrong window.
    """

    statement = "statement"
    calendar = "calendar"


class LimitDirection(enum.Enum):
    """
    Which side of the number the user wants to be on.

    A ceiling is a bonus cap — "the first $1,000 of dining earns the higher
    rate" — and the useful reading is the headroom left. A floor is a minimum
    spend — "spend $800 this cycle to keep the fee waived" — and the useful
    reading is how much is still needed. Same sum over the same window; only the
    comparison and the wording change, which is why this is a flag on the limit
    rather than a second concept.
    """

    ceiling = "ceiling"
    floor = "floor"


class LimitResetBasis(enum.Enum):
    """
    How often a card limit starts over.

    ``cycle`` follows the card's own statement window; the rest are ordinary
    calendar periods, which some issuers use for caps even on a card whose
    statement closes mid-month.
    """

    cycle = "cycle"
    calendar_month = "calendar_month"
    quarter = "quarter"
    year = "year"

# --- CARD SPEND LIMITS ---
#
# A card's own slicing of its spending, metered against that card's cycle. This
# is deliberately Budgets re-parameterised rather than an extension of it: same
# rollup, same pace projection, same tone, but a different clock (the statement
# window) and a card-scoped taxonomy instead of the household's shared one.
#
# Reusing `Budget` directly was considered and rejected. Its categories are the
# household's shared ones, and `BudgetCategory` enforces that a category belongs
# to at most one budget per owner scope — both wrong here, because a card
# category cuts *across* budget categories and several cards can slice the same
# spending differently.


class Card(Base):
    """
    Cycle behaviour attached to a liability account that already exists.

    Deliberately not a card "profile": there is no name or issuer column,
    because the account already carries the name the user typed and a second one
    would only drift out of step with it. What lives here is the thing an
    account cannot express — when this card's spending starts over.
    """

    __tablename__ = "cards"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, index=True, default=uuid.uuid7)
    # One card per account. The account supplies the name, currency, household
    # and private-ownership rule, so everything downstream scopes through it
    # rather than duplicating those columns here.
    financial_account_id = Column(
        UUID(as_uuid=True),
        ForeignKey("financial_accounts.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    cycle_basis = Column(
        Enum(CycleBasis, native_enum=False), nullable=False, default=CycleBasis.statement
    )
    # The day the statement closes, 1-31, clamped to the end of shorter months
    # so a card closing on the 31st still closes in February. Unused when
    # cycle_basis is `calendar`, but kept rather than nulled: switching basis
    # back and forth must not lose the number the user already entered.
    statement_day = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    account = relationship("FinancialAccount")
    categories = relationship(
        "CardCategory",
        back_populates="card",
        cascade="all, delete-orphan",
        order_by="CardCategory.sort_order",
    )
    limits = relationship("CardLimit", back_populates="card", cascade="all, delete-orphan")


class CardLimit(Base):
    """
    A number this card's spending is measured against.

    Its own row rather than a column on the category, because a single limit is
    routinely shared: "the first $1,000 across dining and groceries" is one cap
    that several categories draw down together. A column would have forced that
    to be modelled as two independent caps, which measures it wrong.

    Always denominated in currency. A cap the issuer states in rewards ("max $60
    cashback") has to be converted by the user, because nothing here knows a
    rate — that was the scope cut that made this feature buildable at all.
    """

    __tablename__ = "card_limits"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, index=True, default=uuid.uuid7)
    card_id = Column(UUID(as_uuid=True), ForeignKey("cards.id", ondelete="CASCADE"), nullable=False, index=True)
    # Shown on the meter, and the only way to tell two shared limits apart.
    name = Column(String, nullable=False)
    amount = Column(Numeric, nullable=False)
    direction = Column(
        Enum(LimitDirection, native_enum=False), nullable=False, default=LimitDirection.ceiling
    )
    reset_basis = Column(
        Enum(LimitResetBasis, native_enum=False), nullable=False, default=LimitResetBasis.cycle
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    card = relationship("Card", back_populates="limits")
    categories = relationship("CardCategory", back_populates="limit")


class CardCategory(Base):
    """
    The card's own slicing of spend — "Online", "Overseas", "Everything else".

    User-defined per card and free to cut sideways across the household's
    budgeting categories: a delivery-app dinner is Dining to the budget and
    Online to the card, and the same purchase lands in different card categories
    on two different cards. That is why this is not a subdivision of `Category`.

    A category with no limit is tracked but unmetered, which is useful on its
    own: it answers "where did this card's spending go" before any cap exists.
    """

    __tablename__ = "card_categories"
    __table_args__ = (
        UniqueConstraint("card_id", "name", name="uq_card_category_card_name"),
    )

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, index=True, default=uuid.uuid7)
    card_id = Column(UUID(as_uuid=True), ForeignKey("cards.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String, nullable=False)
    # Where spend on this card lands when the user didn't pick anything. Exactly
    # one per card; enforced in the service rather than by a constraint, because
    # "exactly one true" is not expressible as a unique index without a partial
    # index the ORM would not maintain on its own.
    is_default = Column(Boolean, nullable=False, default=False)
    # Nullable: no limit means tracked but unmetered. ON DELETE SET NULL so
    # removing a limit leaves its categories in place rather than taking the
    # card's taxonomy down with it.
    limit_id = Column(
        UUID(as_uuid=True), ForeignKey("card_limits.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # This is a picker used during entry, so the order is a UX decision, not an
    # alphabetical accident.
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    card = relationship("Card", back_populates="categories")
    limit = relationship("CardLimit", back_populates="categories")