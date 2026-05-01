from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from src.database import get_db
from src import schemas

router = APIRouter(prefix="/users", tags=["Users"])


@router.post("/", response_model=schemas.UserCreate)
def create_user(user: schemas.UserCreate, db: Session = Depends(get_db)):
    raise HTTPException(
        status_code=501, detail="User creation logic not yet implemented"
    )


@router.get("/{user_id}", response_model=schemas.UserResponse)
def get_user(user_id: int, db: Session = Depends(get_db)):
    raise HTTPException(status_code=501, detail="Fetch user logic not yet implemented")


@router.put("/{user_id}", response_model=schemas.UserResponse)
def update_user(
    user_id: int, user_update: schemas.UserUpdate, db: Session = Depends(get_db)
):
    raise HTTPException(status_code=501, detail="User update logic not yet implemented")


@router.delete("/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db)):
    raise HTTPException(
        status_code=501, detail="User deletion logic not yet implemented"
    )


@router.post("/households", response_model=schemas.HouseholdResponse)
def create_household(household: schemas.HouseholdCreate, db: Session = Depends(get_db)):
    raise HTTPException(
        status_code=501, detail="Household creation logic not yet implemented"
    )


@router.get("/households/{household_id}", response_model=schemas.HouseholdResponse)
def get_household(household_id: int, db: Session = Depends(get_db)):
    raise HTTPException(
        status_code=501, detail="Fetch household logic not yet implemented"
    )


@router.put("/households/{household_id}", response_model=schemas.HouseholdResponse)
def update_household(
    household_id: int,
    household_update: schemas.HouseholdUpdate,
    db: Session = Depends(get_db),
):
    raise HTTPException(
        status_code=501, detail="Household update logic not yet implemented"
    )


@router.delete("/households/{household_id}")
def delete_household(household_id: int, db: Session = Depends(get_db)):
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
def get_household_member(member_id: int, db: Session = Depends(get_db)):
    raise HTTPException(
        status_code=501, detail="Fetch household member logic not yet implemented"
    )


@router.put(
    "/householdmembers/{member_id}", response_model=schemas.HouseholdMemberResponse
)
def update_household_member(
    member_id: int,
    member_update: schemas.HouseholdMemberUpdate,
    db: Session = Depends(get_db),
):
    raise HTTPException(
        status_code=501, detail="Update household member logic not yet implemented"
    )


@router.delete("/householdmembers/{member_id}")
def remove_household_member(member_id: int, db: Session = Depends(get_db)):
    raise HTTPException(
        status_code=501, detail="Remove household member logic not yet implemented"
    )
