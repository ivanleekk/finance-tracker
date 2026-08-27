"""
Cards, their own spend taxonomy, and the limits measured against it.

Scoping runs entirely through the card's financial account: the account already
carries the household and the private-ownership rule, so a card inherits both
rather than duplicating them. `_visible_card` is the single gate every endpoint
here passes through, which is what keeps this off the list-endpoint trap
documented in AGENTS.md — there is no query that filters on household alone.
"""

from datetime import date, datetime, timezone
from typing import List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from src import models, schemas
from src.auth import get_current_user, verify_household_access, verify_private_owner_visibility
from src.database import get_db
from src.services import card_service

router = APIRouter(prefix="/cards", tags=["Cards"])


def _account_or_404(db: Session, account_id: uuid.UUID) -> models.FinancialAccount:
    account = (
        db.query(models.FinancialAccount)
        .filter(models.FinancialAccount.id == account_id)
        .first()
    )
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return account


def _visible_card(db: Session, card_id: uuid.UUID, user: models.User) -> models.Card:
    """
    Load a card and prove the caller may see it.

    The check is on the account, not the card: a card on somebody else's private
    account is as private as the account, and there is no separate ownership
    concept to get out of step.
    """
    card = (
        db.query(models.Card)
        .options(joinedload(models.Card.categories), joinedload(models.Card.limits))
        .filter(models.Card.id == card_id)
        .first()
    )
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    account = _account_or_404(db, card.financial_account_id)
    verify_household_access(account.household_id, user, db)
    verify_private_owner_visibility(account.owner_user_id, user)
    return card


def _card_response(card: models.Card, account: models.FinancialAccount) -> schemas.CardResponse:
    return schemas.CardResponse(
        id=card.id,
        financial_account_id=card.financial_account_id,
        account_name=account.name,
        currency=account.currency,
        cycle_basis=card.cycle_basis,
        statement_day=card.statement_day,
        categories=[schemas.CardCategoryResponse.model_validate(c) for c in card.categories],
        limits=[schemas.CardLimitResponse.model_validate(l) for l in card.limits],
    )


# --- The card itself ----------------------------------------------------------


@router.post("", response_model=schemas.CardResponse, status_code=status.HTTP_201_CREATED)
def create_card(
    payload: schemas.CardCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    account = _account_or_404(db, payload.financial_account_id)
    verify_household_access(account.household_id, current_user, db)
    verify_private_owner_visibility(account.owner_user_id, current_user)

    if account.kind != models.AccountKind.liability:
        raise HTTPException(
            status_code=400,
            detail="A card can only be set up on a liability account — the card's balance is money owed.",
        )
    if db.query(models.Card).filter(models.Card.financial_account_id == account.id).first():
        raise HTTPException(status_code=409, detail="This account already has a card set up.")

    card = models.Card(
        id=uuid.uuid7(),
        financial_account_id=account.id,
        cycle_basis=models.CycleBasis(payload.cycle_basis),
        statement_day=payload.statement_day,
    )
    db.add(card)
    db.commit()
    db.refresh(card)
    return _card_response(card, account)


@router.get("/household/{household_id}", response_model=List[schemas.CardResponse])
def list_household_cards(
    household_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    verify_household_access(household_id, current_user, db)
    # Joined against the account so the private-ownership predicate is applied
    # in the query rather than after it — the list-endpoint rule.
    rows = (
        db.query(models.Card, models.FinancialAccount)
        .join(models.FinancialAccount, models.Card.financial_account_id == models.FinancialAccount.id)
        .options(joinedload(models.Card.categories), joinedload(models.Card.limits))
        .filter(
            models.FinancialAccount.household_id == household_id,
            (models.FinancialAccount.owner_user_id.is_(None))
            | (models.FinancialAccount.owner_user_id == current_user.id),
        )
        .all()
    )
    return [_card_response(card, account) for card, account in rows]


@router.get("/{card_id}", response_model=schemas.CardResponse)
def get_card(
    card_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    card = _visible_card(db, card_id, current_user)
    return _card_response(card, _account_or_404(db, card.financial_account_id))


@router.put("/{card_id}", response_model=schemas.CardResponse)
def update_card(
    card_id: uuid.UUID,
    payload: schemas.CardUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    card = _visible_card(db, card_id, current_user)
    if payload.cycle_basis is not None:
        card.cycle_basis = models.CycleBasis(payload.cycle_basis)
    if payload.statement_day is not None:
        card.statement_day = payload.statement_day
    db.commit()
    db.refresh(card)
    return _card_response(card, _account_or_404(db, card.financial_account_id))


@router.delete("/{card_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_card(
    card_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    card = _visible_card(db, card_id, current_user)
    tagged = (
        db.query(models.Transaction)
        .join(models.CardCategory, models.Transaction.card_category_id == models.CardCategory.id)
        .filter(models.CardCategory.card_id == card.id)
        .count()
    )
    if tagged:
        raise HTTPException(
            status_code=409,
            detail=(
                f"{tagged} transaction(s) are tagged with this card's categories. "
                "Untag them first, or keep the card and delete its limits instead."
            ),
        )
    db.delete(card)
    db.commit()


# --- Limits -------------------------------------------------------------------


@router.post(
    "/{card_id}/limits",
    response_model=schemas.CardLimitResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_limit(
    card_id: uuid.UUID,
    payload: schemas.CardLimitCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    card = _visible_card(db, card_id, current_user)
    limit = models.CardLimit(
        id=uuid.uuid7(),
        card_id=card.id,
        name=payload.name,
        amount=payload.amount,
        direction=models.LimitDirection(payload.direction),
        reset_basis=models.LimitResetBasis(payload.reset_basis),
    )
    db.add(limit)
    db.commit()
    db.refresh(limit)
    return limit


@router.put("/limits/{limit_id}", response_model=schemas.CardLimitResponse)
def update_limit(
    limit_id: uuid.UUID,
    payload: schemas.CardLimitUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    limit = db.query(models.CardLimit).filter(models.CardLimit.id == limit_id).first()
    if not limit:
        raise HTTPException(status_code=404, detail="Limit not found")
    _visible_card(db, limit.card_id, current_user)

    if payload.name is not None:
        limit.name = payload.name
    if payload.amount is not None:
        limit.amount = payload.amount
    if payload.direction is not None:
        limit.direction = models.LimitDirection(payload.direction)
    if payload.reset_basis is not None:
        limit.reset_basis = models.LimitResetBasis(payload.reset_basis)
    db.commit()
    db.refresh(limit)
    return limit


@router.delete("/limits/{limit_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_limit(
    limit_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    limit = db.query(models.CardLimit).filter(models.CardLimit.id == limit_id).first()
    if not limit:
        raise HTTPException(status_code=404, detail="Limit not found")
    _visible_card(db, limit.card_id, current_user)
    # Categories pointing at it are left in place and simply become unmetered —
    # the FK is ON DELETE SET NULL. Deleting a cap should not delete the user's
    # taxonomy along with it.
    db.delete(limit)
    db.commit()


# --- Categories ---------------------------------------------------------------


def _clear_other_defaults(db: Session, card_id: uuid.UUID, keep: uuid.UUID) -> None:
    """
    Exactly one default per card. Enforced here rather than by a constraint:
    "exactly one true" needs a partial unique index the ORM would not maintain,
    and the write path is narrow enough that one place can own the rule.
    """
    (
        db.query(models.CardCategory)
        .filter(models.CardCategory.card_id == card_id, models.CardCategory.id != keep)
        .update({models.CardCategory.is_default: False}, synchronize_session=False)
    )


@router.post(
    "/{card_id}/categories",
    response_model=schemas.CardCategoryResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_category(
    card_id: uuid.UUID,
    payload: schemas.CardCategoryCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    card = _visible_card(db, card_id, current_user)
    if any(c.name.lower() == payload.name.lower() for c in card.categories):
        raise HTTPException(status_code=409, detail="This card already has a category with that name.")
    if payload.limit_id and not any(l.id == payload.limit_id for l in card.limits):
        raise HTTPException(status_code=400, detail="That limit belongs to a different card.")

    # The first category on a card is the default whether or not the caller said
    # so — untagged spend has to land somewhere from the very first transaction.
    is_default = payload.is_default or not card.categories

    category = models.CardCategory(
        id=uuid.uuid7(),
        card_id=card.id,
        name=payload.name,
        is_default=is_default,
        limit_id=payload.limit_id,
        sort_order=payload.sort_order,
    )
    db.add(category)
    db.flush()
    if is_default:
        _clear_other_defaults(db, card.id, category.id)
    db.commit()
    db.refresh(category)
    return category


@router.put("/categories/{category_id}", response_model=schemas.CardCategoryResponse)
def update_category(
    category_id: uuid.UUID,
    payload: schemas.CardCategoryUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    category = db.query(models.CardCategory).filter(models.CardCategory.id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="Card category not found")
    card = _visible_card(db, category.card_id, current_user)

    fields = payload.model_dump(exclude_unset=True)
    if "name" in fields and fields["name"] is not None:
        if any(c.id != category.id and c.name.lower() == fields["name"].lower() for c in card.categories):
            raise HTTPException(status_code=409, detail="This card already has a category with that name.")
        category.name = fields["name"]
    if "sort_order" in fields and fields["sort_order"] is not None:
        category.sort_order = fields["sort_order"]
    # Omitted leaves the limit alone; an explicit null detaches it and makes the
    # category tracked but unmetered.
    if "limit_id" in fields:
        if fields["limit_id"] is not None and not any(l.id == fields["limit_id"] for l in card.limits):
            raise HTTPException(status_code=400, detail="That limit belongs to a different card.")
        category.limit_id = fields["limit_id"]
    if fields.get("is_default"):
        category.is_default = True
        _clear_other_defaults(db, card.id, category.id)

    db.commit()
    db.refresh(category)
    return category


@router.delete("/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(
    category_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    category = db.query(models.CardCategory).filter(models.CardCategory.id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="Card category not found")
    card = _visible_card(db, category.card_id, current_user)

    # 409 with an explanation rather than letting the FK trip into a 500 — the
    # same treatment deleting a category still used by a recurring rule gets.
    in_use = (
        db.query(models.Transaction)
        .filter(models.Transaction.card_category_id == category.id)
        .count()
    )
    if in_use:
        raise HTTPException(
            status_code=409,
            detail=f"{in_use} transaction(s) are tagged with this category. Retag them before deleting it.",
        )
    if category.is_default and len(card.categories) > 1:
        raise HTTPException(
            status_code=409,
            detail="This is the card's default category. Make another category the default first.",
        )
    db.delete(category)
    db.commit()


# --- The meter ----------------------------------------------------------------


@router.get("/{card_id}/status", response_model=schemas.CardStatusResponse)
def get_card_status(
    card_id: uuid.UUID,
    on: Optional[date] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Every limit on this card with the current window's spend, plus where the
    cycle's spending went by category.

    `on` exists so a client can look at a past cycle; it defaults to today.
    """
    card = _visible_card(db, card_id, current_user)
    account = _account_or_404(db, card.financial_account_id)
    on = on or datetime.now(timezone.utc).date()

    statuses = card_service.card_limit_statuses(db, card, on=on)
    cycle_start, cycle_end, breakdown = card_service.card_category_breakdown(db, card, on=on)

    return schemas.CardStatusResponse(
        card_id=card.id,
        account_name=account.name,
        currency=account.currency,
        cycle_start=cycle_start,
        cycle_end=cycle_end,
        limits=[
            schemas.CardLimitStatusRow(
                limit_id=s.limit.id,
                name=s.limit.name,
                category_names=s.category_names,
                direction=s.limit.direction,
                amount=s.amount,
                spent=s.spent,
                remaining=s.remaining,
                percent_used=s.percent_used,
                period_start=s.period_start,
                period_end=s.period_end,
                days_elapsed=s.days_elapsed,
                days_total=s.days_total,
                projected_spend=s.projected_spend,
                projected_missed=s.projected_missed,
                settled=s.settled,
            )
            for s in statuses
        ],
        categories=[
            schemas.CardCategorySpendRow(
                card_category_id=row.category.id, name=row.category.name, spent=row.spent
            )
            for row in breakdown
        ],
    )
