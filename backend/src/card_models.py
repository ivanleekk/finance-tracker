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
    Date,
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

    ``cycle`` follows the card's own statement window; ``calendar_month``,
    ``quarter`` and ``year`` are ordinary calendar periods, which some issuers use
    for caps even on a card whose statement closes mid-month. ``card_year`` and
    ``card_quarter`` count from the card's `anniversary_date` instead — the
    membership year many issuers reset annual caps on.
    """

    cycle = "cycle"
    calendar_month = "calendar_month"
    quarter = "quarter"
    year = "year"
    card_year = "card_year"
    card_quarter = "card_quarter"

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
    # The date the card was opened, which anchors `card_year` and `card_quarter`
    # limits. Optional because most limits never need it; stated by the user and
    # never inferred, like `statement_day`. Only its month and day drive the
    # windows. A full date rather than a month-day pair because it is what the
    # issuer prints, and every client already has a date picker.
    anniversary_date = Column(Date, nullable=True)
    # The percentage this card adds to every foreign charge — a foreign
    # transaction fee. A default, not a rule: `create_transaction` takes it when
    # a foreign charge arrives with no `fee_percent` of its own, and the forms
    # fill it in visibly, so one purchase can still say 0. Only foreign charges,
    # because a standing domestic surcharge is rare and varies by merchant.
    foreign_fee_percent = Column(Numeric, nullable=True)
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
    categories = relationship(
        "CardCategory",
        secondary=lambda: CardLimitCategory.__table__,
        back_populates="limits",
        order_by="CardCategory.sort_order",
    )

    @property
    def category_ids(self) -> list:
        return [c.id for c in self.categories]


class CardLimitCategory(Base):
    """
    Which categories count towards which limit — many to many, both ways.

    One limit spanning several categories was always the point ("the first
    $1,000 across dining and groceries"). The other direction is what this table
    added: one category measured against several limits at once, because an
    issuer's rules routinely stack on the same spend — a monthly minimum to earn
    the bonus *and* an annual cap on it. A single `limit_id` on the category could
    only ever say one of those.

    Both keys cascade. Deleting a limit un-meters its categories rather than
    deleting them, and deleting a category (which the router only allows once no
    transaction is tagged with it) simply stops it counting.
    """

    __tablename__ = "card_limit_categories"

    limit_id = Column(
        UUID(as_uuid=True), ForeignKey("card_limits.id", ondelete="CASCADE"), primary_key=True
    )
    card_category_id = Column(
        UUID(as_uuid=True),
        ForeignKey("card_categories.id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    )


class CardCategory(Base):
    """
    The card's own slicing of spend — "Online", "Overseas", "Everything else".

    User-defined per card and free to cut sideways across the household's
    budgeting categories: a delivery-app dinner is Dining to the budget and
    Online to the card, and the same purchase lands in different card categories
    on two different cards. That is why this is not a subdivision of `Category`.

    A category with no limit is tracked but unmetered, which is useful on its
    own: it answers "where did this card's spending go" before any cap exists.
    It can equally count towards several limits — see `CardLimitCategory`.
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
    # This is a picker used during entry, so the order is a UX decision, not an
    # alphabetical accident.
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    card = relationship("Card", back_populates="categories")
    limits = relationship(
        "CardLimit",
        secondary=lambda: CardLimitCategory.__table__,
        back_populates="categories",
    )