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


def test_refresh_returns_rotated_refresh_token_in_body(client, registered_user):
    """Native clients read the rotated refresh token from the body, not a cookie.

    Without it they keep the token from login, and the session dies 30 days after
    sign-in however often the app is used.
    """
    from datetime import timedelta

    import jwt

    from src.auth import ALGORITHM, SECRET_KEY

    old = create_refresh_token(
        data={"sub": str(registered_user.id)}, expires_delta=timedelta(minutes=5)
    )
    client.cookies.clear()
    response = client.post("/auth/refresh", headers={"Authorization": f"Bearer {old}"})
    assert response.status_code == 200

    new = response.json()["refresh_token"]
    old_claims = jwt.decode(old, SECRET_KEY, algorithms=[ALGORITHM])
    new_claims = jwt.decode(new, SECRET_KEY, algorithms=[ALGORITHM])
    assert new_claims["type"] == "refresh"
    assert new_claims["sub"] == str(registered_user.id)
    assert new_claims["exp"] > old_claims["exp"]

    # And the rotated token is itself usable for the next refresh.
    again = client.post("/auth/refresh", headers={"Authorization": f"Bearer {new}"})
    assert again.status_code == 200


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


# --- AUTH_COOKIE_PREFIX -------------------------------------------------------
# Staging runs beside production under the same parent domain, and a cookie is
# keyed by (name, domain, path). AUTH_COOKIE_DOMAIN has to be the parent domain
# (the only common ancestor of the frontend and API hosts), so without a distinct
# *name* the two stacks share one `access_token` cookie and overwrite each other's
# session. See DEPLOYMENT.md §9.


def test_cookie_names_default_to_unprefixed(client, registered_user, monkeypatch):
    """Production sets no prefix and must keep the exact cookie names it always had."""
    monkeypatch.delenv("AUTH_COOKIE_PREFIX", raising=False)
    set_cookies = _login(client).headers.get_list("set-cookie")
    assert any(c.startswith("access_token=") for c in set_cookies)
    assert any(c.startswith("refresh_token=") for c in set_cookies)


def test_cookie_prefix_renames_both_cookies(client, registered_user, monkeypatch):
    monkeypatch.setenv("AUTH_COOKIE_PREFIX", "staging_")
    set_cookies = _login(client).headers.get_list("set-cookie")
    assert any(c.startswith("staging_access_token=") for c in set_cookies)
    assert any(c.startswith("staging_refresh_token=") for c in set_cookies)
    # The unprefixed names must not also be set, or the collision remains.
    assert not any(c.startswith("access_token=") for c in set_cookies)
    assert not any(c.startswith("refresh_token=") for c in set_cookies)


def test_response_body_keys_are_unaffected_by_prefix(client, registered_user, monkeypatch):
    """The JSON body is the native clients' contract and is not a cookie."""
    monkeypatch.setenv("AUTH_COOKIE_PREFIX", "staging_")
    body = _login(client).json()
    assert body["access_token"] and body["refresh_token"]


def test_prefixed_cookie_authenticates_and_refreshes(client, registered_user, monkeypatch):
    """The renamed cookie is also what the reader looks for, end to end."""
    monkeypatch.setenv("AUTH_COOKIE_PREFIX", "staging_")
    _login(client)
    assert "staging_access_token" in client.cookies
    # get_current_user reads the prefixed cookie, with no Authorization header.
    assert client.get("/auth/me").status_code == 200
    # ...and so does /auth/refresh.
    assert client.post("/auth/refresh").status_code == 200


def test_other_stacks_cookie_is_ignored(client, registered_user, monkeypatch):
    """A production cookie riding along on the parent domain must not authenticate here.

    This is the actual failure being prevented: the browser sends both cookies to
    the staging host, and staging must read only its own.
    """
    monkeypatch.setenv("AUTH_COOKIE_PREFIX", "staging_")
    client.cookies.clear()
    client.cookies.set("access_token", create_access_token(data={"sub": str(registered_user.id)}))
    assert client.get("/auth/me").status_code == 401


def test_logout_clears_the_prefixed_cookies(client, registered_user, monkeypatch):
    monkeypatch.setenv("AUTH_COOKIE_PREFIX", "staging_")
    _login(client)
    set_cookies = client.get("/auth/logout").headers.get_list("set-cookie")
    assert any(c.startswith("staging_access_token=") for c in set_cookies)
    assert any(c.startswith("staging_refresh_token=") for c in set_cookies)
