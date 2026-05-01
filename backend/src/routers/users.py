from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
from src.database import get_db
from src import schemas, models
import hashlib
import os
import secrets
import uuid

router = APIRouter(prefix="/users", tags=["Users"])


def hash_password(password: str, salt: Optional[bytes] = None) -> tuple[str, str]:
    """
    Hashes a password using scrypt.
    Returns a tuple of (salt_hex, hash_hex) for database storage.
    """
    # 1. Generate a secure, 16-byte random salt if one isn't provided
    if salt is None:
        salt = os.urandom(16)

    # 2. Perform the scrypt hashing
    # n: CPU/Memory cost parameter (must be power of 2). 32768 is a strong default.
    # r: Block size parameter. 8 is standard.
    # p: Parallelization parameter. 1 is standard.
    key = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16384, r=8, p=1)

    # 3. Return the salt and the hash converted to hex strings
    return salt.hex(), key.hex()


def verify_password(
    plain_password: str, stored_salt_hex: str, stored_hash_hex: str
) -> bool:
    """
    Verifies a plain password against the stored salt and hash.
    """
    # Convert the stored hex salt back to bytes
    salt_bytes = bytes.fromhex(stored_salt_hex)

    # Hash the incoming password with the exact same salt
    _, computed_hash_hex = hash_password(plain_password, salt=salt_bytes)

    # Use secrets.compare_digest to prevent timing attacks
    return secrets.compare_digest(computed_hash_hex, stored_hash_hex)


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
        id = uuid.uuid7(),
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


@router.get(
    "/{user_id}", response_model=schemas.UserResponse, status_code=status.HTTP_200_OK
)
def get_user(user_id: uuid.UUID, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.put(
    "/{user_id}", response_model=schemas.UserResponse, status_code=status.HTTP_200_OK
)
def update_user(
    user_id: uuid.UUID, user_update: schemas.UserUpdate, db: Session = Depends(get_db)
):
    existing_user = db.query(models.User).filter(models.User.id == user_id).first()
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


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(user_id: uuid.UUID, db: Session = Depends(get_db)):
    existing_user = db.query(models.User).filter(models.User.id == user_id).first()
    if not existing_user:
        raise HTTPException(status_code=404, detail="User not found")
    db.delete(existing_user)
    db.commit()
    return {"detail": "User deleted successfully"}


@router.post("/households", response_model=schemas.HouseholdResponse)
def create_household(household: schemas.HouseholdCreate, db: Session = Depends(get_db)):
    raise HTTPException(
        status_code=501, detail="Household creation logic not yet implemented"
    )


@router.get("/households/{household_id}", response_model=schemas.HouseholdResponse)
def get_household(household_id: uuid.UUID, db: Session = Depends(get_db)):
    raise HTTPException(
        status_code=501, detail="Fetch household logic not yet implemented"
    )


@router.put("/households/{household_id}", response_model=schemas.HouseholdResponse)
def update_household(
    household_id: uuid.UUID,
    household_update: schemas.HouseholdUpdate,
    db: Session = Depends(get_db),
):
    raise HTTPException(
        status_code=501, detail="Household update logic not yet implemented"
    )


@router.delete("/households/{household_id}")
def delete_household(household_id: uuid.UUID, db: Session = Depends(get_db)):
    raise HTTPException(
        status_code=501, detail="Household deletion logic not yet implemented"
    )


@router.post("/householdmembers", response_model=schemas.HouseholdMemberResponse)
def add_household_member(
    member: schemas.HouseholdMemberCreate, db: Session = Depends(get_db)
):
    raise HTTPException(
        status_code=501, detail="Add household member logic not yet implemented"
    )


@router.get(
    "/householdmembers/{member_id}", response_model=schemas.HouseholdMemberResponse
)
def get_household_member(member_id: uuid.UUID, db: Session = Depends(get_db)):
    raise HTTPException(
        status_code=501, detail="Fetch household member logic not yet implemented"
    )


@router.put(
    "/householdmembers/{member_id}", response_model=schemas.HouseholdMemberResponse
)
def update_household_member(
    member_id: uuid.UUID,
    member_update: schemas.HouseholdMemberUpdate,
    db: Session = Depends(get_db),
):
    raise HTTPException(
        status_code=501, detail="Update household member logic not yet implemented"
    )


@router.delete("/householdmembers/{member_id}")
def remove_household_member(member_id: uuid.UUID, db: Session = Depends(get_db)):
    raise HTTPException(
        status_code=501, detail="Remove household member logic not yet implemented"
    )
