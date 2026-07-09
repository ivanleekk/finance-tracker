"""End-to-end tests for /auth: login, token refresh (cookie + bearer), logout, /me."""
import uuid

import pytest

from src import models
from src.auth import create_access_token, create_refresh_token, hash_password

EMAIL = "authflow@example.com"
PASSWORD = "S3cure!pass"


@pytest.fixture
def registered_user(db_session):
    salt, hashed = hash_password(PASSWORD)
    user = models.User(
        id=uuid.uuid7(),
        email=EMAIL,
        name="Auth Flow",
        salt=salt,
        salted_hashed_password=hashed,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _login(client, email=EMAIL, password=PASSWORD):
    return client.post("/auth/token", data={"username": email, "password": password})


def test_login_success_returns_tokens_and_cookies(client, registered_user):
    response = _login(client)
    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"]
    assert body["refresh_token"]
    assert "access_token" in response.cookies
    assert "refresh_token" in response.cookies


def test_login_wrong_password(client, registered_user):
    response = _login(client, password="wrong-password")
    assert response.status_code == 401


def test_login_unknown_email(client):
    response = _login(client, email="nobody@example.com")
    assert response.status_code == 401


def test_me_returns_current_user(client, registered_user):
    token = _login(client).json()["access_token"]
    response = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    body = response.json()
    assert body["email"] == EMAIL
    assert body["name"] == "Auth Flow"
    # Never leak password material
    assert "salted_hashed_password" not in body
    assert "salt" not in body


def test_me_requires_auth(client):
    assert client.get("/auth/me").status_code == 401


def test_me_rejects_garbage_token(client):
    response = client.get("/auth/me", headers={"Authorization": "Bearer not-a-jwt"})
    assert response.status_code == 401


def test_me_rejects_refresh_token_as_access(client, registered_user):
    """Token type is enforced: a refresh token cannot be used as an access token."""
    refresh = create_refresh_token(data={"sub": str(registered_user.id)})
    response = client.get("/auth/me", headers={"Authorization": f"Bearer {refresh}"})
    assert response.status_code == 401


def test_refresh_with_cookie_rotates_tokens(client, registered_user):
    login = _login(client)
    # TestClient carries cookies across requests automatically
    response = client.post("/auth/refresh")
    assert response.status_code == 200
    new_access = response.json()["access_token"]
    assert new_access
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {new_access}"})
    assert me.status_code == 200


def test_refresh_with_bearer_header(client, registered_user):
    """Mobile clients without a cookie jar send the refresh token as a bearer header."""
    refresh = create_refresh_token(data={"sub": str(registered_user.id)})
    client.cookies.clear()
    response = client.post("/auth/refresh", headers={"Authorization": f"Bearer {refresh}"})
    assert response.status_code == 200
    assert response.json()["access_token"]


def test_refresh_rejects_access_token(client, registered_user):
    access = create_access_token(data={"sub": str(registered_user.id)})
    client.cookies.clear()
    response = client.post("/auth/refresh", headers={"Authorization": f"Bearer {access}"})
    assert response.status_code == 401


def test_refresh_without_token(client):
    client.cookies.clear()
    assert client.post("/auth/refresh").status_code == 401


def test_refresh_with_invalid_token(client):
    client.cookies.clear()
    response = client.post("/auth/refresh", headers={"Authorization": "Bearer bogus"})
    assert response.status_code == 401


def test_refresh_for_deleted_user(client, registered_user, db_session):
    refresh = create_refresh_token(data={"sub": str(registered_user.id)})
    db_session.delete(registered_user)
    db_session.commit()
    client.cookies.clear()
    response = client.post("/auth/refresh", headers={"Authorization": f"Bearer {refresh}"})
    assert response.status_code == 401


def test_logout_clears_cookies(client, registered_user):
    _login(client)
    response = client.get("/auth/logout")
    assert response.status_code == 200
    # delete_cookie is expressed as Set-Cookie headers with empty values / immediate expiry
    set_cookies = response.headers.get_list("set-cookie")
    assert any(c.startswith("access_token=") for c in set_cookies)
    assert any(c.startswith("refresh_token=") for c in set_cookies)
