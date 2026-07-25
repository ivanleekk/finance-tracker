from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timezone
from src.database import get_db
from src import schemas, models
from src.auth import (
    hash_password,
    verify_password,
    get_current_user,
    verify_household_access,
)
import uuid

router = APIRouter(prefix="/users", tags=["Users"])


def _is_household_owner(db: Session, household_id: uuid.UUID, user: models.User) -> bool:
    """True if the user is the household's real owner (owners_id on the household)."""
    household = (
        db.query(models.Household).filter(models.Household.id == household_id).first()
    )
    return bool(household and household.owner_id == user.id)


def _guard_owner_role_change(
    db: Session,
    household_id: uuid.UUID,
    current_user: models.User,
    *,
    target_role=None,
    target_user_id=None,
) -> None:
    """Blocks privilege escalation around the ``owner`` role.

    Only the household's real owner may hand out the ``owner`` role or touch the
    owner's own membership row. Without this, any editor (who passes the
    owner/editor role gate on these endpoints) could promote themselves to owner
    or demote the real owner.
    """
    caller_is_owner = _is_household_owner(db, household_id, current_user)
    if target_role is not None and target_role == models.HouseholdRoleType.owner and not caller_is_owner:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the household owner can assign the owner role",
        )
    if target_user_id is not None and not caller_is_owner:
        household = (
            db.query(models.Household).filter(models.Household.id == household_id).first()
        )
        if household and household.owner_id == target_user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the household owner can modify the owner's membership",
            )


def resolve_pending_invites(db: Session, user: models.User) -> None:
    """Auto-accepts any pending household invites matching this user's email
    (e.g. someone was invited before they had an account, or before they logged in)."""
    pending = (
        db.query(models.HouseholdInvite)
        .filter(
            models.HouseholdInvite.email == user.email,
            models.HouseholdInvite.status == models.HouseholdInviteStatus.pending,
        )
        .all()
    )
    for invite in pending:
        already_member = (
            db.query(models.HouseholdMember)
            .filter(
                models.HouseholdMember.user_id == user.id,
                models.HouseholdMember.household_id == invite.household_id,
            )
            .first()
        )
        if not already_member:
            db.add(models.HouseholdMember(
                id=uuid.uuid7(),
                household_id=invite.household_id,
                user_id=user.id,
                role=invite.role,
            ))
        invite.status = models.HouseholdInviteStatus.accepted
    if pending:
        db.commit()


@router.post(
    "", response_model=schemas.UserResponse, status_code=status.HTTP_201_CREATED
)
def create_user(user: schemas.UserCreate, db: Session = Depends(get_db)):

    # 1. Verify the user doesn't already exist
    existing_user = (
        db.query(models.User).filter(models.User.email == user.email).first()
    )
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")

    # 2. Hash the incoming plaintext password
    salt_hex, hashed_password_hex = hash_password(user.password)

    # 3. Create the SQLAlchemy Database Model instance (NOT the Pydantic schema)
    # Ensure your models.User matches these column names
    db_user = models.User(
        id=uuid.uuid7(),
        email=user.email,
        preferred_timezone=user.preferred_timezone,
        salted_hashed_password=hashed_password_hex,
        name=user.name,
        salt=salt_hex,
    )

    # 4. Save to the database
    db.add(db_user)
    db.commit()
    db.refresh(db_user)

    # 5. Auto-join any household this email was already invited to
    resolve_pending_invites(db, db_user)

    return db_user


@router.get("/search", response_model=schemas.UserResponse)
def search_user_by_email(
    email: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    user = db.query(models.User).filter(models.User.email == email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.get("", response_model=schemas.UserResponse, status_code=status.HTTP_200_OK)
def get_user(
    db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)
):
    user = db.query(models.User).filter(models.User.id == current_user.id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.put("", response_model=schemas.UserResponse, status_code=status.HTTP_200_OK)
def update_user(
    user_update: schemas.UserUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    existing_user = (
        db.query(models.User).filter(models.User.id == current_user.id).first()
    )
    if not existing_user:
        raise HTTPException(status_code=404, detail="User not found")

    if user_update.password:
        # If password is being updated, hash the new password
        salt_hex, hashed_password_hex = hash_password(user_update.password)
        existing_user.salt = salt_hex
        existing_user.salted_hashed_password = hashed_password_hex

    if user_update.preferred_timezone is not None:
        existing_user.preferred_timezone = user_update.preferred_timezone
    if user_update.name is not None:
        existing_user.name = user_update.name
    
    if user_update.theme_mode is not None:
        existing_user.theme_mode = user_update.theme_mode
    if user_update.primary_color is not None:
        existing_user.primary_color = user_update.primary_color
    if user_update.secondary_color is not None:
        existing_user.secondary_color = user_update.secondary_color
    if user_update.base_color is not None:
        existing_user.base_color = user_update.base_color
    if user_update.hide_private_from_household is not None:
        existing_user.hide_private_from_household = user_update.hide_private_from_household
    if user_update.require_face_id_for_vault is not None:
        existing_user.require_face_id_for_vault = user_update.require_face_id_for_vault
    if user_update.default_new_items_private is not None:
        existing_user.default_new_items_private = user_update.default_new_items_private

    if user_update.email is not None:
        # Check if the new email is already taken by another user
        duplicate_user = db.query(models.User).filter(models.User.email == user_update.email, models.User.id != current_user.id).first()
        if duplicate_user:
            raise HTTPException(status_code=400, detail="Email already registered by another user")
        existing_user.email = user_update.email

    db.commit()
    db.refresh(existing_user)
    return existing_user


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)
):
    existing_user = db.query(models.User).filter(models.User.id == current_user.id).first()
    if not existing_user:
        raise HTTPException(status_code=404, detail="User not found")

    db.delete(existing_user)
    db.commit()
    return {"detail": "User deleted successfully"}


@router.post(
    "/households",
    response_model=schemas.HouseholdResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_household(
    household: schemas.HouseholdCreate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    new_household = models.Household(
        id=uuid.uuid7(),
        name=household.name,
        base_currency=household.base_currency,
        country_code=household.country_code,
        owner_id=current_user.id,
        default_split_mode=household.default_split_mode,
        emergency_fund_target_months=household.emergency_fund_target_months,
    )
    db.add(new_household)
    db.commit()
    db.refresh(new_household)
    add_household_member(
        schemas.HouseholdMemberCreate(
            household_id=new_household.id, user_id=current_user.id, role="owner"
        ),
        db=db,
        current_user=current_user,
    )
    return new_household


@router.get(
    "/households",
    response_model=List[schemas.HouseholdResponse],
    status_code=status.HTTP_200_OK,
)
def get_user_households(
    db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)
):
    households = (
        db.query(models.Household)
        .join(
            models.HouseholdMember,
            models.Household.id == models.HouseholdMember.household_id,
        )
        .filter(models.HouseholdMember.user_id == current_user.id)
        .all()
    )
    return households


@router.get(
    "/households/{household_id}",
    response_model=schemas.HouseholdResponse,
    status_code=status.HTTP_200_OK,
)
def get_household(
    household_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    # should raise error if not authorised
    verify_household_access(household_id, current_user, db)

    existing_household = (
        db.query(models.Household).filter(models.Household.id == household_id).first()
    )
    if not existing_household:
        raise HTTPException(status_code=404, detail="Household not found")
    return existing_household


@router.put(
    "/households/{household_id}",
    response_model=schemas.HouseholdResponse,
    status_code=status.HTTP_200_OK,
)
def update_household(
    household_id: uuid.UUID,
    household_update: schemas.HouseholdUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    # should raise error if not authorised
    verify_household_access(
        household_id, current_user, db, required_roles=[models.HouseholdRoleType.owner, models.HouseholdRoleType.editor]
    )

    existing_household = (
        db.query(models.Household).filter(models.Household.id == household_id).first()
    )
    if not existing_household:
        raise HTTPException(status_code=404, detail="Household not found")

    if household_update.name is not None:
        existing_household.name = household_update.name
    if household_update.base_currency is not None:
        existing_household.base_currency = household_update.base_currency
    if household_update.country_code is not None:
        existing_household.country_code = household_update.country_code
    if household_update.default_funding_account_id is not None:
        existing_household.default_funding_account_id = household_update.default_funding_account_id
    if household_update.default_sub_portfolio_id is not None:
        existing_household.default_sub_portfolio_id = household_update.default_sub_portfolio_id
    if household_update.default_split_mode is not None:
        existing_household.default_split_mode = household_update.default_split_mode
    if household_update.emergency_fund_target_months is not None:
        existing_household.emergency_fund_target_months = household_update.emergency_fund_target_months

    db.commit()
    db.refresh(existing_household)
    return existing_household



@router.delete("/households/{household_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_household(
    household_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    verify_household_access(household_id, current_user, db, required_roles=["owner"])

    existing_household = (
        db.query(models.Household).filter(models.Household.id == household_id).first()
    )
    if not existing_household:
        raise HTTPException(status_code=404, detail="Household not found")
    db.delete(existing_household)
    db.commit()
    return {"detail": "Household deleted successfully"}


@router.post(
    "/householdmembers",
    response_model=schemas.HouseholdMemberResponse,
    status_code=status.HTTP_201_CREATED,
)
def add_household_member(
    member: schemas.HouseholdMemberCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    # should raise error if not authorised
    verify_household_access(
        member.household_id, current_user, db, required_roles=[models.HouseholdRoleType.owner, models.HouseholdRoleType.editor]
    )
    _guard_owner_role_change(db, member.household_id, current_user, target_role=member.role)

    # check if user already exists in this specific household
    existing_member = (
        db.query(models.HouseholdMember)
        .filter(
            models.HouseholdMember.user_id == member.user_id,
            models.HouseholdMember.household_id == member.household_id
        )
        .first()
    )
    if existing_member:
        raise HTTPException(status_code=400, detail="User already exists in household")

    new_member = models.HouseholdMember(
        id=uuid.uuid7(),
        household_id=member.household_id,
        user_id=member.user_id,
        role=member.role,
    )
    db.add(new_member)
    db.commit()
    db.refresh(new_member)
    return new_member


@router.get(
    "/householdmember/{household_id}",
    response_model=List[schemas.HouseholdMemberUserResponse],
    status_code=status.HTTP_200_OK,
)
def get_all_household_members(
    household_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    verify_household_access(household_id, current_user, db)
    rows = (
        db.query(models.HouseholdMember, models.User)
        .outerjoin(models.User, models.User.id == models.HouseholdMember.user_id)
        .filter(models.HouseholdMember.household_id == household_id)
        .all()
    )

    return [
        {
            "id": m.id,
            "user_id": m.user_id,
            "household_id": m.household_id,
            "role": m.role,
            "name": user.name if user else "Unknown",
            "email": user.email if user else "Unknown",
        }
        for m, user in rows
    ]


@router.get(
    "/householdmember/{member_id}",
    response_model=schemas.HouseholdMemberResponse,
    status_code=status.HTTP_200_OK,
)
def get_household_member(
    member_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):

    existing_member = (
        db.query(models.HouseholdMember)
        .filter(models.HouseholdMember.id == member_id)
        .first()
    )
    if not existing_member:
        raise HTTPException(status_code=404, detail="Household member not found")

    verify_household_access(
        existing_member.household_id, current_user, db, required_roles=[models.HouseholdRoleType.owner, models.HouseholdRoleType.editor]
    )

    return existing_member


@router.put(
    "/householdmember/{member_id}",
    response_model=schemas.HouseholdMemberResponse,
    status_code=status.HTTP_200_OK,
)
def update_household_member(
    member_id: uuid.UUID,
    member_update: schemas.HouseholdMemberUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    existing_member = (
        db.query(models.HouseholdMember)
        .filter(models.HouseholdMember.id == member_id)
        .first()
    )
    if not existing_member:
        raise HTTPException(status_code=404, detail="Household member not found")

    verify_household_access(
        existing_member.household_id, current_user, db, required_roles=[models.HouseholdRoleType.owner, models.HouseholdRoleType.editor]
    )
    _guard_owner_role_change(
        db,
        existing_member.household_id,
        current_user,
        target_role=member_update.role,
        target_user_id=existing_member.user_id,
    )

    existing_member.role = member_update.role
    db.commit()
    db.refresh(existing_member)
    return existing_member


@router.delete("/householdmember/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_household_member(
    member_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    existing_member = (
        db.query(models.HouseholdMember)
        .filter(models.HouseholdMember.id == member_id)
        .first()
    )
    if not existing_member:
        raise HTTPException(status_code=404, detail="Household member not found")

    verify_household_access(
        existing_member.household_id, current_user, db, required_roles=[models.HouseholdRoleType.owner, models.HouseholdRoleType.editor]
    )
    # The household owner's own membership can't be deleted out from under them
    # by another member (that would orphan the household).
    _guard_owner_role_change(
        db,
        existing_member.household_id,
        current_user,
        target_user_id=existing_member.user_id,
    )

    db.delete(existing_member)
    db.commit()
    return {"detail": "Household member removed successfully"}


# --- HOUSEHOLD INVITES ---


@router.post(
    "/households/{household_id}/invites",
    response_model=schemas.HouseholdInviteResponse,
    status_code=status.HTTP_201_CREATED,
)
def invite_household_member(
    household_id: uuid.UUID,
    invite: schemas.HouseholdInviteCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    verify_household_access(
        household_id, current_user, db, required_roles=[models.HouseholdRoleType.owner, models.HouseholdRoleType.editor]
    )
    _guard_owner_role_change(db, household_id, current_user, target_role=invite.role)

    existing_user = db.query(models.User).filter(models.User.email == invite.email).first()
    if existing_user:
        already_member = (
            db.query(models.HouseholdMember)
            .filter(
                models.HouseholdMember.user_id == existing_user.id,
                models.HouseholdMember.household_id == household_id,
            )
            .first()
        )
        if already_member:
            raise HTTPException(status_code=400, detail="User already in household")

    existing_invite = (
        db.query(models.HouseholdInvite)
        .filter(
            models.HouseholdInvite.household_id == household_id,
            models.HouseholdInvite.email == invite.email,
            models.HouseholdInvite.status == models.HouseholdInviteStatus.pending,
        )
        .first()
    )
    if existing_invite:
        raise HTTPException(status_code=400, detail="An invite is already pending for this email")

    new_invite = models.HouseholdInvite(
        id=uuid.uuid7(),
        household_id=household_id,
        email=invite.email,
        role=invite.role,
        invited_by_user_id=current_user.id,
        status=models.HouseholdInviteStatus.pending,
    )
    db.add(new_invite)
    db.commit()
    db.refresh(new_invite)

    # If the invited email already belongs to a user, join them immediately.
    if existing_user:
        resolve_pending_invites(db, existing_user)
        db.refresh(new_invite)

    return new_invite


@router.get(
    "/households/{household_id}/invites",
    response_model=List[schemas.HouseholdInviteResponse],
    status_code=status.HTTP_200_OK,
)
def get_household_invites(
    household_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    verify_household_access(household_id, current_user, db)
    return (
        db.query(models.HouseholdInvite)
        .filter(
            models.HouseholdInvite.household_id == household_id,
            models.HouseholdInvite.status == models.HouseholdInviteStatus.pending,
        )
        .all()
    )


@router.post(
    "/invites/{invite_id}/resend",
    response_model=schemas.HouseholdInviteResponse,
    status_code=status.HTTP_200_OK,
)
def resend_household_invite(
    invite_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    invite = db.query(models.HouseholdInvite).filter(models.HouseholdInvite.id == invite_id).first()
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    verify_household_access(
        invite.household_id, current_user, db, required_roles=[models.HouseholdRoleType.owner, models.HouseholdRoleType.editor]
    )
    invite.created_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(invite)
    return invite


@router.delete("/invites/{invite_id}", status_code=status.HTTP_204_NO_CONTENT)
def cancel_household_invite(
    invite_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    invite = db.query(models.HouseholdInvite).filter(models.HouseholdInvite.id == invite_id).first()
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    verify_household_access(
        invite.household_id, current_user, db, required_roles=[models.HouseholdRoleType.owner, models.HouseholdRoleType.editor]
    )
    db.delete(invite)
    db.commit()
    return


# --- DEFAULT EXPENSE SPLIT ---


@router.put(
    "/households/{household_id}/split-shares",
    response_model=List[schemas.HouseholdSplitShareResponse],
    status_code=status.HTTP_200_OK,
)
def set_household_split_shares(
    household_id: uuid.UUID,
    shares: List[schemas.HouseholdSplitShareCreate],
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    verify_household_access(
        household_id, current_user, db, required_roles=[models.HouseholdRoleType.owner, models.HouseholdRoleType.editor]
    )
    db.query(models.HouseholdSplitShare).filter(
        models.HouseholdSplitShare.household_id == household_id
    ).delete()
    new_rows = [
        models.HouseholdSplitShare(
            id=uuid.uuid7(),
            household_id=household_id,
            user_id=share.user_id,
            share_percent=share.share_percent,
        )
        for share in shares
    ]
    db.add_all(new_rows)
    db.commit()
    return (
        db.query(models.HouseholdSplitShare)
        .filter(models.HouseholdSplitShare.household_id == household_id)
        .all()
    )


@router.get(
    "/households/{household_id}/split-shares",
    response_model=List[schemas.HouseholdSplitShareResponse],
    status_code=status.HTTP_200_OK,
)
def get_household_split_shares(
    household_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    verify_household_access(household_id, current_user, db)
    return (
        db.query(models.HouseholdSplitShare)
        .filter(models.HouseholdSplitShare.household_id == household_id)
        .all()
    )
