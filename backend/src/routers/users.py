from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
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


@router.post(
    "/", response_model=schemas.UserResponse, status_code=status.HTTP_201_CREATED
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


@router.get("/", response_model=schemas.UserResponse, status_code=status.HTTP_200_OK)
def get_user(
    db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)
):
    user = db.query(models.User).filter(models.User.id == current_user.id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.put("/", response_model=schemas.UserResponse, status_code=status.HTTP_200_OK)
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

    db.commit()
    db.refresh(existing_user)
    return existing_user


@router.delete("/", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)
):
    existing_user = db.query(models.User).filter(models.User.id == user_id).first()
    if not existing_user:
        raise HTTPException(status_code=404, detail="User not found")

    if existing_user.id != current_user.id:
        raise HTTPException(
            status_code=403, detail="You are not authorized to delete this user"
        )

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
    members = (
        db.query(models.HouseholdMember)
        .filter(models.HouseholdMember.household_id == household_id)
        .all()
    )

    result = []
    for m in members:
        user = db.query(models.User).filter(models.User.id == m.user_id).first()
        result.append(
            {
                "id": m.id,
                "user_id": m.user_id,
                "household_id": m.household_id,
                "role": m.role,
                "name": user.name if user else "Unknown",
                "email": user.email if user else "Unknown",
            }
        )
    return result


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

    db.delete(existing_member)
    db.commit()
    return {"detail": "Household member removed successfully"}
