import uuid
import pytest
from src import models


@pytest.fixture
def owner_user(db_session):
    user = models.User(
        id=uuid.uuid7(),
        email="owner_own@example.com",
        name="Owner User",
        salted_hashed_password="fakehash",
        salt="fakesalt",
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def owner_auth_headers(owner_user):
    from src.auth import create_access_token
    token = create_access_token(data={"sub": str(owner_user.id)})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def member_user(db_session):
    user = models.User(
        id=uuid.uuid7(),
        email="member_own@example.com",
        name="Member User",
        salted_hashed_password="fakehash",
        salt="fakesalt",
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def member_auth_headers(member_user):
    from src.auth import create_access_token
    token = create_access_token(data={"sub": str(member_user.id)})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def household(db_session, owner_user, member_user):
    household = models.Household(
        id=uuid.uuid7(),
        name="Ownership Test Household",
        base_currency="USD",
        country_code="US",
        owner_id=owner_user.id,
    )
    db_session.add(household)
    db_session.commit()
    db_session.refresh(household)

    db_session.add(models.HouseholdMember(
        id=uuid.uuid7(), household_id=household.id, user_id=owner_user.id,
        role=models.HouseholdRoleType.owner,
    ))
    db_session.add(models.HouseholdMember(
        id=uuid.uuid7(), household_id=household.id, user_id=member_user.id,
        role=models.HouseholdRoleType.editor,
    ))
    db_session.commit()
    return household


def test_private_account_hidden_from_other_member(client, owner_auth_headers, member_auth_headers, household, owner_user, db_session):
    private_account = models.FinancialAccount(
        id=uuid.uuid7(), household_id=household.id, name="Owner's Private Vault",
        liquidity="liquid", tax_status="taxable", currency="USD", owner_user_id=owner_user.id,
    )
    shared_account = models.FinancialAccount(
        id=uuid.uuid7(), household_id=household.id, name="Shared Checking",
        liquidity="liquid", tax_status="taxable", currency="USD", owner_user_id=None,
    )
    db_session.add_all([private_account, shared_account])
    db_session.commit()

    resp = client.get(f"/accounts/household/{household.id}", headers=member_auth_headers)
    assert resp.status_code == 200
    names = [a["name"] for a in resp.json()]
    assert "Shared Checking" in names
    assert "Owner's Private Vault" not in names

    resp_owner = client.get(f"/accounts/household/{household.id}", headers=owner_auth_headers)
    owner_names = [a["name"] for a in resp_owner.json()]
    assert "Owner's Private Vault" in owner_names
    assert "Shared Checking" in owner_names


def test_private_account_direct_access_forbidden(client, owner_auth_headers, member_auth_headers, household, owner_user, db_session):
    private_account = models.FinancialAccount(
        id=uuid.uuid7(), household_id=household.id, name="Owner's Private Vault",
        liquidity="liquid", tax_status="taxable", currency="USD", owner_user_id=owner_user.id,
    )
    db_session.add(private_account)
    db_session.commit()

    resp = client.put(
        f"/accounts/{private_account.id}",
        headers=member_auth_headers,
        json={"name": "Renamed"},
    )
    assert resp.status_code == 403


def test_create_account_with_owner_marks_private(client, owner_auth_headers, household):
    resp = client.post(
        "/accounts/",
        headers=owner_auth_headers,
        json={
            "household_id": str(household.id),
            "name": "New Private Account",
            "liquidity": "liquid",
            "tax_status": "taxable",
            "currency": "USD",
        },
    )
    assert resp.status_code == 201
    assert resp.json()["owner_user_id"] is None


def test_invite_existing_user_joins_immediately(client, owner_auth_headers, household, member_user, db_session):
    # invite an email that belongs to an existing user not yet in the household
    other = models.User(
        id=uuid.uuid7(), email="existing_invitee@example.com", name="Existing",
        salted_hashed_password="fakehash", salt="fakesalt",
    )
    db_session.add(other)
    db_session.commit()

    resp = client.post(
        f"/users/households/{household.id}/invites",
        headers=owner_auth_headers,
        json={"email": "existing_invitee@example.com", "role": "editor"},
    )
    assert resp.status_code == 201
    assert resp.json()["status"] == "accepted"

    membership = db_session.query(models.HouseholdMember).filter(
        models.HouseholdMember.household_id == household.id,
        models.HouseholdMember.user_id == other.id,
    ).first()
    assert membership is not None
    assert membership.role == models.HouseholdRoleType.editor


def test_invite_new_email_stays_pending_until_signup(client, owner_auth_headers, household, db_session):
    resp = client.post(
        f"/users/households/{household.id}/invites",
        headers=owner_auth_headers,
        json={"email": "brand_new_invitee@example.com", "role": "viewer"},
    )
    assert resp.status_code == 201
    assert resp.json()["status"] == "pending"

    pending = client.get(f"/users/households/{household.id}/invites", headers=owner_auth_headers)
    assert pending.status_code == 200
    assert any(i["email"] == "brand_new_invitee@example.com" for i in pending.json())

    signup_resp = client.post(
        "/users",
        json={
            "email": "brand_new_invitee@example.com",
            "name": "Brand New",
            "password": "supersecret123",
        },
    )
    assert signup_resp.status_code == 201
    new_user_id = uuid.UUID(signup_resp.json()["id"])

    membership = db_session.query(models.HouseholdMember).filter(
        models.HouseholdMember.household_id == household.id,
        models.HouseholdMember.user_id == new_user_id,
    ).first()
    assert membership is not None
    assert membership.role == models.HouseholdRoleType.viewer


def test_set_and_get_default_split_shares(client, owner_auth_headers, household, owner_user, member_user):
    resp = client.put(
        f"/users/households/{household.id}/split-shares",
        headers=owner_auth_headers,
        json=[
            {"user_id": str(owner_user.id), "share_percent": "60"},
            {"user_id": str(member_user.id), "share_percent": "40"},
        ],
    )
    assert resp.status_code == 200
    shares = {row["user_id"]: row["share_percent"] for row in resp.json()}
    assert shares[str(owner_user.id)] == "60"
    assert shares[str(member_user.id)] == "40"

    get_resp = client.get(f"/users/households/{household.id}/split-shares", headers=owner_auth_headers)
    assert get_resp.status_code == 200
    assert len(get_resp.json()) == 2
