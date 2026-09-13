# Card-Anniversary Limit Windows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a card limit reset on the card's membership year or membership quarter, counted from a user-set anniversary date, on backend, web, iOS and Android.

**Architecture:** A nullable `Card.anniversary_date` plus two new `LimitResetBasis` values (`card_year`, `card_quarter`). `limit_bounds` computes each window as `anchor + n×months`, clamped to month end, never stepped. The server returns `period_start/period_end`, so clients only gain models, a picker, and an Edit card form; none of them computes windows.

**Tech Stack:** FastAPI + SQLAlchemy + Alembic + pytest; React Router v7 + Vitest; SwiftUI + Swift Testing; Jetpack Compose + kotlinx.serialization + JUnit.

**Spec:** `docs/superpowers/specs/2026-09-12-card-anniversary-limits-design.md`

## Global Constraints

- Wire values: `card_year`, `card_quarter`. JSON field: `anniversary_date` (a bare `yyyy-MM-dd` date, nullable).
- The window boundary is always `anchor + n × (12 | 3) months`, clamped to month end (`_clamped_day`), **never** stepped from the previous boundary.
- A missing anchor for an anniversary basis is a **400**, never a silent fallback to the calendar year.
- `CardUpdate.anniversary_date` is three-state: an omitted key preserves it, `null` clears it.
- Native clients decode an unknown `reset_basis` as `unknown` and never throw. A card year must not be relabelled as a known basis.
- Migrations only via `uv run alembic revision --autogenerate`. Never hand-write one.
- **Worktree:** use absolute paths. Set `W=/Users/ivanlee/Developer/finance-tracker/.claude/worktrees/finance-tracker-brainstorm-18242a`. A relative `cd backend` can land in the main checkout.
- Picker copy (identical on all clients): "Each card year", "Each card quarter"; hint: "Set the card's anniversary first".

---

### Task 1: Backend model, schema, migration and window maths

**Files:**
- Modify: `backend/src/card_models.py` (imports; `LimitResetBasis`; `Card`)
- Modify: `backend/src/schemas.py:482-500` (`LimitResetField`, `CardBase`, `CardUpdate`)
- Modify: `backend/src/services/card_service.py:96-112` (`limit_bounds` + new helpers)
- Create: `backend/alembic/versions/<generated>_card_anniversary_date.py` (via CLI)
- Test: `backend/tests/test_card_limits.py`

**Interfaces:**
- Produces: `models.LimitResetBasis.card_year`, `.card_quarter`; `models.Card.anniversary_date: date | None`; `card_service.ANNIVERSARY_RESET_BASES: frozenset[LimitResetBasis]`; `card_service.anniversary_bounds(anchor: date, on: date, step_months: int) -> tuple[date, date]`; `limit_bounds` raises `ValueError` for an anniversary basis with no anchor.

- [ ] **Step 0: Prepare the worktree**

```bash
W=/Users/ivanlee/Developer/finance-tracker/.claude/worktrees/finance-tracker-brainstorm-18242a
cp /Users/ivanlee/Developer/finance-tracker/backend/.env $W/backend/.env
cp /Users/ivanlee/Developer/finance-tracker/backend/.env.development $W/backend/.env.development 2>/dev/null || true
cp /Users/ivanlee/Developer/finance-tracker/android/local.properties $W/android/local.properties
docker compose -f /Users/ivanlee/Developer/finance-tracker/docker-compose.yml up -d db
```

Tests connect to `postgresql://fin:fin@127.0.0.1:5432/fin_test` by default (`backend/tests/conftest.py`). Run them from the host in `$W/backend`, **not** via `docker compose exec`: the container bind-mounts the main checkout, not this worktree.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/test_card_limits.py`, extend the `_card` helper:

```python
def _card(db_session, account, *, basis=models.CycleBasis.statement, day=18, anniversary=None):
    card = models.Card(
        id=uuid.uuid7(),
        financial_account_id=account.id,
        cycle_basis=basis,
        statement_day=day,
        anniversary_date=anniversary,
    )
    db_session.add(card)
    db_session.commit()
    db_session.refresh(card)
    return card
```

Add after `class TestLimitBounds` (keep its existing tests):

```python
class TestAnniversaryWindows:
    """
    A card year runs from the date the card was opened, not from January.

    The boundary is computed as "anchor + n months, clamped" rather than stepped
    from the last one, for the reason the recurrence engine documents: stepping
    clamps 31 Jan to 30 Apr and never climbs back, so every later quarter would
    quietly start on the 30th.
    """

    def test_a_card_year_runs_from_one_anniversary_to_the_day_before_the_next(self):
        assert card_service.anniversary_bounds(date(2024, 3, 14), date(2026, 9, 11), 12) == (
            date(2026, 3, 14),
            date(2027, 3, 13),
        )

    def test_the_anniversary_itself_starts_a_new_year(self):
        assert card_service.anniversary_bounds(date(2024, 3, 14), date(2026, 3, 14), 12)[0] == date(2026, 3, 14)
        assert card_service.anniversary_bounds(date(2024, 3, 14), date(2026, 3, 13), 12) == (
            date(2025, 3, 14),
            date(2026, 3, 13),
        )

    def test_card_quarters_step_three_months_from_the_anchor(self):
        assert card_service.anniversary_bounds(date(2024, 3, 14), date(2026, 9, 11), 3) == (
            date(2026, 6, 14),
            date(2026, 9, 13),
        )

    def test_a_31st_anchor_does_not_drift_down_after_a_short_month(self):
        anchor = date(2024, 1, 31)
        # April has 30 days, so that quarter opens on the 30th...
        assert card_service.anniversary_bounds(anchor, date(2026, 5, 15), 3) == (
            date(2026, 4, 30),
            date(2026, 7, 30),
        )
        # ...and the next one climbs back to the 31st, two years on.
        assert card_service.anniversary_bounds(anchor, date(2026, 8, 1), 3)[0] == date(2026, 7, 31)

    def test_a_leap_day_anchor_falls_back_to_the_28th_and_returns(self):
        anchor = date(2024, 2, 29)
        assert card_service.anniversary_bounds(anchor, date(2025, 6, 1), 12) == (
            date(2025, 2, 28),
            date(2026, 2, 27),
        )
        assert card_service.anniversary_bounds(anchor, date(2028, 3, 1), 12)[0] == date(2028, 2, 29)

    def test_dates_before_the_card_opened_still_resolve(self):
        start, end = card_service.anniversary_bounds(date(2026, 3, 14), date(2025, 1, 5), 12)
        assert (start, end) == (date(2024, 3, 14), date(2025, 3, 13))

    @pytest.mark.parametrize("anchor", [date(2024, 3, 14), date(2024, 1, 31), date(2024, 2, 29)])
    @pytest.mark.parametrize("step", [12, 3])
    def test_every_day_lands_in_exactly_one_window(self, anchor, step):
        """Over a leap year and the non-leap year after it: no gaps, no overlaps."""
        day = date(2028, 1, 1)
        _, current_end = card_service.anniversary_bounds(anchor, day, step)
        while day < date(2029, 12, 31):
            start, end = card_service.anniversary_bounds(anchor, day, step)
            assert start <= day <= end
            if end != current_end:
                assert start == current_end + card_service.ONE_DAY
                current_end = end
            day += card_service.ONE_DAY

    def test_the_ends_of_the_calendar_answer_instead_of_crashing(self):
        start, end = card_service.anniversary_bounds(date(2024, 3, 14), date(9999, 12, 31), 12)
        assert start <= date(9999, 12, 31) <= end
        start, end = card_service.anniversary_bounds(date(2024, 3, 14), date(1, 1, 1), 12)
        assert start <= date(1, 1, 1) <= end

    def test_limit_bounds_uses_the_cards_anniversary(self, db_session, card_account):
        card = _card(db_session, card_account, anniversary=date(2024, 3, 14))
        year = _limit(db_session, card, "Y", 100, reset=models.LimitResetBasis.card_year)
        quarter = _limit(db_session, card, "Q", 100, reset=models.LimitResetBasis.card_quarter)
        assert card_service.limit_bounds(card, year, date(2026, 9, 11)) == (date(2026, 3, 14), date(2027, 3, 13))
        assert card_service.limit_bounds(card, quarter, date(2026, 9, 11)) == (date(2026, 6, 14), date(2026, 9, 13))

    def test_an_anniversary_limit_on_a_card_with_no_anniversary_refuses_to_guess(self, db_session, card_account):
        card = _card(db_session, card_account)
        lim = _limit(db_session, card, "Y", 100, reset=models.LimitResetBasis.card_year)
        with pytest.raises(ValueError):
            card_service.limit_bounds(card, lim, date(2026, 9, 11))
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd $W/backend && uv run pytest tests/test_card_limits.py -k "Anniversary" -q`
Expected: FAIL, because `Card` has no `anniversary_date` / `card_service` has no `anniversary_bounds`.

- [ ] **Step 3: Implement the model**

In `backend/src/card_models.py`, add `Date` to the `sqlalchemy` import list. Extend the enum:

```python
class LimitResetBasis(enum.Enum):
    """
    How often a card limit starts over.

    ``cycle`` follows the card's own statement window; ``calendar_month``,
    ``quarter`` and ``year`` are ordinary calendar periods, which some issuers use
    for caps even on a card whose statement closes mid-month. ``card_year`` and
    ``card_quarter`` count from the card's `anniversary_date` instead — the
    membership year many issuers reset annual caps on.
    """

    cycle = "cycle"
    calendar_month = "calendar_month"
    quarter = "quarter"
    year = "year"
    card_year = "card_year"
    card_quarter = "card_quarter"
```

Add to `Card`, directly under `statement_day`:

```python
    # The date the card was opened, which anchors `card_year` and `card_quarter`
    # limits. Optional because most limits never need it; stated by the user and
    # never inferred, like `statement_day`. Only its month and day drive the
    # windows. A full date rather than a month-day pair because it is what the
    # issuer prints, and every client already has a date picker.
    anniversary_date = Column(Date, nullable=True)
```

- [ ] **Step 4: Implement the window maths**

In `backend/src/services/card_service.py`, add below `statement_bounds`:

```python
# Limits counted from the card's anniversary rather than the calendar.
ANNIVERSARY_RESET_BASES = frozenset(
    {models.LimitResetBasis.card_year, models.LimitResetBasis.card_quarter}
)


def _months_after(anchor: date, months: int) -> Optional[date]:
    """`anchor` moved by whole months, clamped to month end; None off the calendar."""
    total = anchor.year * 12 + (anchor.month - 1) + months
    year, month_index = divmod(total, 12)
    return _neighbouring_close(year, month_index + 1, anchor.day)


def anniversary_bounds(anchor: date, on: date, step_months: int) -> tuple[date, date]:
    """
    The `step_months` window counted from `anchor` that contains `on`.

    Every boundary is `anchor + n × step_months`, clamped to month end — never
    stepped from the previous boundary, which would clamp 31 Jan to 30 Apr and
    then stay on the 30th for good. A window ends the day before the next one
    starts, so every day belongs to exactly one.
    """
    months_since = (on.year - anchor.year) * 12 + (on.month - anchor.month)
    n = months_since // step_months
    start = _months_after(anchor, n * step_months)
    # Early in the anchor's month the window has not turned over yet.
    if start is not None and start > on:
        n -= 1
        start = _months_after(anchor, n * step_months)
    following = _months_after(anchor, (n + 1) * step_months)
    return (
        start or date.min,
        following - ONE_DAY if following else date.max,
    )
```

Replace the body of `limit_bounds` so it handles the new bases first:

```python
    if limit.reset_basis in ANNIVERSARY_RESET_BASES:
        if card.anniversary_date is None:
            # The router refuses to create this state; reaching it means a
            # guess would follow, and a guessed window is a wrong meter.
            raise ValueError("An anniversary limit needs the card's anniversary_date.")
        step = 12 if limit.reset_basis == models.LimitResetBasis.card_year else 3
        return anniversary_bounds(card.anniversary_date, on, step)
    if limit.reset_basis == models.LimitResetBasis.cycle:
        return statement_bounds(card, on)
    if limit.reset_basis == models.LimitResetBasis.calendar_month:
        return date(on.year, on.month, 1), _clamped_day(on.year, on.month, 31)
    if limit.reset_basis == models.LimitResetBasis.quarter:
        first = 3 * ((on.month - 1) // 3) + 1
        last = first + 2
        return date(on.year, first, 1), _clamped_day(on.year, last, 31)
    return date(on.year, 1, 1), date(on.year, 12, 31)
```

Update the `limit_bounds` docstring to mention the anniversary bases.

- [ ] **Step 5: Implement the schema**

In `backend/src/schemas.py`:

```python
LimitResetField = Annotated[
    Literal["cycle", "calendar_month", "quarter", "year", "card_year", "card_quarter"],
    BeforeValidator(_enum_to_value),
]


class CardBase(BaseModel):
    cycle_basis: CycleBasisField = "statement"
    # 1-31, clamped to the end of shorter months so a card closing on the 31st
    # still closes in February.
    statement_day: int = Field(1, ge=1, le=31)
    # Anchors card_year / card_quarter limits. Only month and day are used.
    anniversary_date: Optional[date] = None


class CardUpdate(BaseModel):
    cycle_basis: Optional[CycleBasisField] = None
    statement_day: Optional[int] = Field(None, ge=1, le=31)
    # Three states: omitted leaves it alone, null clears it (read via
    # exclude_unset in the router). Clearing is refused while a limit uses it.
    anniversary_date: Optional[date] = None
```

- [ ] **Step 6: Generate the migration**

```bash
cd $W/backend && uv run alembic upgrade head && uv run alembic revision --autogenerate -m "card anniversary date"
```

Open the generated file. It must contain only `op.add_column('cards', sa.Column('anniversary_date', sa.Date(), nullable=True))` and the matching `drop_column` in `downgrade`. Delete anything else, since unrelated drift is not ours to ship. Then confirm that `card_limits.reset_basis` is wide enough:

```bash
cd $W/backend && grep -rn "reset_basis" alembic/versions/ | head
```

The column was created as `sa.Enum(..., native_enum=False)` with `calendar_month` (14 characters). `card_quarter` is 12, so it fits. If the column turns out to be a VARCHAR shorter than 12, stop and report it.

Then: `uv run alembic upgrade head && uv run alembic check`
Expected: `No new upgrade operations detected.`

- [ ] **Step 7: Run the tests and confirm they pass**

Run: `cd $W/backend && uv run pytest tests/test_card_limits.py -q`
Expected: all pass, the existing ones included.

- [ ] **Step 8: Commit**

```bash
cd $W && git add backend/src/card_models.py backend/src/schemas.py backend/src/services/card_service.py backend/alembic/versions backend/tests/test_card_limits.py
git commit -m "feat(cards): card-year and card-quarter limit windows (#275)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Backend endpoints: accept, validate and return the anniversary

**Files:**
- Modify: `backend/src/routers/cards.py` (`_card_response`, `create_card`, `update_card`, `create_limit`, `update_limit`)
- Test: `backend/tests/test_card_limits.py`

**Interfaces:**
- Consumes: `card_service.ANNIVERSARY_RESET_BASES`, `models.Card.anniversary_date`.
- Produces: `CardResponse.anniversary_date` on every card endpoint; the 400s described below.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_card_limits.py`:

```python
class TestAnniversaryEndpoints:
    def _new_card(self, client, headers, account, **extra):
        res = client.post(
            "/cards",
            json={"financial_account_id": str(account.id), "statement_day": 18, **extra},
            headers=headers,
        )
        assert res.status_code == 201, res.text
        return res.json()

    def test_a_card_can_be_created_with_an_anniversary(self, client, headers, card_account):
        card = self._new_card(client, headers, card_account, anniversary_date="2024-03-14")
        assert card["anniversary_date"] == "2024-03-14"

    def test_a_card_without_one_reads_null(self, client, headers, card_account):
        assert self._new_card(client, headers, card_account)["anniversary_date"] is None

    def test_an_anniversary_limit_needs_the_date_first(self, client, headers, card_account):
        card = self._new_card(client, headers, card_account)
        res = client.post(
            f"/cards/{card['id']}/limits",
            json={"name": "Annual cap", "amount": 25000, "reset_basis": "card_year"},
            headers=headers,
        )
        assert res.status_code == 400
        assert "anniversary" in res.json()["detail"].lower()

    def test_switching_a_limit_to_card_quarter_needs_the_date_too(self, client, headers, card_account):
        card = self._new_card(client, headers, card_account)
        limit = client.post(
            f"/cards/{card['id']}/limits",
            json={"name": "Cap", "amount": 1000},
            headers=headers,
        ).json()
        res = client.put(
            f"/cards/limits/{limit['id']}", json={"reset_basis": "card_quarter"}, headers=headers
        )
        assert res.status_code == 400

    def test_omitting_the_date_on_update_preserves_it(self, client, headers, card_account):
        card = self._new_card(client, headers, card_account, anniversary_date="2024-03-14")
        res = client.put(f"/cards/{card['id']}", json={"statement_day": 5}, headers=headers)
        assert res.status_code == 200
        assert res.json()["anniversary_date"] == "2024-03-14"

    def test_an_explicit_null_clears_it(self, client, headers, card_account):
        card = self._new_card(client, headers, card_account, anniversary_date="2024-03-14")
        res = client.put(f"/cards/{card['id']}", json={"anniversary_date": None}, headers=headers)
        assert res.status_code == 200
        assert res.json()["anniversary_date"] is None

    def test_clearing_it_is_refused_while_a_limit_counts_from_it(self, client, headers, card_account):
        card = self._new_card(client, headers, card_account, anniversary_date="2024-03-14")
        client.post(
            f"/cards/{card['id']}/limits",
            json={"name": "Annual cap", "amount": 25000, "reset_basis": "card_year"},
            headers=headers,
        )
        res = client.put(f"/cards/{card['id']}", json={"anniversary_date": None}, headers=headers)
        assert res.status_code == 400
        assert "Annual cap" in res.json()["detail"]

    def test_moving_the_date_is_allowed_while_a_limit_counts_from_it(self, client, headers, card_account):
        card = self._new_card(client, headers, card_account, anniversary_date="2024-03-14")
        client.post(
            f"/cards/{card['id']}/limits",
            json={"name": "Annual cap", "amount": 25000, "reset_basis": "card_year"},
            headers=headers,
        )
        res = client.put(f"/cards/{card['id']}", json={"anniversary_date": "2024-04-01"}, headers=headers)
        assert res.status_code == 200

```

Also add, in the same file:

```python
class TestAnniversaryMeter:
    def test_last_aprils_charge_counts_toward_the_card_year_not_the_calendar_year(
        self, db_session, card_account, dining
    ):
        card = _card(db_session, card_account, anniversary=date(2024, 3, 14))
        card_year = _limit(db_session, card, "Card year", 25000, reset=models.LimitResetBasis.card_year)
        calendar_year = _limit(db_session, card, "Calendar year", 25000, reset=models.LimitResetBasis.year)
        a = _category(db_session, card, "A", limit=card_year, is_default=True)
        b = _category(db_session, card, "B", limit=calendar_year)

        _spend(db_session, card_account, dining, 400, date(2025, 4, 2), card_category=a)
        _spend(db_session, card_account, dining, 400, date(2025, 4, 2), card_category=b)

        by_name = {
            s.limit.name: s
            for s in card_service.card_limit_statuses(db_session, card, on=date(2026, 1, 10))
        }
        assert (by_name["Card year"].period_start, by_name["Card year"].period_end) == (
            date(2025, 3, 14),
            date(2026, 3, 13),
        )
        assert by_name["Card year"].spent == Decimal("400.00")
        assert by_name["Calendar year"].spent == Decimal("0.00")
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd $W/backend && uv run pytest tests/test_card_limits.py -k "AnniversaryEndpoints or AnniversaryMeter" -q`
Expected: the endpoint tests FAIL (`anniversary_date` missing from the response / no 400). The meter test may already pass after Task 1. That's fine: it pins behaviour.

- [ ] **Step 3: Implement the router**

In `backend/src/routers/cards.py`:

Add `anniversary_date=card.anniversary_date,` to `_card_response` (after `statement_day`) and to the `models.Card(...)` constructor in `create_card`.

Add a helper under `_card_response`:

```python
ANNIVERSARY_NEEDED = (
    "Set the card's anniversary date first — a card-year or card-quarter "
    "limit is counted from it."
)


def _require_anniversary_for(card: models.Card, reset_basis: str) -> None:
    """
    Refuse an anniversary limit on a card with no anniversary.

    Falling back to the calendar year would meter over a window the issuer never
    applies and still look plausible — the silent kind of wrong.
    """
    basis = models.LimitResetBasis(reset_basis)
    if basis in card_service.ANNIVERSARY_RESET_BASES and card.anniversary_date is None:
        raise HTTPException(status_code=400, detail=ANNIVERSARY_NEEDED)
```

In `create_limit`, after `card = _visible_card(...)`: `_require_anniversary_for(card, payload.reset_basis)`.

In `update_limit`, change `_visible_card(db, limit.card_id, current_user)` to `card = _visible_card(db, limit.card_id, current_user)`, and before assigning `reset_basis`:

```python
    if payload.reset_basis is not None:
        _require_anniversary_for(card, payload.reset_basis)
        limit.reset_basis = models.LimitResetBasis(payload.reset_basis)
```

Replace the body of `update_card` after `_visible_card`:

```python
    card = _visible_card(db, card_id, current_user)
    fields = payload.model_dump(exclude_unset=True)
    if payload.cycle_basis is not None:
        card.cycle_basis = models.CycleBasis(payload.cycle_basis)
    if payload.statement_day is not None:
        card.statement_day = payload.statement_day
    if "anniversary_date" in fields:
        if fields["anniversary_date"] is None:
            dependent = [
                l.name for l in card.limits
                if l.reset_basis in card_service.ANNIVERSARY_RESET_BASES
            ]
            if dependent:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "These limits count from the anniversary: "
                        f"{', '.join(dependent)}. Change their reset first, or keep the date."
                    ),
                )
        card.anniversary_date = fields["anniversary_date"]
    db.commit()
    db.refresh(card)
    return _card_response(card, _account_or_404(db, card.financial_account_id))
```

- [ ] **Step 4: Run the whole card suite and confirm it passes**

Run: `cd $W/backend && uv run pytest tests/test_card_limits.py tests/test_mcc_reference.py -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
cd $W && git add backend/src/routers/cards.py backend/tests/test_card_limits.py
git commit -m "feat(cards): anniversary date on the card endpoints, 400 without one (#275)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Web: types, picker, setup date and a card-settings form

**Files:**
- Modify: `frontend/src/types/types.ts:650-685`
- Create: `frontend/src/pages/Cards/cardForms.ts`
- Create: `frontend/src/pages/Cards/cardForms.test.ts`
- Modify: `frontend/src/pages/Cards/CardDialogs.tsx` (remove `RESET_OPTIONS`; `SetUpCardDialog`; `AddLimitForm`; new `CardSettingsForm`; `ManageCardDialog`)
- Modify: `frontend/src/pages/Cards/cards.loader.ts:58-83`
- Modify: `frontend/src/pages/Cards/Cards.test.tsx` (fixture gains `anniversary_date`)

**Interfaces:**
- Consumes: backend `anniversary_date`, `card_year`, `card_quarter`.
- Produces: `resetOptions(hasAnniversary: boolean): SelectOption[]`, `cardUpdateBody(formData: FormData): Record<string, unknown>`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/pages/Cards/cardForms.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { cardUpdateBody, resetOptions } from './cardForms';

describe('resetOptions', () => {
    it('offers the card year and quarter only once there is an anniversary', () => {
        const without = resetOptions(false);
        const cardYear = without.find(o => o.value === 'card_year');
        expect(cardYear?.disabled).toBe(true);
        expect(String(cardYear?.label)).toMatch(/anniversary first/i);

        const withDate = resetOptions(true);
        expect(withDate.find(o => o.value === 'card_year')?.disabled).toBeFalsy();
        expect(withDate.find(o => o.value === 'card_quarter')?.disabled).toBeFalsy();
    });

    it('keeps every calendar basis available regardless', () => {
        const values = resetOptions(false).filter(o => !o.disabled).map(o => o.value);
        expect(values).toEqual(['cycle', 'calendar_month', 'quarter', 'year']);
    });
});

describe('cardUpdateBody', () => {
    const form = (entries: Record<string, string>) => {
        const fd = new FormData();
        Object.entries(entries).forEach(([k, v]) => fd.append(k, v));
        return fd;
    };

    it('sends the anniversary the user picked', () => {
        expect(cardUpdateBody(form({ cycle_basis: 'statement', statement_day: '18', anniversary_date: '2024-03-14' })))
            .toEqual({ cycle_basis: 'statement', statement_day: 18, anniversary_date: '2024-03-14' });
    });

    it('sends an explicit null for a cleared date, which is what clears it', () => {
        const body = cardUpdateBody(form({ cycle_basis: 'statement', statement_day: '18', anniversary_date: '' }));
        expect(body).toHaveProperty('anniversary_date', null);
    });

    it('leaves the statement day out when a calendar card hides the field', () => {
        const body = cardUpdateBody(form({ cycle_basis: 'calendar', anniversary_date: '' }));
        expect(body).not.toHaveProperty('statement_day');
    });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd $W/frontend && pnpm vitest run src/pages/Cards/cardForms.test.ts`
Expected: FAIL, because the module does not exist.

- [ ] **Step 3: Implement `cardForms.ts`**

```ts
import type { SelectOption } from "../../components/ui/Select";

/**
 * Form helpers for the Cards dialogs, kept out of the components so the rules
 * that decide what gets sent can be tested without rendering anything.
 */

const ANNIVERSARY_HINT = " — set the card's anniversary first";

/**
 * Every reset basis, with the two anniversary ones disabled until the card has
 * a date. Disabled rather than hidden, so the option is discoverable; the
 * server refuses them without a date anyway, and this keeps that a backstop.
 */
export function resetOptions(hasAnniversary: boolean): SelectOption[] {
    const hint = hasAnniversary ? "" : ANNIVERSARY_HINT;
    return [
        { value: "cycle", label: "Resets each statement cycle" },
        { value: "calendar_month", label: "Resets each calendar month" },
        { value: "quarter", label: "Resets each quarter" },
        { value: "year", label: "Resets each year" },
        { value: "card_year", label: `Resets each card year${hint}`, disabled: !hasAnniversary },
        { value: "card_quarter", label: `Resets each card quarter${hint}`, disabled: !hasAnniversary },
    ];
}

/**
 * The PUT /cards/{id} body from the card-settings form.
 *
 * The form always states the anniversary, so an empty field is an explicit
 * `null` — the backend's "clear it", as opposed to an omitted key, which would
 * preserve it. The statement day is omitted when a calendar card hides it,
 * rather than sent as 0 and rejected.
 */
export function cardUpdateBody(formData: FormData): Record<string, unknown> {
    const anniversary = String(formData.get("anniversary_date") ?? "").trim();
    const day = Number(formData.get("statement_day"));
    return {
        cycle_basis: formData.get("cycle_basis"),
        ...(day ? { statement_day: day } : {}),
        anniversary_date: anniversary || null,
    };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd $W/frontend && pnpm vitest run src/pages/Cards/cardForms.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the types**

In `frontend/src/types/types.ts`:

```ts
export type LimitResetBasis =
  | "cycle" | "calendar_month" | "quarter" | "year" | "card_year" | "card_quarter";
```

Add to `CardResponse` after `statement_day`:

```ts
  /** "yyyy-MM-dd". Anchors card_year / card_quarter limits; null when unset. */
  anniversary_date: string | null;
```

Add `anniversary_date: null,` to the card fixture in `Cards.test.tsx`, after `statement_day: 18`.

- [ ] **Step 6: Wire the loader**

In `cards.loader.ts`, add `import { cardUpdateBody } from "./cardForms";`. In `createCard`, add `anniversary_date: formData.get("anniversary_date") || null,` to the body. Replace the `updateCard` body with `body: JSON.stringify(cardUpdateBody(formData)),` and change its failure message to `"Couldn't update the card."`.

- [ ] **Step 7: Wire the dialogs**

In `CardDialogs.tsx`:
- Delete the `RESET_OPTIONS` constant and import `{ resetOptions } from "./cardForms"`.
- In `AddLimitForm`, change `options={RESET_OPTIONS}` to `options={resetOptions(Boolean(card.anniversary_date))}`.
- In `SetUpCardDialog`, add after the statement-day block (outside the `cycleBasis === "statement"` condition):

```tsx
                    <Input
                        label="Card anniversary (optional)"
                        name="anniversary_date"
                        type="date"
                        helperText="The date the card was opened. Limits that reset each card year or card quarter count from it."
                    />
```

- Add a settings form above the Limits section. It uses a fetcher, following the comment on `AddLimitForm`:

```tsx
function CardSettingsForm({ card }: { card: CardResponse }) {
    const fetcher = useFetcher<{ error?: string; success?: boolean }>();
    const [cycleBasis, setCycleBasis] = useState<string>(card.cycle_basis);

    return (
        <fetcher.Form method="post" className="grid grid-cols-2 gap-2">
            <input type="hidden" name="_intent" value="updateCard" />
            <input type="hidden" name="cardId" value={card.id} />
            <Select
                label="Limits reset on"
                name="cycle_basis"
                value={cycleBasis}
                onChange={setCycleBasis}
                wrapperClassName="col-span-2"
                options={[
                    { value: "statement", label: "The statement cycle" },
                    { value: "calendar", label: "The calendar month" },
                ]}
            />
            {cycleBasis === "statement" && (
                <Input
                    label="Statement closes on day"
                    name="statement_day"
                    type="number"
                    min="1"
                    max="31"
                    defaultValue={String(card.statement_day)}
                />
            )}
            <Input
                label="Card anniversary"
                name="anniversary_date"
                type="date"
                defaultValue={card.anniversary_date ?? ""}
                helperText="Clear it to remove. Needed for card-year and card-quarter limits."
            />
            {fetcher.data?.error && (
                <p className="col-span-2 text-xs text-red-600 dark:text-red-400">{fetcher.data.error}</p>
            )}
            <Button
                type="submit"
                variant="secondary"
                size="sm"
                className="col-span-2"
                disabled={fetcher.state !== "idle"}
            >
                Save card settings
            </Button>
        </fetcher.Form>
    );
}
```

In `ManageCardDialog`, insert before the Limits `<section>`:

```tsx
                    <section className="mb-6">
                        <h4 className="mb-2 text-sm font-medium text-base-900 dark:text-base-50">
                            Card
                        </h4>
                        <CardSettingsForm
                            key={`settings-${card.id}-${card.anniversary_date ?? ""}`}
                            card={card}
                        />
                    </section>
```

Change the Limits `<section className="mb-6">` to `className="mb-6 border-t border-base-100 pt-4 dark:border-base-800"` so the sections read as separate.

- [ ] **Step 8: Run the tests, typecheck and lint**

Run: `cd $W/frontend && pnpm vitest run src/pages/Cards && pnpm typecheck && pnpm lint`
Expected: all pass. A failure in `Cards.test.tsx` about two comboboxes matching `/Cap/` means the new cycle-basis Select also matched. Narrow the test's `find` to the option text `"Cap — stay under"`.

- [ ] **Step 9: Verify in the browser**

Start the dev stack from the main checkout's compose, pointing the web preview at the worktree's frontend. If the dev server can't be run from the worktree, skip this step and say so in the task report. Log in as the preview test user, open Cards → Manage, set an anniversary, save, and confirm "Resets each card year" becomes selectable. Add a card-year limit and confirm its meter shows the anniversary window. Take a screenshot.

- [ ] **Step 10: Commit**

```bash
cd $W && git add frontend/src
git commit -m "feat(web): card anniversary, card-year/quarter resets, card settings form (#275)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: iOS models: new cases, lenient decoding, update body, reset options

**Files:**
- Modify: `ios/FinanceTracker/Models/Models.swift` (`LimitResetBasis` ~1332, `CardResponse` ~1358, `CardCreate` ~1413; add `CardUpdate`)
- Modify: `ios/FinanceTracker/Support/Cards.swift` (add `ResetOption` + `Cards.resetOptions`)
- Test: `ios/FinanceTrackerTests/CardsTests.swift`

**Interfaces:**
- Produces: `LimitResetBasis.cardYear/.cardQuarter/.unknown`; `CardResponse.anniversaryDate: Date?`; `CardCreate.anniversaryDate: String?`; `CardUpdate(cycleBasis: String, statementDay: Int, anniversaryDate: String?)`; `struct ResetOption { let basis: LimitResetBasis; let label: String; let isAvailable: Bool }`; `Cards.resetOptions(hasAnniversary: Bool) -> [ResetOption]`; `Cards.anniversaryHint: String`.

- [ ] **Step 1: Write the failing tests**

Append inside `struct CardsTests` in `CardsTests.swift`:

```swift
    // MARK: - Anniversary resets

    @Test func aCardYearDecodesAsItself() throws {
        let data = #""card_year""#.data(using: .utf8)!
        #expect(try JSONDecoder().decode(LimitResetBasis.self, from: data) == .cardYear)
    }

    @Test func anUnknownScheduleDecodesAsUnknownRatherThanFailingTheCard() throws {
        // A newer server must not blank the Cards screen, and must not be
        // relabelled as a schedule this build does know.
        let data = #""fortnightly""#.data(using: .utf8)!
        #expect(try JSONDecoder().decode(LimitResetBasis.self, from: data) == .unknown)
    }

    @Test func aCardDecodesItsAnniversary() throws {
        let json = """
        {"id":"c","financial_account_id":"a","account_name":"Amex","currency":"SGD",
         "cycle_basis":"statement","statement_day":18,"anniversary_date":"2024-03-14",
         "categories":[],"limits":[]}
        """.data(using: .utf8)!
        let card = try APIClient.decoder.decode(CardResponse.self, from: json)
        #expect(card.anniversaryDate?.apiDateOnly == "2024-03-14")
    }

    private func encodedObject(_ update: CardUpdate) throws -> [String: Any] {
        let data = try APIClient.encoder.encode(update)
        return try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    @Test func aCardUpdateSendsTheAnniversary() throws {
        let object = try encodedObject(CardUpdate(cycleBasis: "statement", statementDay: 18, anniversaryDate: "2024-03-14"))
        #expect(object["anniversary_date"] as? String == "2024-03-14")
    }

    @Test func aClearedAnniversaryIsAnExplicitNullNotAnOmittedKey() throws {
        // Omitted would mean "keep it" to the backend; only null clears it.
        let object = try encodedObject(CardUpdate(cycleBasis: "statement", statementDay: 18, anniversaryDate: nil))
        #expect(object.keys.contains("anniversary_date"))
        #expect(object["anniversary_date"] is NSNull)
    }

    @Test func anniversaryResetsAreOnlyOfferedOnceTheCardHasADate() {
        let without = Cards.resetOptions(hasAnniversary: false)
        #expect(without.filter(\.isAvailable).map(\.basis) == [.cycle, .calendarMonth, .quarter, .year])
        let with = Cards.resetOptions(hasAnniversary: true)
        #expect(with.filter(\.isAvailable).map(\.basis).contains(.cardYear))
        #expect(with.filter(\.isAvailable).map(\.basis).contains(.cardQuarter))
    }
```

Check that `APIClient.decoder` exists as a static, as `APIClient.encoder` does in `ReimbursementsTests`. If only `encoder` is static, use whatever `ModelDecodingTests.swift` uses to decode backend JSON.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd $W/ios && xcodegen generate && xcodebuild -project FinanceTracker.xcodeproj -scheme FinanceTracker -destination 'platform=iOS Simulator,name=iPhone 17 Pro' test -only-testing:FinanceTrackerTests/CardsTests 2>&1 | tail -30`
Expected: compile FAIL (`cardYear`, `CardUpdate`, `resetOptions` undefined).

- [ ] **Step 3: Implement the models**

Replace `LimitResetBasis` in `Models.swift`:

```swift
enum LimitResetBasis: String, Codable, Hashable {
    case cycle
    case calendarMonth = "calendar_month"
    case quarter
    case year
    case cardYear = "card_year"
    case cardQuarter = "card_quarter"
    /// A schedule this build doesn't know — a newer server. Never sent. Not a
    /// fallback to a known case: that would label a card year a statement cycle.
    case unknown

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = LimitResetBasis(rawValue: raw) ?? .unknown
    }
}
```

In `CardResponse`, add after `statementDay`:

```swift
    /// Anchors card-year / card-quarter limits. A date-only field, parsed at UTC midnight.
    var anniversaryDate: Date? = nil
```

(`var` with a default keeps the memberwise initialiser in `CardsTests` compiling, and `Codable` still decodes it.)

In `CardCreate`, add `var anniversaryDate: String? = nil` (bare "yyyy-MM-dd").

Add after `CardCreate`:

```swift
/// PUT /cards/{id} from the Edit card sheet, which states the whole card.
/// `anniversaryDate` is always encoded: the backend reads an omitted key as
/// "keep it" and only an explicit null as "clear it", and synthesized
/// `Encodable` would drop a nil — so this is written by hand.
struct CardUpdate: Encodable {
    let cycleBasis: String
    let statementDay: Int
    /// Bare "yyyy-MM-dd", or nil to clear.
    let anniversaryDate: String?

    private enum CodingKeys: String, CodingKey {
        case cycleBasis, statementDay, anniversaryDate
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(cycleBasis, forKey: .cycleBasis)
        try container.encode(statementDay, forKey: .statementDay)
        // encode(String?) writes an explicit null when nil — the point.
        try container.encode(anniversaryDate, forKey: .anniversaryDate)
    }
}
```

- [ ] **Step 4: Implement the reset options**

In `ios/FinanceTracker/Support/Cards.swift`, add at file scope:

```swift
/// One row of the limit "Resets" picker.
struct ResetOption: Hashable {
    let basis: LimitResetBasis
    let label: String
    /// False for the anniversary resets until the card has a date. The picker
    /// leaves those out (a menu row can't reliably be disabled) and shows the hint.
    let isAvailable: Bool
}
```

and inside the `Cards` enum (wherever its other `static func`s live):

```swift
    static let anniversaryHint = "Set the card's anniversary first — under Edit card — to reset on the card year or card quarter."

    static func resetOptions(hasAnniversary: Bool) -> [ResetOption] {
        [
            ResetOption(basis: .cycle, label: "Each statement cycle", isAvailable: true),
            ResetOption(basis: .calendarMonth, label: "Each calendar month", isAvailable: true),
            ResetOption(basis: .quarter, label: "Each quarter", isAvailable: true),
            ResetOption(basis: .year, label: "Each year", isAvailable: true),
            ResetOption(basis: .cardYear, label: "Each card year", isAvailable: hasAnniversary),
            ResetOption(basis: .cardQuarter, label: "Each card quarter", isAvailable: hasAnniversary),
        ]
    }
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run the command from Step 2.
Expected: `CardsTests` all pass. If the app target fails because a `switch` over `LimitResetBasis` is now non-exhaustive, add explicit cases for `.cardYear`, `.cardQuarter` and `.unknown` there. Grep: `grep -rn "case .calendarMonth" $W/ios/FinanceTracker`.

- [ ] **Step 6: Commit**

```bash
cd $W && git add ios/FinanceTracker/Models/Models.swift ios/FinanceTracker/Support/Cards.swift ios/FinanceTrackerTests/CardsTests.swift
git commit -m "feat(ios): card anniversary models, lenient reset decoding (#275)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: iOS UI: setup date, Edit card sheet, picker

**Files:**
- Create: `ios/FinanceTracker/Views/More/CardEditView.swift`
- Modify: `ios/FinanceTracker/Views/More/CardSetUpViews.swift` (`CardSetUpView`, `CardManageView`)

**Interfaces:**
- Consumes: `CardUpdate`, `CardCreate.anniversaryDate`, `Cards.resetOptions`, `Cards.anniversaryHint`, `Date.apiDateOnly`.
- Produces: `CardEditView(card: CardResponse, onSaved: (CardResponse) async -> Void)`.

- [ ] **Step 1: Add the date to setup**

In `CardSetUpView`, add state:

```swift
    @State private var hasAnniversary = false
    @State private var anniversary = Date()
```

Add a section after the cycle section:

```swift
                Section {
                    Toggle("Card anniversary", isOn: $hasAnniversary)
                    if hasAnniversary {
                        DatePicker("Opened on", selection: $anniversary, displayedComponents: .date)
                            // The backend date means a calendar day, read back at UTC
                            // midnight; pick in UTC so it round-trips to the same day.
                            .environment(\.timeZone, .gmt)
                    }
                } footer: {
                    Text("Optional. Limits that reset each card year or card quarter count from it.")
                }
```

Pass `anniversaryDate: hasAnniversary ? anniversary.apiDateOnly : nil` to `CardCreate(...)`, and add `hasAnniversary, anniversary` to `.discardGuard(fields:)`.

- [ ] **Step 2: Create `CardEditView.swift`**

```swift
import SwiftUI

/// Editing a card after setup: when its limits reset, and the anniversary that
/// card-year and card-quarter limits count from.
///
/// Sends the whole card every time (see `CardUpdate`), so a cleared anniversary
/// goes out as an explicit null. The backend refuses to clear it while a limit
/// still counts from it, and that explanation is shown as-is.
struct CardEditView: View {
    let card: CardResponse
    let onSaved: (CardResponse) async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var cycleBasis: CycleBasis
    @State private var statementDay: Int
    @State private var hasAnniversary: Bool
    @State private var anniversary: Date
    @State private var isSaving = false
    @State private var errorMessage: String?

    init(card: CardResponse, onSaved: @escaping (CardResponse) async -> Void) {
        self.card = card
        self.onSaved = onSaved
        _cycleBasis = State(initialValue: card.cycleBasis)
        _statementDay = State(initialValue: card.statementDay)
        _hasAnniversary = State(initialValue: card.anniversaryDate != nil)
        _anniversary = State(initialValue: card.anniversaryDate ?? Date())
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Limits reset on", selection: $cycleBasis) {
                        Text("The statement cycle").tag(CycleBasis.statement)
                        Text("The calendar month").tag(CycleBasis.calendar)
                    }
                    if cycleBasis == .statement {
                        Stepper("Closes on day \(statementDay)", value: $statementDay, in: 1...31)
                    }
                }

                Section {
                    Toggle("Card anniversary", isOn: $hasAnniversary)
                    if hasAnniversary {
                        DatePicker("Opened on", selection: $anniversary, displayedComponents: .date)
                            .environment(\.timeZone, .gmt)
                    }
                } footer: {
                    Text("Limits that reset each card year or card quarter count from this date.")
                }

                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Edit card")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }.disabled(isSaving)
                }
            }
            .discardGuard(fields: [cycleBasis, statementDay, hasAnniversary, anniversary])
        }
    }

    private func save() {
        isSaving = true
        errorMessage = nil
        Task {
            defer { isSaving = false }
            do {
                let updated: CardResponse = try await APIClient.shared.put(
                    "/cards/\(card.id)",
                    body: CardUpdate(
                        cycleBasis: cycleBasis.rawValue,
                        statementDay: statementDay,
                        anniversaryDate: hasAnniversary ? anniversary.apiDateOnly : nil
                    )
                )
                await onSaved(updated)
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}
```

If `.discardGuard(fields:)` requires `Hashable`/`Equatable` values and `Date` is rejected, match its signature. Check how `ReimbursementsView` guards its `date`.

- [ ] **Step 3: Wire the Manage view**

In `CardManageView`, add state and init:

```swift
    @State private var anniversaryDate: Date?
    @State private var editing = false
```

and in `init`: `_anniversaryDate = State(initialValue: card.anniversaryDate)`.

Replace the `Picker("Resets", …)` block with:

```swift
                    Picker("Resets", selection: $limitReset) {
                        ForEach(Cards.resetOptions(hasAnniversary: anniversaryDate != nil).filter(\.isAvailable), id: \.basis) { option in
                            Text(option.label).tag(option.basis)
                        }
                    }
```

and change the section footer so the anniversary hint shows when there's no date:

```swift
                } footer: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(
                            limitDirection == .floor
                                ? "The spend you need to reach — a fee waiver or a bonus qualifier."
                                : "Enter caps as a spend figure. A cap the issuer states in rewards (\"max $60 cashback\") has to be converted — at 10%, that is $600 of spend."
                        )
                        if anniversaryDate == nil {
                            Text(Cards.anniversaryHint)
                        }
                    }
                }
```

Add a toolbar item and sheet to the `NavigationStack` content:

```swift
                ToolbarItem(placement: .topBarLeading) {
                    Button("Edit card") { editing = true }
                }
```

```swift
            .sheet(isPresented: $editing) {
                CardEditView(card: card) { updated in
                    anniversaryDate = updated.anniversaryDate
                    await onChanged()
                }
            }
```

Pass `card` as-is: the parent reloads via `onChanged`, and the sheet only needs the values current at the time it opens. The one value the Manage view itself depends on (`anniversaryDate`) is updated from the response.

- [ ] **Step 4: Build and run the tests**

Run: `cd $W/ios && xcodegen generate && xcodebuild -project FinanceTracker.xcodeproj -scheme FinanceTracker -destination 'platform=iOS Simulator,name=iPhone 17 Pro' test 2>&1 | tail -30`
Expected: `** TEST SUCCEEDED **`.

- [ ] **Step 5: Verify in the simulator**

Launch the app against the local backend (the preview test user), open More → Cards → Manage → Edit card, set an anniversary and save. Confirm "Each card year" / "Each card quarter" now appear under Resets. Add a card-year limit, and confirm the Cards screen's meter shows the anniversary window. Take a screenshot.

- [ ] **Step 6: Commit**

```bash
cd $W && git add ios/FinanceTracker ios/FinanceTracker.xcodeproj
git commit -m "feat(ios): Edit card sheet with anniversary, card-year/quarter resets (#275)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

(Include `ios/FinanceTracker.xcodeproj` only if it is tracked. Check `git status`.)

---

### Task 6: Android models: new values, lenient decoding, update body, reset options

**Files:**
- Modify: `android/app/src/main/java/com/ivanlee/financetracker/data/model/Models.kt` (~1258 `LimitResetBasis`, ~1288 `CardResponse`, ~1353 `CardCreate`; add `CardUpdate` + `cardUpdate`)
- Modify: `android/app/src/main/java/com/ivanlee/financetracker/logic/Cards.kt` (add `ResetOption`, `resetOptions`, `ANNIVERSARY_HINT`)
- Test: `android/app/src/test/java/com/ivanlee/financetracker/CardsTest.kt`

**Interfaces:**
- Produces: `LimitResetBasis.CARD_YEAR/CARD_QUARTER/UNKNOWN` with `wire: String`; `CardResponse.anniversaryDate: Instant?`; `CardCreate.anniversaryDate: String?`; `CardUpdate`; `fun cardUpdate(cycleBasis: String, statementDay: Int, anniversaryDate: String?): CardUpdate`; `data class ResetOption(val basis: LimitResetBasis, val label: String, val isAvailable: Boolean)`; `fun resetOptions(hasAnniversary: Boolean): List<ResetOption>`; `const val ANNIVERSARY_HINT`.

- [ ] **Step 1: Write the failing tests**

Append to the `CardsTest` class (add the imports it needs: `Api`, `CardUpdate`, `cardUpdate`, `LimitResetBasis`, `resetOptions`, `kotlinx.serialization.encodeToString`, `kotlinx.serialization.decodeFromString`, `kotlinx.serialization.json.jsonObject`, `kotlinx.serialization.json.JsonNull`, `kotlinx.serialization.json.jsonPrimitive`):

```kotlin
    // --- Anniversary resets ---

    @Test
    fun aCardYearDecodesAsItself() {
        assertEquals(LimitResetBasis.CARD_YEAR, Api.json.decodeFromString<LimitResetBasis>("\"card_year\""))
    }

    @Test
    fun anUnknownScheduleDecodesAsUnknownRatherThanFailingTheCard() {
        assertEquals(LimitResetBasis.UNKNOWN, Api.json.decodeFromString<LimitResetBasis>("\"fortnightly\""))
    }

    @Test
    fun aCardDecodesItsAnniversary() {
        val card = Api.json.decodeFromString<CardResponse>(
            """{"id":"c","financial_account_id":"a","account_name":"Amex","currency":"SGD",
               "cycle_basis":"statement","statement_day":18,"anniversary_date":"2024-03-14",
               "categories":[],"limits":[]}""",
        )
        assertEquals("2024-03-14", card.anniversaryDate?.apiDateOnly())
    }

    @Test
    fun aCardUpdateSendsTheAnniversary() {
        val obj = Api.json.parseToJsonElement(
            Api.json.encodeToString(cardUpdate("statement", 18, "2024-03-14")),
        ).jsonObject
        assertEquals("2024-03-14", obj["anniversary_date"]?.jsonPrimitive?.content)
    }

    @Test
    fun aClearedAnniversaryIsAnExplicitNullNotAnOmittedKey() {
        // explicitNulls = false would drop a Kotlin null; only JsonNull reaches the wire.
        val obj = Api.json.parseToJsonElement(
            Api.json.encodeToString(cardUpdate("statement", 18, null)),
        ).jsonObject
        assertTrue(obj.containsKey("anniversary_date"))
        assertEquals(JsonNull, obj["anniversary_date"])
    }

    @Test
    fun anniversaryResetsAreOnlyOfferedOnceTheCardHasADate() {
        assertEquals(
            listOf(LimitResetBasis.CYCLE, LimitResetBasis.CALENDAR_MONTH, LimitResetBasis.QUARTER, LimitResetBasis.YEAR),
            resetOptions(hasAnniversary = false).filter { it.isAvailable }.map { it.basis },
        )
        val available = resetOptions(hasAnniversary = true).filter { it.isAvailable }.map { it.basis }
        assertTrue(LimitResetBasis.CARD_YEAR in available)
        assertTrue(LimitResetBasis.CARD_QUARTER in available)
    }
```

Also import `com.ivanlee.financetracker.data.net.apiDateOnly`.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd $W/android && ./gradlew :app:testDebugUnitTest --tests '*CardsTest*' 2>&1 | tail -30`
Expected: compile FAIL.

- [ ] **Step 3: Implement the models**

Replace `LimitResetBasis` in `Models.kt`:

```kotlin
/**
 * How often a card limit starts over. Decoded leniently: a value this build doesn't
 * know (a newer server) becomes [UNKNOWN] instead of failing the whole card list —
 * and deliberately not a known value, which would label a card year a statement cycle.
 */
@Serializable(with = LimitResetBasisSerializer::class)
enum class LimitResetBasis(val wire: String) {
    CYCLE("cycle"),
    CALENDAR_MONTH("calendar_month"),
    QUARTER("quarter"),
    YEAR("year"),
    CARD_YEAR("card_year"),
    CARD_QUARTER("card_quarter"),
    /** Never sent. */
    UNKNOWN("unknown");

    companion object {
        fun fromWire(raw: String): LimitResetBasis = entries.firstOrNull { it.wire == raw } ?: UNKNOWN
    }
}

object LimitResetBasisSerializer : KSerializer<LimitResetBasis> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("LimitResetBasis", PrimitiveKind.STRING)
    override fun deserialize(decoder: Decoder): LimitResetBasis = LimitResetBasis.fromWire(decoder.decodeString())
    override fun serialize(encoder: Encoder, value: LimitResetBasis) = encoder.encodeString(value.wire)
}
```

Add the imports `kotlinx.serialization.KSerializer`, `kotlinx.serialization.descriptors.PrimitiveKind`, `kotlinx.serialization.descriptors.PrimitiveSerialDescriptor`, `kotlinx.serialization.descriptors.SerialDescriptor`, `kotlinx.serialization.encoding.Decoder`, `kotlinx.serialization.encoding.Encoder` if they're not already present. (`JsonElement`, `JsonNull` and `JsonPrimitive` are already imported for `transactionUpdate`.)

Grep for `LimitResetBasis.` uses and `when` expressions that now need the new entries: `grep -rn "LimitResetBasis\." $W/android/app/src/main`.

In `CardResponse`, add after `statementDay`:

```kotlin
    /** Anchors card-year / card-quarter limits. A date-only field. */
    @Serializable(with = OptionalInstantSerializer::class)
    val anniversaryDate: Instant? = null,
```

In `CardCreate`, add `val anniversaryDate: String? = null,` (bare "yyyy-MM-dd"; omitted when null, which is correct on create).

Add after `CardCreate`:

```kotlin
/**
 * PUT /cards/{id} from the Edit card dialog, which states the whole card. Build it
 * with [cardUpdate]: [anniversaryDate] is a [JsonElement] because `explicitNulls = false`
 * drops a Kotlin null, and the backend reads an omitted key as "keep it" — only an
 * explicit null clears the date.
 */
@Serializable
data class CardUpdate(
    val cycleBasis: String,
    val statementDay: Int,
    val anniversaryDate: JsonElement,
)

fun cardUpdate(cycleBasis: String, statementDay: Int, anniversaryDate: String?): CardUpdate = CardUpdate(
    cycleBasis = cycleBasis,
    statementDay = statementDay,
    anniversaryDate = anniversaryDate?.let { JsonPrimitive(it) } ?: JsonNull,
)
```

- [ ] **Step 4: Implement the reset options**

In `logic/Cards.kt`:

```kotlin
/** One row of the limit "Resets" picker. */
data class ResetOption(val basis: LimitResetBasis, val label: String, val isAvailable: Boolean)

const val ANNIVERSARY_HINT =
    "Set the card's anniversary first — under Edit card — to reset on the card year or card quarter."

/** Anniversary resets are unavailable until the card has a date; the picker leaves them out. */
fun resetOptions(hasAnniversary: Boolean): List<ResetOption> = listOf(
    ResetOption(LimitResetBasis.CYCLE, "Each statement cycle", true),
    ResetOption(LimitResetBasis.CALENDAR_MONTH, "Each calendar month", true),
    ResetOption(LimitResetBasis.QUARTER, "Each quarter", true),
    ResetOption(LimitResetBasis.YEAR, "Each year", true),
    ResetOption(LimitResetBasis.CARD_YEAR, "Each card year", hasAnniversary),
    ResetOption(LimitResetBasis.CARD_QUARTER, "Each card quarter", hasAnniversary),
)
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `cd $W/android && ./gradlew :app:testDebugUnitTest 2>&1 | tail -30`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 6: Commit**

```bash
cd $W && git add android/app/src
git commit -m "feat(android): card anniversary models, lenient reset decoding (#275)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Android UI: reset picker, setup date, Edit card dialog

**Files:**
- Modify: `android/app/src/main/java/com/ivanlee/financetracker/ui/more/CardDialogs.kt`

**Interfaces:**
- Consumes: `resetOptions`, `ANNIVERSARY_HINT`, `cardUpdate`, `CardUpdate`, `CardCreate.anniversaryDate`, `Instant.apiDateOnly()`, `DateField`, `SwitchRow`.
- Produces: `@Composable fun CardEditDialog(card: CardResponse, onDismiss: () -> Unit, onSaved: (CardResponse) -> Unit)`.

- [ ] **Step 1: Setup dialog: anniversary**

In `CardSetUpDialog`, add state:

```kotlin
    var hasAnniversary by remember { mutableStateOf(false) }
    var anniversary by remember { mutableStateOf(Instant.now()) }
```

Before the `error?.let` block, add:

```kotlin
                SwitchRow(
                    title = "Card anniversary",
                    subtitle = "Optional. Card-year and card-quarter limits count from it.",
                    checked = hasAnniversary,
                    onCheckedChange = { hasAnniversary = it },
                )
                if (hasAnniversary) {
                    DateField("Opened on", anniversary) { anniversary = it }
                }
```

Pass `anniversaryDate = if (hasAnniversary) anniversary.apiDateOnly() else null,` in `CardCreate(...)`. Add the imports `java.time.Instant`, `com.ivanlee.financetracker.data.net.apiDateOnly`, `com.ivanlee.financetracker.ui.components.DateField` and `com.ivanlee.financetracker.ui.components.SwitchRow`.

- [ ] **Step 2: Add `CardEditDialog`**

Add below `CardSetUpDialog`:

```kotlin
/**
 * Editing a card after setup. Sends the whole card (see [CardUpdate]), so a cleared
 * anniversary goes out as JsonNull. The backend refuses to clear it while a limit
 * still counts from it, and that explanation is shown as-is.
 */
@Composable
fun CardEditDialog(
    card: CardResponse,
    onDismiss: () -> Unit,
    onSaved: (CardResponse) -> Unit,
) {
    var calendarBasis by remember(card.id) { mutableStateOf(card.cycleBasis == CycleBasis.CALENDAR) }
    var statementDay by remember(card.id) { mutableStateOf(card.statementDay.toString()) }
    var hasAnniversary by remember(card.id) { mutableStateOf(card.anniversaryDate != null) }
    var anniversary by remember(card.id) { mutableStateOf(card.anniversaryDate ?: Instant.now()) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Edit card") },
        text = {
            Column(
                modifier = Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                SegmentedChoice(
                    options = listOf("Statement cycle", "Calendar month"),
                    selected = if (calendarBasis) "Calendar month" else "Statement cycle",
                    optionLabel = { it },
                    onSelect = { calendarBasis = it == "Calendar month" },
                )
                if (!calendarBasis) {
                    FormField(
                        "Statement closes on day",
                        statementDay,
                        { statementDay = it.filter(Char::isDigit).take(2) },
                    )
                }
                SwitchRow(
                    title = "Card anniversary",
                    subtitle = "Card-year and card-quarter limits count from it.",
                    checked = hasAnniversary,
                    onCheckedChange = { hasAnniversary = it },
                )
                if (hasAnniversary) {
                    DateField("Opened on", anniversary) { anniversary = it }
                }
                error?.let {
                    Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                scope.launch {
                    try {
                        val updated = Api.put<CardUpdate, CardResponse>(
                            "/cards/${card.id}",
                            cardUpdate(
                                cycleBasis = if (calendarBasis) "calendar" else "statement",
                                statementDay = statementDay.toIntOrNull()?.coerceIn(1, 31) ?: card.statementDay,
                                anniversaryDate = if (hasAnniversary) anniversary.apiDateOnly() else null,
                            ),
                        )
                        onSaved(updated)
                    } catch (e: Exception) {
                        error = e.message ?: "Couldn't update the card."
                    }
                }
            }) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
```

Add the imports `CycleBasis`, `CardUpdate`, `cardUpdate`. Check that `CycleBasis` has a `CALENDAR` entry: `grep -n "enum class CycleBasis" -A3 Models.kt`.

- [ ] **Step 3: Manage dialog: full reset picker, Edit card entry**

In `CardManageDialog`, add state:

```kotlin
    var resetBasis by remember(card.id) { mutableStateOf(LimitResetBasis.CYCLE) }
    var anniversary by remember(card.id) { mutableStateOf(card.anniversaryDate) }
    var editing by remember { mutableStateOf(false) }
```

At the top of the `Column`, before `Text("Limits", …)`:

```kotlin
                TextButton(onClick = { editing = true }) { Text("Edit card — cycle and anniversary") }
```

After the direction `SegmentedChoice`, add the reset picker (radio-style rows, matching the category-limit picker below):

```kotlin
                Text("Resets", style = MaterialTheme.typography.labelMedium)
                resetOptions(hasAnniversary = anniversary != null).filter { it.isAvailable }.forEach { option ->
                    TextButton(onClick = { resetBasis = option.basis }) {
                        Text((if (resetBasis == option.basis) "● " else "○ ") + option.label)
                    }
                }
                if (anniversary == null) {
                    Text(
                        ANNIVERSARY_HINT,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
```

In the add-limit call, replace `resetBasis = "cycle",` with `resetBasis = resetBasis.wire,`, and after a successful add, reset it with `resetBasis = LimitResetBasis.CYCLE`.

After the `AlertDialog(...)` call, still inside `CardManageDialog`:

```kotlin
    if (editing) {
        CardEditDialog(
            card = card.copy(anniversaryDate = anniversary),
            onDismiss = { editing = false },
            onSaved = { updated ->
                anniversary = updated.anniversaryDate
                editing = false
                onChanged()
            },
        )
    }
```

Add the imports `com.ivanlee.financetracker.logic.resetOptions` and `com.ivanlee.financetracker.logic.ANNIVERSARY_HINT`.

- [ ] **Step 4: Build and run the tests**

Run: `cd $W/android && ./gradlew :app:assembleDebug :app:testDebugUnitTest 2>&1 | tail -20`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: Verify on the emulator**

`./gradlew :app:installDebug` on a running emulator against the local backend. Open More → Cards → Manage → Edit card, set an anniversary and save. Confirm the card-year and card-quarter rows appear under Resets, and add a monthly and a card-year limit (Android couldn't create either before). Take a screenshot.

- [ ] **Step 6: Commit**

```bash
cd $W && git add android/app/src
git commit -m "feat(android): reset picker, Edit card dialog with anniversary (#275)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Documentation

**Files:**
- Modify: `AGENTS.md` (per-card spend limits section)
- Modify: `ios/AGENTS.md`, `android/AGENTS.md` (only where they already describe card screens)

- [ ] **Step 1: Update `AGENTS.md`**

In the **Per-card spend limits** section, after the bullet that begins "**The cycle is the part most likely to go quietly wrong.**", add:

```markdown
    - **Card-year and card-quarter limits count from `Card.anniversary_date`**, the date the card was opened, because many issuers reset annual caps on the membership year rather than in January. It lives on the card (a fact about the card, like `statement_day`), is optional, and only its month and day drive the windows. `anniversary_bounds` computes every boundary as `anchor + n × 12|3 months` clamped to month end — **never stepped** from the previous one, or a 31 Jan anchor slides to the 30th after April for good — and a 29 Feb anchor lands on 28 Feb in non-leap years. A missing anchor is a **400, never a fallback to the calendar year**: creating or switching a limit to an anniversary basis without a date is refused, and so is clearing the date (`CardUpdate.anniversary_date`, three-state) while a limit still counts from it. `limit_bounds` raises rather than guess if that state is ever reached.
    - **The native `LimitResetBasis` enums decode leniently to `unknown`** — iOS via `init(from:)`, Android via `LimitResetBasisSerializer` — because a strict enum failed the whole card list the moment a newer server sent a new schedule. Unlike `LiquidityStatus` it does **not** fall back to a known case, which would label a card year a statement cycle. Every client has an **Edit card** form (web: the Manage dialog's Card section; iOS: `CardEditView`; Android: `CardEditDialog`) that sends the anniversary explicitly, `null` to clear.
```

- [ ] **Step 2: Check the platform AGENTS files**

Run: `grep -n -i "card" $W/ios/AGENTS.md $W/android/AGENTS.md | head`. Where either describes the Cards screens or the limit dialog, add one line naming the Edit card entry point. If neither mentions card screens, change nothing.

- [ ] **Step 3: Commit**

```bash
cd $W && git add AGENTS.md ios/AGENTS.md android/AGENTS.md
git commit -m "docs: card-anniversary limit windows (#275)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
