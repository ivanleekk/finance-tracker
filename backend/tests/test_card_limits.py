"""
Per-card spend limits.

Two things carry most of the risk. The cycle window is the first: a card closing
mid-month has a "month" that is not a calendar month, and getting it wrong is
silent — every meter is simply measured over the wrong days and still looks
plausible. The second is the ceiling/floor split, because a minimum spend is the
same sum read the other way and it would be easy to warn about the wrong side.

There is also one deliberate departure from budgets pinned here: a split bill
counts in full against a card cap, because the issuer charged the card in full.
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest

from src import models
from src.services import card_service


@pytest.fixture
def owner(db_session):
    user = models.User(
        id=uuid.uuid7(),
        email="card_owner@example.com",
        name="Card Owner",
        salted_hashed_password="fakehash",
        salt="fakesalt",
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def household(db_session, owner):
    hh = models.Household(
        id=uuid.uuid7(),
        name="Card Household",
        base_currency="USD",
        country_code="US",
        owner_id=owner.id,
    )
    db_session.add(hh)
    db_session.commit()
    db_session.refresh(hh)
    return hh


@pytest.fixture
def card_account(db_session, household):
    acc = models.FinancialAccount(
        id=uuid.uuid7(),
        household_id=household.id,
        name="Amex Platinum",
        liquidity=models.LiquidityStatus.liquid,
        tax_status=models.TaxTreatment.taxable,
        kind=models.AccountKind.liability,
        currency="USD",
    )
    db_session.add(acc)
    db_session.commit()
    db_session.refresh(acc)
    return acc


@pytest.fixture
def dining(db_session, household):
    cat = models.Category(
        id=uuid.uuid7(), household_id=household.id, name="Dining", type="expense"
    )
    db_session.add(cat)
    db_session.commit()
    db_session.refresh(cat)
    return cat


def _card(db_session, account, *, basis=models.CycleBasis.statement, day=18):
    card = models.Card(
        id=uuid.uuid7(),
        financial_account_id=account.id,
        cycle_basis=basis,
        statement_day=day,
    )
    db_session.add(card)
    db_session.commit()
    db_session.refresh(card)
    return card


def _category(db_session, card, name, *, limit=None, is_default=False, order=0):
    cat = models.CardCategory(
        id=uuid.uuid7(),
        card_id=card.id,
        name=name,
        is_default=is_default,
        limit_id=limit.id if limit else None,
        sort_order=order,
    )
    db_session.add(cat)
    db_session.commit()
    db_session.refresh(cat)
    return cat


def _limit(db_session, card, name, amount, *, direction=models.LimitDirection.ceiling,
           reset=models.LimitResetBasis.cycle):
    lim = models.CardLimit(
        id=uuid.uuid7(),
        card_id=card.id,
        name=name,
        amount=Decimal(str(amount)),
        direction=direction,
        reset_basis=reset,
    )
    db_session.add(lim)
    db_session.commit()
    db_session.refresh(lim)
    return lim


def _spend(db_session, account, category, amount, on, *, card_category=None, rate=None,
           transfer_id=None, kind=models.TransactionType.expense):
    txn = models.Transaction(
        id=uuid.uuid7(),
        account_id=account.id,
        category_id=category.id,
        date=datetime.combine(on, datetime.min.time(), tzinfo=timezone.utc),
        amount=Decimal(str(amount)),
        amount_home_currency=Decimal(str(amount)),
        transaction_type=kind,
        exchange_rate=rate,
        transfer_id=transfer_id,
        card_category_id=card_category.id if card_category else None,
    )
    db_session.add(txn)
    db_session.commit()
    return txn


# --- The cycle window ---------------------------------------------------------


class TestStatementBounds:
    def test_a_date_before_the_close_belongs_to_the_cycle_that_is_still_open(self, db_session, card_account):
        card = _card(db_session, card_account, day=18)
        # 5 Sep sits inside the 19 Aug - 18 Sep cycle.
        assert card_service.statement_bounds(card, date(2026, 9, 5)) == (
            date(2026, 8, 19),
            date(2026, 9, 18),
        )

    def test_the_closing_day_itself_belongs_to_the_cycle_it_closes(self, db_session, card_account):
        card = _card(db_session, card_account, day=18)
        # This is the boundary people get wrong: a purchase on the 18th is on
        # the statement that closes that day, not the next one.
        assert card_service.statement_bounds(card, date(2026, 9, 18)) == (
            date(2026, 8, 19),
            date(2026, 9, 18),
        )

    def test_the_day_after_the_close_starts_the_next_cycle(self, db_session, card_account):
        card = _card(db_session, card_account, day=18)
        assert card_service.statement_bounds(card, date(2026, 9, 19)) == (
            date(2026, 9, 19),
            date(2026, 10, 18),
        )

    def test_a_card_closing_on_the_31st_still_closes_in_february(self, db_session, card_account):
        card = _card(db_session, card_account, day=31)
        start, end = card_service.statement_bounds(card, date(2026, 2, 10))
        # January closes the 31st, so February's cycle opens on the 1st and
        # closes on the 28th rather than erroring or spilling into March.
        assert (start, end) == (date(2026, 2, 1), date(2026, 2, 28))

    def test_the_clamp_does_not_drift_the_following_month_down(self, db_session, card_account):
        card = _card(db_session, card_account, day=31)
        # March must go back to the 31st rather than staying on February's 28th,
        # which is the drift bug the recurrence engine documents.
        assert card_service.statement_bounds(card, date(2026, 3, 15)) == (
            date(2026, 3, 1),
            date(2026, 3, 31),
        )

    def test_cycles_are_contiguous_across_a_year_boundary(self, db_session, card_account):
        card = _card(db_session, card_account, day=18)
        _, dec_end = card_service.statement_bounds(card, date(2026, 12, 10))
        jan_start, _ = card_service.statement_bounds(card, date(2026, 12, 20))
        assert dec_end == date(2026, 12, 18)
        assert jan_start == date(2026, 12, 19)

    def test_a_calendar_card_ignores_the_statement_day(self, db_session, card_account):
        card = _card(db_session, card_account, basis=models.CycleBasis.calendar, day=18)
        # Some issuers reset caps on the calendar month however the statement
        # falls, and that is not derivable from the statement day.
        assert card_service.statement_bounds(card, date(2026, 9, 5)) == (
            date(2026, 9, 1),
            date(2026, 9, 30),
        )

    def test_the_ends_of_the_calendar_answer_instead_of_crashing(self, db_session, card_account):
        """
        `on` is a query parameter, so it has to answer for any date it accepts.
        `date` spans years 1..9999, and asking for the cycle at either end used
        to reach for the month beyond it — year 0 or year 10000 — and raise,
        surfacing as a 500 on GET /cards/{id}/status.
        """
        card = _card(db_session, card_account, day=31)

        start, end = card_service.statement_bounds(card, date(9999, 12, 31))
        assert start <= date(9999, 12, 31) <= end
        assert end <= date.max

        start, end = card_service.statement_bounds(card, date(1, 1, 1))
        assert start <= date(1, 1, 1) <= end
        assert start >= date.min

    def test_every_day_of_a_year_lands_in_exactly_one_cycle(self, db_session, card_account):
        """No gaps and no overlaps — the property that makes the meter trustworthy."""
        card = _card(db_session, card_account, day=31)
        day = date(2026, 1, 1)
        _, current_end = card_service.statement_bounds(card, day)
        while day < date(2026, 12, 31):
            start, end = card_service.statement_bounds(card, day)
            assert start <= day <= end
            if end != current_end:
                # A new cycle must begin the day after the previous one ended.
                assert start == current_end + card_service.ONE_DAY
                current_end = end
            day += card_service.ONE_DAY


class TestLimitBounds:
    def test_a_quarterly_limit_uses_calendar_quarters(self, db_session, card_account):
        card = _card(db_session, card_account, day=18)
        lim = _limit(db_session, card, "Q", 100, reset=models.LimitResetBasis.quarter)
        assert card_service.limit_bounds(card, lim, date(2026, 5, 4)) == (
            date(2026, 4, 1),
            date(2026, 6, 30),
        )

    def test_a_calendar_month_limit_ignores_the_cards_cycle(self, db_session, card_account):
        card = _card(db_session, card_account, day=18)
        lim = _limit(db_session, card, "M", 100, reset=models.LimitResetBasis.calendar_month)
        assert card_service.limit_bounds(card, lim, date(2026, 9, 5)) == (
            date(2026, 9, 1),
            date(2026, 9, 30),
        )


# --- The meter ----------------------------------------------------------------


class TestCeiling:
    def test_headroom_is_what_is_left_before_the_cap(self, db_session, card_account, dining):
        card = _card(db_session, card_account, day=18)
        lim = _limit(db_session, card, "Dining cap", 1000)
        cat = _category(db_session, card, "Dining", limit=lim, is_default=True)
        _spend(db_session, card_account, dining, 240, date(2026, 9, 1), card_category=cat)

        db_session.refresh(card)
        [status] = card_service.card_limit_statuses(db_session, card, on=date(2026, 9, 5))
        assert status.spent == Decimal("240.00")
        assert status.remaining == Decimal("760.00")
        assert status.settled is False

    def test_a_burst_cap_reports_zero_headroom_not_a_negative_one(self, db_session, card_account, dining):
        card = _card(db_session, card_account, day=18)
        lim = _limit(db_session, card, "Dining cap", 1000)
        cat = _category(db_session, card, "Dining", limit=lim, is_default=True)
        _spend(db_session, card_account, dining, 1200, date(2026, 9, 1), card_category=cat)

        db_session.refresh(card)
        [status] = card_service.card_limit_statuses(db_session, card, on=date(2026, 9, 5))
        assert status.remaining == Decimal("0.00")
        assert status.settled is True
        assert status.spent == Decimal("1200.00")

    def test_the_pace_warns_before_the_cap_is_actually_burst(self, db_session, card_account, dining):
        card = _card(db_session, card_account, day=18)
        lim = _limit(db_session, card, "Dining cap", 1000)
        cat = _category(db_session, card, "Dining", limit=lim, is_default=True)
        # 6 days into a 31-day cycle, $400 spent: on pace for about $2,066.
        _spend(db_session, card_account, dining, 400, date(2026, 8, 20), card_category=cat)

        db_session.refresh(card)
        [status] = card_service.card_limit_statuses(db_session, card, on=date(2026, 8, 24))
        assert status.settled is False, "not burst yet"
        assert status.projected_missed is True, "but on pace to burst"


class TestFloor:
    def test_a_minimum_spend_reports_how_much_is_still_needed(self, db_session, card_account, dining):
        card = _card(db_session, card_account, day=18)
        lim = _limit(db_session, card, "Fee waiver", 800, direction=models.LimitDirection.floor)
        cat = _category(db_session, card, "Everything else", limit=lim, is_default=True)
        _spend(db_session, card_account, dining, 680, date(2026, 9, 1), card_category=cat)

        db_session.refresh(card)
        [status] = card_service.card_limit_statuses(db_session, card, on=date(2026, 9, 5))
        assert status.remaining == Decimal("120.00"), "$120 to go"
        assert status.settled is False

    def test_a_met_minimum_is_settled_with_nothing_left_to_do(self, db_session, card_account, dining):
        card = _card(db_session, card_account, day=18)
        lim = _limit(db_session, card, "Fee waiver", 800, direction=models.LimitDirection.floor)
        cat = _category(db_session, card, "Everything else", limit=lim, is_default=True)
        _spend(db_session, card_account, dining, 900, date(2026, 9, 1), card_category=cat)

        db_session.refresh(card)
        [status] = card_service.card_limit_statuses(db_session, card, on=date(2026, 9, 5))
        assert status.settled is True
        assert status.remaining == Decimal("0.00")
        assert status.projected_missed is False

    def test_the_warning_fires_on_the_opposite_side_from_a_ceiling(self, db_session, card_account, dining):
        """
        The whole point of the direction flag. Identical spend against an
        identical amount must warn for a floor and stay quiet for a ceiling.
        """
        card = _card(db_session, card_account, day=18)
        floor = _limit(db_session, card, "Minimum", 800, direction=models.LimitDirection.floor)
        ceiling = _limit(db_session, card, "Cap", 800, direction=models.LimitDirection.ceiling)
        low = _category(db_session, card, "Floor cat", limit=floor, is_default=True)
        high = _category(db_session, card, "Ceiling cat", limit=ceiling)
        # A trickle: on pace for well under 800 by the close.
        _spend(db_session, card_account, dining, 50, date(2026, 8, 20), card_category=low)
        _spend(db_session, card_account, dining, 50, date(2026, 8, 20), card_category=high)

        db_session.refresh(card)
        statuses = {s.limit.name: s for s in card_service.card_limit_statuses(
            db_session, card, on=date(2026, 8, 24))}
        assert statuses["Minimum"].projected_missed is True, "will fall short"
        assert statuses["Cap"].projected_missed is False, "nowhere near bursting"


class TestRollupRules:
    def test_several_categories_can_share_one_limit(self, db_session, card_account, dining):
        card = _card(db_session, card_account, day=18)
        lim = _limit(db_session, card, "First $1,000", 1000)
        food = _category(db_session, card, "Dining", limit=lim, is_default=True)
        groceries = _category(db_session, card, "Groceries", limit=lim)
        _spend(db_session, card_account, dining, 400, date(2026, 9, 1), card_category=food)
        _spend(db_session, card_account, dining, 250, date(2026, 9, 2), card_category=groceries)

        db_session.refresh(card)
        [status] = card_service.card_limit_statuses(db_session, card, on=date(2026, 9, 5))
        assert status.spent == Decimal("650.00"), "both categories draw the same limit down"
        assert sorted(status.category_names) == ["Dining", "Groceries"]

    def test_untagged_spend_falls_to_the_cards_default_category(self, db_session, card_account, dining):
        card = _card(db_session, card_account, day=18)
        lim = _limit(db_session, card, "Everything", 1000)
        _category(db_session, card, "Everything else", limit=lim, is_default=True)
        # No card_category picked at entry — it must still be metered.
        _spend(db_session, card_account, dining, 120, date(2026, 9, 1))

        db_session.refresh(card)
        [status] = card_service.card_limit_statuses(db_session, card, on=date(2026, 9, 5))
        assert status.spent == Decimal("120.00")

    def test_paying_the_bill_is_not_spending(self, db_session, card_account, dining):
        card = _card(db_session, card_account, day=18)
        lim = _limit(db_session, card, "Cap", 1000)
        cat = _category(db_session, card, "Dining", limit=lim, is_default=True)
        _spend(db_session, card_account, dining, 300, date(2026, 9, 1), card_category=cat)
        # A transfer settling the card. Counting it would meter the same
        # purchases twice, once as spend and once as repayment.
        _spend(db_session, card_account, dining, 300, date(2026, 9, 2),
               card_category=cat, transfer_id=uuid.uuid7())

        db_session.refresh(card)
        [status] = card_service.card_limit_statuses(db_session, card, on=date(2026, 9, 5))
        assert status.spent == Decimal("300.00")

    def test_spend_outside_the_cycle_is_not_counted(self, db_session, card_account, dining):
        card = _card(db_session, card_account, day=18)
        lim = _limit(db_session, card, "Cap", 1000)
        cat = _category(db_session, card, "Dining", limit=lim, is_default=True)
        # The day before the cycle opens, and the day after it closes.
        _spend(db_session, card_account, dining, 500, date(2026, 8, 18), card_category=cat)
        _spend(db_session, card_account, dining, 500, date(2026, 9, 19), card_category=cat)
        _spend(db_session, card_account, dining, 70, date(2026, 9, 2), card_category=cat)

        db_session.refresh(card)
        [status] = card_service.card_limit_statuses(db_session, card, on=date(2026, 9, 5))
        assert status.spent == Decimal("70.00")

    def test_a_foreign_purchase_counts_what_the_card_was_charged(self, db_session, card_account, dining):
        """
        The card's cap is in the card's currency, so the account-currency figure
        is the one that matters — not the household base conversion budgets use.
        """
        card = _card(db_session, card_account, day=18)
        lim = _limit(db_session, card, "Cap", 1000)
        cat = _category(db_session, card, "Travel", limit=lim, is_default=True)
        # 100 units of some other currency at 1.35 to the card's own.
        _spend(db_session, card_account, dining, 100, date(2026, 9, 1), card_category=cat, rate=1.35)

        db_session.refresh(card)
        [status] = card_service.card_limit_statuses(db_session, card, on=date(2026, 9, 5))
        assert status.spent == Decimal("135.00")

    def test_a_split_bill_counts_in_full_against_the_card(self, db_session, card_account, dining):
        """
        Deliberately unlike budgets. A dinner you paid for and split three ways
        is a third of your budget but the whole of the card's cap: the issuer
        charged the card the full amount.
        """
        card = _card(db_session, card_account, day=18)
        lim = _limit(db_session, card, "Dining cap", 1000)
        cat = _category(db_session, card, "Dining", limit=lim, is_default=True)
        txn = _spend(db_session, card_account, dining, 300, date(2026, 9, 1), card_category=cat)
        txn.owed_by = "Alice"
        txn.owed_amount = Decimal("200")
        db_session.commit()

        db_session.refresh(card)
        [status] = card_service.card_limit_statuses(db_session, card, on=date(2026, 9, 5))
        assert status.spent == Decimal("300.00"), "the card was charged 300, not 100"


class TestBreakdown:
    def test_a_card_with_no_limits_still_reports_where_the_money_went(self, db_session, card_account, dining):
        card = _card(db_session, card_account, day=18)
        food = _category(db_session, card, "Dining", is_default=True, order=0)
        online = _category(db_session, card, "Online", order=1)
        _spend(db_session, card_account, dining, 90, date(2026, 9, 1), card_category=food)
        _spend(db_session, card_account, dining, 210, date(2026, 9, 2), card_category=online)

        db_session.refresh(card)
        start, end, rows = card_service.card_category_breakdown(db_session, card, on=date(2026, 9, 5))
        assert (start, end) == (date(2026, 8, 19), date(2026, 9, 18))
        assert [(r.category.name, r.spent) for r in rows] == [
            ("Online", Decimal("210.00")),
            ("Dining", Decimal("90.00")),
        ]


# --- Endpoints and integrity rules -------------------------------------------


@pytest.fixture
def headers(client, owner):
    from src.auth import create_access_token

    return {"Authorization": f"Bearer {create_access_token(data={'sub': str(owner.id)})}"}


@pytest.fixture
def bank_account(db_session, household):
    acc = models.FinancialAccount(
        id=uuid.uuid7(),
        household_id=household.id,
        name="Checking",
        liquidity=models.LiquidityStatus.liquid,
        tax_status=models.TaxTreatment.taxable,
        kind=models.AccountKind.asset,
        currency="USD",
    )
    db_session.add(acc)
    db_session.commit()
    db_session.refresh(acc)
    return acc


class TestCardEndpoints:
    def test_a_card_needs_a_liability_account(self, client, headers, bank_account):
        res = client.post(
            "/cards",
            json={"financial_account_id": str(bank_account.id), "statement_day": 18},
            headers=headers,
        )
        assert res.status_code == 400
        assert "liability" in res.json()["detail"].lower()

    def test_one_card_per_account(self, client, headers, card_account):
        body = {"financial_account_id": str(card_account.id), "statement_day": 18}
        assert client.post("/cards", json=body, headers=headers).status_code == 201
        assert client.post("/cards", json=body, headers=headers).status_code == 409

    def test_the_first_category_becomes_the_default_without_being_asked(
        self, client, headers, card_account
    ):
        card = client.post(
            "/cards",
            json={"financial_account_id": str(card_account.id), "statement_day": 18},
            headers=headers,
        ).json()
        # Untagged spend has to land somewhere from the very first transaction.
        res = client.post(
            f"/cards/{card['id']}/categories",
            json={"name": "Everything else", "is_default": False},
            headers=headers,
        )
        assert res.status_code == 201
        assert res.json()["is_default"] is True

    def test_making_one_category_default_demotes_the_previous_one(
        self, client, headers, card_account
    ):
        card = client.post(
            "/cards",
            json={"financial_account_id": str(card_account.id), "statement_day": 18},
            headers=headers,
        ).json()
        first = client.post(
            f"/cards/{card['id']}/categories", json={"name": "A"}, headers=headers
        ).json()
        second = client.post(
            f"/cards/{card['id']}/categories", json={"name": "B", "is_default": True}, headers=headers
        ).json()
        assert second["is_default"] is True

        refreshed = client.get(f"/cards/{card['id']}", headers=headers).json()
        defaults = [c["name"] for c in refreshed["categories"] if c["is_default"]]
        assert defaults == ["B"], "exactly one default, and it moved"
        assert first["id"] != second["id"]

    def test_detaching_a_limit_needs_an_explicit_null(self, client, headers, card_account):
        card = client.post(
            "/cards",
            json={"financial_account_id": str(card_account.id), "statement_day": 18},
            headers=headers,
        ).json()
        limit = client.post(
            f"/cards/{card['id']}/limits", json={"name": "Cap", "amount": 1000}, headers=headers
        ).json()
        cat = client.post(
            f"/cards/{card['id']}/categories",
            json={"name": "Dining", "limit_id": limit["id"]},
            headers=headers,
        ).json()

        # Omitting the key preserves it — renaming must not silently unmeter.
        renamed = client.put(
            f"/cards/categories/{cat['id']}", json={"name": "Food"}, headers=headers
        ).json()
        assert renamed["limit_id"] == limit["id"]

        # An explicit null detaches it.
        detached = client.put(
            f"/cards/categories/{cat['id']}", json={"limit_id": None}, headers=headers
        ).json()
        assert detached["limit_id"] is None

    def test_deleting_a_limit_leaves_its_categories_unmetered_not_deleted(
        self, client, headers, card_account
    ):
        card = client.post(
            "/cards",
            json={"financial_account_id": str(card_account.id), "statement_day": 18},
            headers=headers,
        ).json()
        limit = client.post(
            f"/cards/{card['id']}/limits", json={"name": "Cap", "amount": 1000}, headers=headers
        ).json()
        client.post(
            f"/cards/{card['id']}/categories",
            json={"name": "Dining", "limit_id": limit["id"]},
            headers=headers,
        )
        assert client.delete(f"/cards/limits/{limit['id']}", headers=headers).status_code == 204

        refreshed = client.get(f"/cards/{card['id']}", headers=headers).json()
        assert [c["name"] for c in refreshed["categories"]] == ["Dining"]
        assert refreshed["categories"][0]["limit_id"] is None

    def test_a_category_in_use_is_a_409_not_a_500(
        self, client, headers, db_session, card_account, dining
    ):
        card = client.post(
            "/cards",
            json={"financial_account_id": str(card_account.id), "statement_day": 18},
            headers=headers,
        ).json()
        cat = client.post(
            f"/cards/{card['id']}/categories", json={"name": "Dining"}, headers=headers
        ).json()
        db_card = db_session.query(models.Card).filter(models.Card.id == uuid.UUID(card["id"])).first()
        db_cat = next(c for c in db_card.categories if str(c.id) == cat["id"])
        _spend(db_session, card_account, dining, 10, date(2026, 9, 1), card_category=db_cat)

        res = client.delete(f"/cards/categories/{cat['id']}", headers=headers)
        assert res.status_code == 409
        assert "transaction" in res.json()["detail"].lower()

    def test_the_status_endpoint_reports_both_directions(
        self, client, headers, db_session, card_account, dining
    ):
        card = client.post(
            "/cards",
            json={"financial_account_id": str(card_account.id), "statement_day": 18},
            headers=headers,
        ).json()
        cap = client.post(
            f"/cards/{card['id']}/limits",
            json={"name": "Dining cap", "amount": 1000, "direction": "ceiling"},
            headers=headers,
        ).json()
        floor = client.post(
            f"/cards/{card['id']}/limits",
            json={"name": "Fee waiver", "amount": 800, "direction": "floor"},
            headers=headers,
        ).json()
        client.post(
            f"/cards/{card['id']}/categories",
            json={"name": "Dining", "limit_id": cap["id"]},
            headers=headers,
        )
        client.post(
            f"/cards/{card['id']}/categories",
            json={"name": "Everything else", "limit_id": floor["id"]},
            headers=headers,
        )

        res = client.get(f"/cards/{card['id']}/status?on=2026-09-05", headers=headers)
        assert res.status_code == 200
        body = res.json()
        assert body["cycle_start"] == "2026-08-19"
        assert body["cycle_end"] == "2026-09-18"
        by_name = {row["name"]: row for row in body["limits"]}
        assert by_name["Dining cap"]["direction"] == "ceiling"
        assert by_name["Fee waiver"]["direction"] == "floor"
        assert by_name["Fee waiver"]["remaining"] == "800.00", "the whole minimum still to go"


class TestTransactionIntegrity:
    def test_tagging_with_another_cards_category_is_rejected(
        self, client, headers, db_session, card_account, bank_account, dining, household
    ):
        card = client.post(
            "/cards",
            json={"financial_account_id": str(card_account.id), "statement_day": 18},
            headers=headers,
        ).json()
        cat = client.post(
            f"/cards/{card['id']}/categories", json={"name": "Dining"}, headers=headers
        ).json()

        # Same household, but a bank account with no card at all.
        res = client.post(
            "/cashflow/transactions",
            json={
                "account_id": str(bank_account.id),
                "category_id": str(dining.id),
                "date": "2026-09-01T12:00:00Z",
                "amount": 50,
                "card_category_id": cat["id"],
            },
            headers=headers,
        )
        assert res.status_code == 400
        assert "different card" in res.json()["detail"].lower()

    def test_moving_a_transaction_off_the_card_clears_the_pick(
        self, client, headers, db_session, card_account, bank_account, dining
    ):
        card = client.post(
            "/cards",
            json={"financial_account_id": str(card_account.id), "statement_day": 18},
            headers=headers,
        ).json()
        cat = client.post(
            f"/cards/{card['id']}/categories", json={"name": "Dining"}, headers=headers
        ).json()
        created = client.post(
            "/cashflow/transactions",
            json={
                "account_id": str(card_account.id),
                "category_id": str(dining.id),
                "date": "2026-09-01T12:00:00Z",
                "amount": 50,
                "card_category_id": cat["id"],
            },
            headers=headers,
        ).json()
        assert created["card_category_id"] == cat["id"]

        # Moving it to the bank account must not leave a pick pointing into a
        # card taxonomy the row no longer belongs to.
        moved = client.put(
            f"/cashflow/transactions/{created['id']}",
            json={
                "account_id": str(bank_account.id),
                "date": "2026-09-01T12:00:00Z",
                "amount": 50,
                "description": "",
                "category_id": str(dining.id),
            },
            headers=headers,
        )
        assert moved.status_code == 200
        assert moved.json()["card_category_id"] is None

    def test_an_unrelated_edit_preserves_the_pick(
        self, client, headers, card_account, dining
    ):
        card = client.post(
            "/cards",
            json={"financial_account_id": str(card_account.id), "statement_day": 18},
            headers=headers,
        ).json()
        cat = client.post(
            f"/cards/{card['id']}/categories", json={"name": "Dining"}, headers=headers
        ).json()
        created = client.post(
            "/cashflow/transactions",
            json={
                "account_id": str(card_account.id),
                "category_id": str(dining.id),
                "date": "2026-09-01T12:00:00Z",
                "amount": 50,
                "card_category_id": cat["id"],
            },
            headers=headers,
        ).json()

        edited = client.put(
            f"/cashflow/transactions/{created['id']}",
            json={
                "account_id": str(card_account.id),
                "date": "2026-09-01T12:00:00Z",
                "amount": 50,
                "description": "Lunch",
                "category_id": str(dining.id),
            },
            headers=headers,
        )
        assert edited.status_code == 200
        assert edited.json()["card_category_id"] == cat["id"], "a description edit must not untag"
