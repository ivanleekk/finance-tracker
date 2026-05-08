import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from src import models, auth
import uuid

def create_test_user(db: Session, email: str):
    salt_hex, hashed_password_hex = auth.hash_password("password123")
    user = models.User(
        id=uuid.uuid7(),
        email=email,
        name="Test User",
        salted_hashed_password=hashed_password_hex,
        salt=salt_hex,
        preferred_timezone="UTC"
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user

def login(client: TestClient, email: str):
    return client.post("/auth/token", data={"username": email, "password": "password123"})

def test_update_household_member_authorization(client: TestClient, db_session: Session):
    # 1. Create two users
    owner = create_test_user(db_session, "owner@example.com")
    member = create_test_user(db_session, "member@example.com")
    attacker = create_test_user(db_session, "attacker@example.com")

    # 2. Owner creates a household
    login_res = login(client, "owner@example.com")
    assert login_res.status_code == 200
    
    res = client.post("/users/households", json={
        "name": "Test Household",
        "base_currency": "USD",
        "country_code": "US"
    })
    assert res.status_code == 201
    household_id = res.json()["id"]

    # 3. Add member to household as viewer
    res = client.post("/users/householdmembers", json={
        "household_id": household_id,
        "user_id": str(member.id),
        "role": "viewer"
    })
    member_record_id = res.json()["id"]

    # 4. Attacker (not in household) tries to upgrade member
    login(client, "attacker@example.com")
    res = client.put(f"/users/householdmember/{member_record_id}", json={"role": "editor"})
    assert res.status_code == 403

    # 5. Member (viewer) tries to upgrade themselves
    login(client, "member@example.com")
    res = client.put(f"/users/householdmember/{member_record_id}", json={"role": "editor"})
    assert res.status_code == 403

    # 6. Owner upgrades member
    login(client, "owner@example.com")
    res = client.put(f"/users/householdmember/{member_record_id}", json={"role": "editor"})
    assert res.status_code == 200
    assert res.json()["role"] == "editor"
