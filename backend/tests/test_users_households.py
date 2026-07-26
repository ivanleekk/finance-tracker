"""Tests for /users: signup, profile CRUD, search, household CRUD, members, invites."""
import uuid

import pytest

from src import models
from src.auth import create_access_token


@pytest.fixture
def user_a(db_session):
    user = models.User(
        id=uuid.uuid7(),
        email="user_a@example.com",
        name="User A",
        salted_hashed_password="x",
        salt="x",
    )
    db_session.add(user)
    db_session.commit()
    return user


@pytest.fixture
def user_b(db_session):
    user = models.User(
        id=uuid.uuid7(),
        email="user_b@example.com",
        name="User B",
        salted_hashed_password="x",
        salt="x",
    )
    db_session.add(user)
    db_session.commit()
    return user


@pytest.fixture
def headers_a(user_a):
    return {"Authorization": f"Bearer {create_access_token(data={'sub': str(user_a.id)})}"}


@pytest.fixture
def headers_b(user_b):
    return {"Authorization": f"Bearer {create_access_token(data={'sub': str(user_b.id)})}"}


@pytest.fixture
def household_a(client, headers_a):
    response = client.post(
        "/users/households",
        headers=headers_a,
        json={"name": "A's Household", "base_currency": "USD", "country_code": "US"},
    )
    assert response.status_code == 201
    return response.json()


# --- Signup / profile ---

def test_signup_creates_user(client):
    response = client.post(
        "/users",
        json={"email": "fresh@example.com", "name": "Fresh", "password": "pw12345!"},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["email"] == "fresh@example.com"
    assert "salted_hashed_password" not in body

    # And the new credentials work
    login = client.post("/auth/token", data={"username": "fresh@example.com", "password": "pw12345!"})
    assert login.status_code == 200


def test_signup_duplicate_email_rejected(client, user_a):
    response = client.post(
        "/users",
        json={"email": user_a.email, "name": "Imposter", "password": "pw12345!"},
    )
    assert response.status_code == 400


def test_get_current_user_profile(client, headers_a, user_a):
    response = client.get("/users", headers=headers_a)
    assert response.status_code == 200
    assert response.json()["email"] == user_a.email


def test_update_user_profile_fields(client, headers_a):
    response = client.put(
        "/users",
        headers=headers_a,
        json={"name": "Renamed", "preferred_timezone": "Asia/Singapore", "theme_mode": "dark"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Renamed"
    assert body["preferred_timezone"] == "Asia/Singapore"
    assert body["theme_mode"] == "dark"


def test_update_user_email_conflict(client, headers_a, user_b):
    response = client.put("/users", headers=headers_a, json={"email": user_b.email})
    assert response.status_code == 400


def test_update_user_default_account(client, headers_a, household_a):
    account = client.post(
        "/accounts/",
        headers=headers_a,
        json={
            "household_id": household_a["id"],
            "name": "Checking",
            "liquidity": "liquid",
            "tax_status": "taxable",
            "currency": "USD",
        },
    ).json()

    response = client.put("/users", headers=headers_a, json={"default_account_id": account["id"]})
    assert response.status_code == 200
    assert response.json()["default_account_id"] == account["id"]

    response = client.put("/users", headers=headers_a, json={"clear_default_account": True})
    assert response.status_code == 200
    assert response.json()["default_account_id"] is None


def test_update_user_default_account_rejects_inaccessible_account(client, headers_a, headers_b, household_a):
    # user_b has no membership in household_a, so its accounts aren't theirs to default to.
    other_household = client.post(
        "/users/households",
        headers=headers_b,
        json={"name": "B's Household", "base_currency": "USD", "country_code": "US"},
    ).json()
    other_account = client.post(
        "/accounts/",
        headers=headers_b,
        json={
            "household_id": other_household["id"],
            "name": "B Checking",
            "liquidity": "liquid",
            "tax_status": "taxable",
            "currency": "USD",
        },
    ).json()

    response = client.put("/users", headers=headers_a, json={"default_account_id": other_account["id"]})
    assert response.status_code == 403


def test_update_user_default_account_rejects_missing_account(client, headers_a):
    response = client.put("/users", headers=headers_a, json={"default_account_id": str(uuid.uuid7())})
    assert response.status_code == 404


def test_update_password_changes_login(client):
    client.post("/users", json={"email": "pwchange@example.com", "name": "PW", "password": "oldpass1!"})
    token = client.post(
        "/auth/token", data={"username": "pwchange@example.com", "password": "oldpass1!"}
    ).json()["access_token"]

    response = client.put(
        "/users",
        headers={"Authorization": f"Bearer {token}"},
        json={"password": "newpass2!"},
    )
    assert response.status_code == 200

    assert client.post(
        "/auth/token", data={"username": "pwchange@example.com", "password": "oldpass1!"}
    ).status_code == 401
    assert client.post(
        "/auth/token", data={"username": "pwchange@example.com", "password": "newpass2!"}
    ).status_code == 200


def test_delete_user(client, headers_a):
    assert client.delete("/users", headers=headers_a).status_code == 204
    # Token now points at a nonexistent user
    assert client.get("/users", headers=headers_a).status_code == 401


def test_search_user_by_email(client, headers_a, user_b):
    response = client.get(f"/users/search?email={user_b.email}", headers=headers_a)
    assert response.status_code == 200
    assert response.json()["email"] == user_b.email

    missing = client.get("/users/search?email=ghost@example.com", headers=headers_a)
    assert missing.status_code == 404


# --- Households ---

def test_create_household_adds_owner_membership(client, headers_a, household_a, db_session, user_a):
    member = (
        db_session.query(models.HouseholdMember)
        .filter(
            models.HouseholdMember.household_id == uuid.UUID(household_a["id"]),
            models.HouseholdMember.user_id == user_a.id,
        )
        .one_or_none()
    )
    assert member is not None
    assert member.role == models.HouseholdRoleType.owner

    listing = client.get("/users/households", headers=headers_a)
    assert listing.status_code == 200
    assert household_a["id"] in [h["id"] for h in listing.json()]


def test_get_household_requires_membership(client, headers_a, headers_b, household_a):
    ok = client.get(f"/users/households/{household_a['id']}", headers=headers_a)
    assert ok.status_code == 200
    assert ok.json()["name"] == "A's Household"

    forbidden = client.get(f"/users/households/{household_a['id']}", headers=headers_b)
    assert forbidden.status_code == 403


def test_update_household(client, headers_a, household_a):
    response = client.put(
        f"/users/households/{household_a['id']}",
        headers=headers_a,
        json={"name": "Renamed Household", "base_currency": "SGD"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Renamed Household"
    assert body["base_currency"] == "SGD"


def test_update_household_requires_editor_role(client, headers_a, headers_b, household_a, user_b, db_session):
    db_session.add(models.HouseholdMember(
        id=uuid.uuid7(),
        household_id=uuid.UUID(household_a["id"]),
        user_id=user_b.id,
        role=models.HouseholdRoleType.viewer,
    ))
    db_session.commit()

    response = client.put(
        f"/users/households/{household_a['id']}",
        headers=headers_b,
        json={"name": "Hostile Rename"},
    )
    assert response.status_code == 403


def test_delete_household_owner_only(client, headers_a, headers_b, household_a, user_b, db_session):
    db_session.add(models.HouseholdMember(
        id=uuid.uuid7(),
        household_id=uuid.UUID(household_a["id"]),
        user_id=user_b.id,
        role=models.HouseholdRoleType.editor,
    ))
    db_session.commit()

    assert client.delete(f"/users/households/{household_a['id']}", headers=headers_b).status_code == 403
    assert client.delete(f"/users/households/{household_a['id']}", headers=headers_a).status_code == 204
    assert client.get(f"/users/households/{household_a['id']}", headers=headers_a).status_code in (403, 404)


# --- Members ---

def test_add_and_list_household_members(client, headers_a, household_a, user_b):
    response = client.post(
        "/users/householdmembers",
        headers=headers_a,
        json={"household_id": household_a["id"], "user_id": str(user_b.id), "role": "viewer"},
    )
    assert response.status_code == 201

    duplicate = client.post(
        "/users/householdmembers",
        headers=headers_a,
        json={"household_id": household_a["id"], "user_id": str(user_b.id), "role": "viewer"},
    )
    assert duplicate.status_code == 400

    listing = client.get(f"/users/householdmember/{household_a['id']}", headers=headers_a)
    assert listing.status_code == 200
    members = listing.json()
    assert len(members) == 2
    by_email = {m["email"]: m for m in members}
    assert by_email["user_b@example.com"]["role"] == "viewer"
    assert by_email["user_a@example.com"]["role"] == "owner"


def test_remove_household_member(client, headers_a, household_a, user_b):
    created = client.post(
        "/users/householdmembers",
        headers=headers_a,
        json={"household_id": household_a["id"], "user_id": str(user_b.id), "role": "viewer"},
    ).json()

    assert client.delete(f"/users/householdmember/{created['id']}", headers=headers_a).status_code == 204
    listing = client.get(f"/users/householdmember/{household_a['id']}", headers=headers_a).json()
    assert len(listing) == 1


# --- Invites ---

def test_invite_pending_then_cancel(client, headers_a, household_a):
    invite = client.post(
        f"/users/households/{household_a['id']}/invites",
        headers=headers_a,
        json={"email": "future@example.com", "role": "editor"},
    )
    assert invite.status_code == 201
    invite_id = invite.json()["id"]

    pending = client.get(f"/users/households/{household_a['id']}/invites", headers=headers_a).json()
    assert [i["id"] for i in pending] == [invite_id]

    # Duplicate pending invite for the same email is rejected
    duplicate = client.post(
        f"/users/households/{household_a['id']}/invites",
        headers=headers_a,
        json={"email": "future@example.com", "role": "editor"},
    )
    assert duplicate.status_code == 400

    resend = client.post(f"/users/invites/{invite_id}/resend", headers=headers_a)
    assert resend.status_code == 200

    assert client.delete(f"/users/invites/{invite_id}", headers=headers_a).status_code == 204
    assert client.get(f"/users/households/{household_a['id']}/invites", headers=headers_a).json() == []


def test_invite_existing_member_rejected(client, headers_a, household_a, user_a):
    response = client.post(
        f"/users/households/{household_a['id']}/invites",
        headers=headers_a,
        json={"email": user_a.email, "role": "editor"},
    )
    assert response.status_code == 400


def test_signup_auto_accepts_pending_invite(client, headers_a, household_a):
    client.post(
        f"/users/households/{household_a['id']}/invites",
        headers=headers_a,
        json={"email": "invited@example.com", "role": "editor"},
    )

    signup = client.post(
        "/users",
        json={"email": "invited@example.com", "name": "Invited", "password": "pw12345!"},
    )
    assert signup.status_code == 201

    members = client.get(f"/users/householdmember/{household_a['id']}", headers=headers_a).json()
    emails = {m["email"] for m in members}
    assert "invited@example.com" in emails
    # Invite no longer pending
    assert client.get(f"/users/households/{household_a['id']}/invites", headers=headers_a).json() == []
