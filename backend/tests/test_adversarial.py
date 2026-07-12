"""
Adversarial / abuse test suite.

These tests take the perspective of a savvy, hostile user who will send
malformed, out-of-range, cross-tenant, and privilege-escalating requests in an
attempt to corrupt data or read/modify things they shouldn't. Every test here
asserts the system *rejects* the abuse (4xx) rather than 500-ing or silently
accepting poison.

Grouped by attack class:
  1. Authentication & token forgery
  2. Numeric poisoning (NaN/Infinity, negatives, zero, overflow)
  3. Authorization / IDOR / cross-tenant
  4. Privilege escalation (household roles)
  5. Business-rule invariants (cash, dates, transfers)
"""

import json
import uuid
from datetime import datetime, timezone, timedelta, date
from decimal import Decimal

import pytest
import jwt

from src import models, auth


def raw_post(client, url, headers, payload):
    """POST a body containing the non-standard JSON tokens NaN/Infinity that a
    real attacker can send on the wire. TestClient's ``json=`` refuses to
    serialize those client-side, so we hand-serialize (stdlib json emits the
    tokens with allow_nan=True) and the server's json.loads parses them back to
    float('nan')/float('inf') — exactly the poison path we're defending."""
    body = json.dumps(payload)  # allow_nan=True by default -> emits NaN/Infinity
    return client.post(
        url, headers={**headers, "Content-Type": "application/json"}, content=body
    )


# ---------------------------------------------------------------------------
# Helpers / fixtures
# ---------------------------------------------------------------------------

def make_user(db, email):
    salt_hex, hashed = auth.hash_password("password123")
    user = models.User(
        id=uuid.uuid7(), email=email, name="U",
        salted_hashed_password=hashed, salt=salt_hex, preferred_timezone="UTC",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def headers_for(user):
    return {"Authorization": f"Bearer {auth.create_access_token(data={'sub': str(user.id)})}"}


def make_household(db, owner, name="H", currency="USD"):
    hh = models.Household(
        id=uuid.uuid7(), name=name, base_currency=currency, country_code="US",
        owner_id=owner.id,
    )
    db.add(hh)
    db.commit()
    db.add(models.HouseholdMember(
        id=uuid.uuid7(), household_id=hh.id, user_id=owner.id,
        role=models.HouseholdRoleType.owner,
    ))
    db.commit()
    db.refresh(hh)
    return hh


def make_account(db, household, name="Checking", owner_user_id=None, currency="USD"):
    acc = models.FinancialAccount(
        id=uuid.uuid7(), household_id=household.id, name=name,
        liquidity="liquid", tax_status="taxable", currency=currency,
        owner_user_id=owner_user_id,
    )
    db.add(acc)
    db.commit()
    db.refresh(acc)
    return acc


def make_subportfolio(db, household, name="SP", owner_user_id=None):
    sp = models.SubPortfolio(
        id=uuid.uuid7(), household_id=household.id, name=name,
        risk_profile="high", owner_user_id=owner_user_id,
    )
    db.add(sp)
    db.commit()
    db.refresh(sp)
    return sp


def make_asset(db, ticker="ACME"):
    a = models.Asset(id=uuid.uuid7(), ticker=ticker, name="Acme", type="stock", currency="USD")
    db.add(a)
    db.commit()
    db.refresh(a)
    return a


def make_category(db, household, name="Groceries", type_="expense"):
    c = models.Category(id=uuid.uuid7(), household_id=household.id, name=name, type=type_)
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


def add_member(db, household, user, role=models.HouseholdRoleType.editor):
    m = models.HouseholdMember(
        id=uuid.uuid7(), household_id=household.id, user_id=user.id, role=role,
    )
    db.add(m)
    db.commit()
    return m


@pytest.fixture(autouse=True)
def _no_network(monkeypatch):
    """Neutralize the yfinance-backed snapshot/dividend/price refreshers so the
    happy-path writes in these tests never hit the network."""
    monkeypatch.setattr("src.routers.portfolio.run_snapshot_range", lambda *a, **k: None)
    monkeypatch.setattr("src.routers.portfolio.sync_dividends_range", lambda *a, **k: 0)
    monkeypatch.setattr("src.routers.portfolio.materialize_scheduled_dividends", lambda *a, **k: 0)
    monkeypatch.setattr(
        "src.routers.cashflow.fetch_and_cache_exchange_rates", lambda *a, **k: 1.0
    )
    monkeypatch.setattr(
        "src.routers.portfolio.fetch_and_cache_exchange_rates", lambda *a, **k: 1.0
    )


def _trade_body(household, sp, asset, account, **overrides):
    body = {
        "household_id": str(household.id),
        "sub_portfolio_id": str(sp.id),
        "asset_id": str(asset.id),
        "account_id": str(account.id),
        "type": "buy",
        "date": datetime.now(timezone.utc).isoformat(),
        "quantity": 10.0,
        "price": "100.00",
        "exchange_rate": 1.0,
    }
    body.update(overrides)
    return body


# ---------------------------------------------------------------------------
# 1. Authentication & token forgery
# ---------------------------------------------------------------------------

class TestAuthForgery:
    def test_no_token_rejected(self, client):
        assert client.get("/auth/me").status_code == 401

    def test_garbage_token_rejected(self, client):
        r = client.get("/auth/me", headers={"Authorization": "Bearer not.a.jwt"})
        assert r.status_code == 401

    def test_token_signed_with_wrong_secret_rejected(self, client, db_session):
        user = make_user(db_session, "wrongsecret@example.com")
        forged = jwt.encode(
            {"sub": str(user.id), "type": "access",
             "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
            "attacker-guessed-secret", algorithm="HS256",
        )
        r = client.get("/auth/me", headers={"Authorization": f"Bearer {forged}"})
        assert r.status_code == 401

    def test_refresh_token_cannot_be_used_as_access(self, client, db_session):
        user = make_user(db_session, "refreshabuse@example.com")
        refresh = auth.create_refresh_token(data={"sub": str(user.id)})
        r = client.get("/auth/me", headers={"Authorization": f"Bearer {refresh}"})
        assert r.status_code == 401  # wrong "type"

    def test_expired_token_rejected(self, client, db_session):
        user = make_user(db_session, "expired@example.com")
        expired = auth.create_access_token(
            data={"sub": str(user.id)}, expires_delta=timedelta(seconds=-5)
        )
        r = client.get("/auth/me", headers={"Authorization": f"Bearer {expired}"})
        assert r.status_code == 401

    def test_token_for_deleted_user_rejected(self, client, db_session):
        ghost_id = uuid.uuid7()
        token = auth.create_access_token(data={"sub": str(ghost_id)})
        r = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 401

    def test_non_uuid_subject_rejected(self, client):
        token = auth.create_access_token(data={"sub": "not-a-uuid"})
        r = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 401

    def test_alg_none_token_rejected(self, client, db_session):
        """A token forged with alg=none must not be accepted."""
        user = make_user(db_session, "algnone@example.com")
        forged = jwt.encode({"sub": str(user.id), "type": "access"}, "", algorithm="none")
        r = client.get("/auth/me", headers={"Authorization": f"Bearer {forged}"})
        assert r.status_code == 401


# ---------------------------------------------------------------------------
# 2. Numeric poisoning
# ---------------------------------------------------------------------------

class TestNumericPoisoning:
    @pytest.fixture
    def ctx(self, client, db_session):
        user = make_user(db_session, "num@example.com")
        hh = make_household(db_session, user)
        acc = make_account(db_session, hh)
        sp = make_subportfolio(db_session, hh)
        asset = make_asset(db_session)
        cat = make_category(db_session, hh)
        return {
            "h": headers_for(user), "hh": hh, "acc": acc,
            "sp": sp, "asset": asset, "cat": cat,
        }

    @pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
    def test_trade_quantity_nonfinite_rejected(self, client, ctx, bad):
        r = raw_post(client, "/portfolio/trades", ctx["h"],
                     _trade_body(ctx["hh"], ctx["sp"], ctx["asset"], ctx["acc"], quantity=bad))
        assert r.status_code in (400, 422)

    @pytest.mark.parametrize("bad", [float("nan"), float("inf")])
    def test_trade_exchange_rate_nonfinite_rejected(self, client, ctx, bad):
        r = raw_post(client, "/portfolio/trades", ctx["h"],
                     _trade_body(ctx["hh"], ctx["sp"], ctx["asset"], ctx["acc"], exchange_rate=bad))
        assert r.status_code in (400, 422)

    @pytest.mark.parametrize("qty", [0, -5])
    def test_trade_nonpositive_quantity_rejected(self, client, ctx, qty):
        r = client.post("/portfolio/trades", headers=ctx["h"],
                        json=_trade_body(ctx["hh"], ctx["sp"], ctx["asset"], ctx["acc"], quantity=qty))
        assert r.status_code == 422

    @pytest.mark.parametrize("price", ["0", "-100"])
    def test_trade_nonpositive_price_rejected(self, client, ctx, price):
        r = client.post("/portfolio/trades", headers=ctx["h"],
                        json=_trade_body(ctx["hh"], ctx["sp"], ctx["asset"], ctx["acc"], price=price))
        assert r.status_code == 422

    def test_trade_nan_as_string_decimal_rejected(self, client, ctx):
        """Decimal price of 'NaN' string must not slip through."""
        r = client.post("/portfolio/trades", headers=ctx["h"],
                        json=_trade_body(ctx["hh"], ctx["sp"], ctx["asset"], ctx["acc"], price="NaN"))
        assert r.status_code == 422

    def test_trade_exchange_rate_overflow_rejected(self, client, ctx):
        """1e400 overflows a float to +inf; must be rejected, not stored. Sent as
        a raw numeric literal so it overflows during server-side parsing."""
        body = _trade_body(ctx["hh"], ctx["sp"], ctx["asset"], ctx["acc"])
        raw = json.dumps(body).replace('"exchange_rate": 1.0', '"exchange_rate": 1e400')
        r = client.post("/portfolio/trades",
                        headers={**ctx["h"], "Content-Type": "application/json"}, content=raw)
        assert r.status_code == 422

    @pytest.mark.parametrize("bad", [float("nan"), float("inf")])
    def test_transaction_amount_nonfinite_rejected(self, client, ctx, bad):
        r = raw_post(client, "/cashflow/transactions", ctx["h"], {
            "account_id": str(ctx["acc"].id), "category_id": str(ctx["cat"].id),
            "date": datetime.now(timezone.utc).isoformat(), "amount": bad,
        })
        assert r.status_code in (400, 422)

    @pytest.mark.parametrize("amt", ["0", "-50"])
    def test_transaction_nonpositive_amount_rejected(self, client, ctx, amt):
        r = client.post("/cashflow/transactions", headers=ctx["h"], json={
            "account_id": str(ctx["acc"].id), "category_id": str(ctx["cat"].id),
            "date": datetime.now(timezone.utc).isoformat(), "amount": amt,
        })
        assert r.status_code == 422

    @pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
    def test_balance_nonfinite_rejected(self, client, ctx, bad):
        r = raw_post(client, "/accounts/balances", ctx["h"], {
            "account_id": str(ctx["acc"].id), "date": str(date.today()), "balance": bad,
        })
        assert r.status_code in (400, 422)

    def test_transfer_negative_amount_rejected(self, client, db_session, ctx):
        acc2 = make_account(db_session, ctx["hh"], name="Savings")
        r = client.post("/cashflow/transfers", headers=ctx["h"], json={
            "from_account_id": str(ctx["acc"].id), "to_account_id": str(acc2.id),
            "amount": "-100", "date": datetime.now(timezone.utc).isoformat(),
        })
        assert r.status_code == 422

    def test_dividend_negative_amount_rejected(self, client, ctx):
        r = client.post("/portfolio/dividends", headers=ctx["h"], json={
            "household_id": str(ctx["hh"].id), "sub_portfolio_id": str(ctx["sp"].id),
            "asset_id": str(ctx["asset"].id), "account_id": str(ctx["acc"].id),
            "date": datetime.now(timezone.utc).isoformat(), "amount": "-10", "exchange_rate": 1.0,
        })
        assert r.status_code == 422

    def test_exchange_rate_zero_rejected(self, client, ctx):
        r = client.post("/portfolio/exchangerates", headers=ctx["h"], json={
            "id": str(uuid.uuid7()), "date": str(date.today()),
            "base_currency": "USD", "target_currency": "EUR", "rate": 0,
        })
        assert r.status_code == 422

    @pytest.mark.parametrize("pct", ["150", "-10"])
    def test_split_share_out_of_range_rejected(self, client, db_session, ctx, pct):
        user2 = make_user(db_session, f"split{pct}@example.com")
        add_member(db_session, ctx["hh"], user2)
        r = client.put(f"/users/households/{ctx['hh'].id}/split-shares", headers=ctx["h"],
                       json=[{"user_id": str(user2.id), "share_percent": pct}])
        assert r.status_code == 422


# ---------------------------------------------------------------------------
# Password strength
# ---------------------------------------------------------------------------

class TestPasswordStrength:
    @pytest.mark.parametrize("pw", ["", "short"])
    def test_weak_password_rejected_on_signup(self, client, pw):
        r = client.post("/users", json={
            "email": "weakpw@example.com", "name": "Weak", "password": pw,
        })
        assert r.status_code == 422

    def test_strong_password_accepted(self, client):
        r = client.post("/users", json={
            "email": "strongpw@example.com", "name": "Strong", "password": "longenough1",
        })
        assert r.status_code == 201


# ---------------------------------------------------------------------------
# 3. Authorization / IDOR / cross-tenant
# ---------------------------------------------------------------------------

class TestCrossTenantIsolation:
    @pytest.fixture
    def two_households(self, client, db_session):
        alice = make_user(db_session, "alice@example.com")
        bob = make_user(db_session, "bob@example.com")
        ah = make_household(db_session, alice, name="Alice HH")
        bh = make_household(db_session, bob, name="Bob HH")
        return {
            "alice": alice, "bob": bob, "ah": ah, "bh": bh,
            "ha": headers_for(alice), "hb": headers_for(bob),
        }

    def test_cannot_read_other_household_accounts(self, client, two_households, db_session):
        tw = two_households
        make_account(db_session, tw["ah"], name="Alice Checking")
        r = client.get(f"/accounts/household/{tw['ah'].id}", headers=tw["hb"])
        assert r.status_code == 403

    def test_cannot_read_other_household_trades(self, client, two_households):
        tw = two_households
        r = client.get(f"/portfolio/trades/household/{tw['ah'].id}", headers=tw["hb"])
        assert r.status_code == 403

    def test_cannot_delete_other_household(self, client, two_households):
        tw = two_households
        r = client.delete(f"/users/households/{tw['ah'].id}", headers=tw["hb"])
        assert r.status_code == 403

    def test_trade_cannot_reference_foreign_account(self, client, two_households, db_session):
        """Bob owns a household; he tries to post a trade in his household but
        pointing the funding account at Alice's account."""
        tw = two_households
        alice_acc = make_account(db_session, tw["ah"], name="Alice Brokerage")
        bob_sp = make_subportfolio(db_session, tw["bh"])
        asset = make_asset(db_session)
        r = client.post("/portfolio/trades", headers=tw["hb"],
                        json=_trade_body(tw["bh"], bob_sp, asset, alice_acc))
        assert r.status_code == 404  # account not in this household

    def test_trade_cannot_reference_foreign_subportfolio(self, client, two_households, db_session):
        tw = two_households
        alice_sp = make_subportfolio(db_session, tw["ah"])
        bob_acc = make_account(db_session, tw["bh"])
        asset = make_asset(db_session)
        r = client.post("/portfolio/trades", headers=tw["hb"],
                        json=_trade_body(tw["bh"], alice_sp, asset, bob_acc))
        assert r.status_code == 404

    def test_transaction_cannot_target_foreign_account(self, client, two_households, db_session):
        tw = two_households
        alice_acc = make_account(db_session, tw["ah"])
        bob_cat = make_category(db_session, tw["bh"])
        r = client.post("/cashflow/transactions", headers=tw["hb"], json={
            "account_id": str(alice_acc.id), "category_id": str(bob_cat.id),
            "date": datetime.now(timezone.utc).isoformat(), "amount": "10",
        })
        assert r.status_code in (400, 403, 404)


class TestPrivateOwnership:
    @pytest.fixture
    def shared_household(self, client, db_session):
        owner = make_user(db_session, "priv_owner@example.com")
        member = make_user(db_session, "priv_member@example.com")
        hh = make_household(db_session, owner)
        add_member(db_session, hh, member, role=models.HouseholdRoleType.editor)
        return {
            "owner": owner, "member": member, "hh": hh,
            "ho": headers_for(owner), "hm": headers_for(member),
        }

    def test_member_cannot_read_owners_private_account_balances(self, client, shared_household, db_session):
        sh = shared_household
        priv = make_account(db_session, sh["hh"], name="Owner Vault", owner_user_id=sh["owner"].id)
        r = client.get(f"/accounts/balances/account/{priv.id}", headers=sh["hm"])
        assert r.status_code == 403

    def test_member_cannot_log_transaction_to_private_account(self, client, shared_household, db_session):
        sh = shared_household
        priv = make_account(db_session, sh["hh"], name="Owner Vault", owner_user_id=sh["owner"].id)
        cat = make_category(db_session, sh["hh"])
        r = client.post("/cashflow/transactions", headers=sh["hm"], json={
            "account_id": str(priv.id), "category_id": str(cat.id),
            "date": datetime.now(timezone.utc).isoformat(), "amount": "10",
        })
        assert r.status_code == 403

    def test_member_cannot_trade_into_private_subportfolio(self, client, shared_household, db_session):
        sh = shared_household
        priv_sp = make_subportfolio(db_session, sh["hh"], owner_user_id=sh["owner"].id)
        acc = make_account(db_session, sh["hh"])
        asset = make_asset(db_session)
        r = client.post("/portfolio/trades", headers=sh["hm"],
                        json=_trade_body(sh["hh"], priv_sp, asset, acc))
        assert r.status_code == 403

    def test_private_subportfolio_hidden_from_member_list(self, client, shared_household, db_session):
        sh = shared_household
        make_subportfolio(db_session, sh["hh"], name="Owner Private Goal", owner_user_id=sh["owner"].id)
        make_subportfolio(db_session, sh["hh"], name="Shared Goal", owner_user_id=None)
        r = client.get(f"/portfolio/subportfolios/household/{sh['hh'].id}", headers=sh["hm"])
        assert r.status_code == 200
        names = [s["name"] for s in r.json()]
        assert "Shared Goal" in names
        assert "Owner Private Goal" not in names


# ---------------------------------------------------------------------------
# 4. Privilege escalation (household roles)
# ---------------------------------------------------------------------------

class TestPrivilegeEscalation:
    @pytest.fixture
    def team(self, client, db_session):
        owner = make_user(db_session, "team_owner@example.com")
        editor = make_user(db_session, "team_editor@example.com")
        hh = make_household(db_session, owner)
        editor_m = add_member(db_session, hh, editor, role=models.HouseholdRoleType.editor)
        owner_m = db_session.query(models.HouseholdMember).filter(
            models.HouseholdMember.household_id == hh.id,
            models.HouseholdMember.user_id == owner.id,
        ).first()
        return {
            "owner": owner, "editor": editor, "hh": hh,
            "editor_m": editor_m, "owner_m": owner_m,
            "ho": headers_for(owner), "he": headers_for(editor),
        }

    def test_editor_cannot_promote_self_to_owner(self, client, team):
        t = team
        r = client.put(f"/users/householdmember/{t['editor_m'].id}", headers=t["he"],
                       json={"role": "owner"})
        assert r.status_code == 403

    def test_editor_cannot_demote_owner(self, client, team):
        t = team
        r = client.put(f"/users/householdmember/{t['owner_m'].id}", headers=t["he"],
                       json={"role": "viewer"})
        assert r.status_code == 403

    def test_editor_cannot_remove_owner(self, client, team):
        t = team
        r = client.delete(f"/users/householdmember/{t['owner_m'].id}", headers=t["he"])
        assert r.status_code == 403

    def test_editor_cannot_add_new_owner(self, client, team, db_session):
        t = team
        newbie = make_user(db_session, "team_newbie@example.com")
        r = client.post("/users/householdmembers", headers=t["he"], json={
            "household_id": str(t["hh"].id), "user_id": str(newbie.id), "role": "owner",
        })
        assert r.status_code == 403

    def test_editor_cannot_invite_as_owner(self, client, team):
        t = team
        r = client.post(f"/users/households/{t['hh'].id}/invites", headers=t["he"],
                        json={"email": "invited_owner@example.com", "role": "owner"})
        assert r.status_code == 403

    def test_owner_can_still_promote_member(self, client, team):
        """The guard must not lock out the legitimate owner."""
        t = team
        r = client.put(f"/users/householdmember/{t['editor_m'].id}", headers=t["ho"],
                       json={"role": "owner"})
        assert r.status_code == 200
        assert r.json()["role"] == "owner"

    def test_outsider_cannot_touch_membership(self, client, team, db_session):
        t = team
        outsider = make_user(db_session, "outsider@example.com")
        r = client.put(f"/users/householdmember/{t['editor_m'].id}",
                       headers=headers_for(outsider), json={"role": "viewer"})
        assert r.status_code == 403


# ---------------------------------------------------------------------------
# 5. Business-rule invariants
# ---------------------------------------------------------------------------

class TestBusinessRules:
    @pytest.fixture
    def ctx(self, client, db_session):
        user = make_user(db_session, "biz@example.com")
        hh = make_household(db_session, user)
        acc = make_account(db_session, hh)
        sp = make_subportfolio(db_session, hh)
        asset = make_asset(db_session)
        return {"user": user, "h": headers_for(user), "hh": hh, "acc": acc, "sp": sp, "asset": asset}

    def test_withdraw_more_cash_than_available_rejected(self, client, ctx):
        r = client.post(f"/portfolio/subportfolios/{ctx['sp'].id}/cash", headers=ctx["h"], json={
            "household_id": str(ctx["hh"].id), "account_id": str(ctx["acc"].id),
            "direction": "withdraw", "amount": "9999", "currency": "USD",
            "date": datetime.now(timezone.utc).isoformat(), "exchange_rate": 1.0,
        })
        assert r.status_code == 400

    def test_cash_settled_buy_without_funds_rejected(self, client, ctx):
        body = _trade_body(ctx["hh"], ctx["sp"], ctx["asset"], ctx["acc"],
                           settle_from_cash=True, quantity=1, price="100")
        r = client.post("/portfolio/trades", headers=ctx["h"], json=body)
        assert r.status_code == 400

    def test_transfer_to_same_account_rejected(self, client, ctx):
        r = client.post("/cashflow/transfers", headers=ctx["h"], json={
            "from_account_id": str(ctx["acc"].id), "to_account_id": str(ctx["acc"].id),
            "amount": "100", "date": datetime.now(timezone.utc).isoformat(),
        })
        assert r.status_code == 400

    def test_manual_price_in_future_rejected(self, client, ctx, db_session):
        manual_asset = models.Asset(
            id=uuid.uuid7(), ticker="SSB1", name="Bond", type="bond",
            currency="USD", pricing_mode="manual",
        )
        db_session.add(manual_asset)
        db_session.commit()
        future = (date.today() + timedelta(days=30)).isoformat()
        r = client.post(f"/portfolio/assets/{manual_asset.id}/price", headers=ctx["h"], json={
            "household_id": str(ctx["hh"].id), "date": future, "price": "100",
        })
        assert r.status_code == 400

    def test_manual_price_on_market_asset_rejected(self, client, ctx):
        r = client.post(f"/portfolio/assets/{ctx['asset'].id}/price", headers=ctx["h"], json={
            "household_id": str(ctx["hh"].id), "date": str(date.today()), "price": "100",
        })
        assert r.status_code == 400

    def test_duplicate_email_signup_rejected(self, client):
        client.post("/users", json={"email": "dupe@example.com", "name": "A", "password": "password123"})
        r = client.post("/users", json={"email": "dupe@example.com", "name": "B", "password": "password123"})
        assert r.status_code == 400

    def test_scheduled_dividend_foreign_subportfolio_rejected(self, client, ctx, db_session):
        """A scheduled dividend whose sub-portfolio is in another household is rejected."""
        other = make_user(db_session, "sd_other@example.com")
        other_hh = make_household(db_session, other)
        foreign_sp = make_subportfolio(db_session, other_hh)
        r = client.post("/portfolio/scheduled-dividends", headers=ctx["h"], json=[{
            "household_id": str(ctx["hh"].id), "sub_portfolio_id": str(foreign_sp.id),
            "asset_id": str(ctx["asset"].id), "account_id": str(ctx["acc"].id),
            "date": str(date.today()), "amount": "50",
        }])
        assert r.status_code == 404
