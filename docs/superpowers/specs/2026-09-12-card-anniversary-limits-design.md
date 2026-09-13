# Card-anniversary limit windows — design

Issue: [#275](https://github.com/ivanleekk/finance-tracker/issues/275) — "Some cards have an annual cap on rewards and we should track it".

## Problem

A card limit (`CardLimit`, `backend/src/card_models.py`) already resets on one of
`cycle`, `calendar_month`, `quarter` or `year`. Calendar `year` meters Jan 1 – Dec 31.
Many issuers instead reset annual (and sometimes quarterly) caps on the **card's
membership year** — counted from the date the card was opened — which nothing can
express today.

Two adjacent gaps surfaced while scoping this:

- **Android cannot pick a reset basis at all** — its add-limit dialog hardcodes
  `resetBasis = "cycle"` (`android/.../ui/more/CardDialogs.kt`).
- **No client can edit a card after setup.** Web's loader has an `updateCard`
  action but nothing in the UI submits it; iOS and Android have neither. Existing
  cards are exactly the ones that need an anniversary added.

Both are fixed here, because the feature is unusable on native without them.

**Out of scope:** more than one limit per category (e.g. a monthly minimum *and*
an annual cap on Dining). `CardCategory.limit_id` is a single FK; changing it is a
many-to-many migration touching every client's ~40 `limit_id` references, and it
gets its own spec next. Anniversary windows do not depend on it.

## Approach

Two new values on `LimitResetBasis` — `card_year` and `card_quarter` — anchored on a
new, optional `Card.anniversary_date`.

Rejected: an `anchor` flag on the limit (`calendar | anniversary`) that changes what
`quarter`/`year` mean. It avoids new enum values but doubles the combinations to
reason about (what is an anniversary `cycle`?) and needs a second picker on every
client.

Rejected: the anchor on each limit rather than the card. The membership year is a
fact about the card, like `statement_day`; every annual limit on a card shares it.

## Data model

- `Card.anniversary_date`: `Date`, nullable. A full date (the card-open date — what
  the welcome letter and annual-fee statement print), entered with the standard date
  picker on every client. Only its month and day drive the windows.
- `LimitResetBasis` gains `card_year = "card_year"` and `card_quarter = "card_quarter"`.
  The column is `native_enum=False` (a VARCHAR), so the only schema change is the new
  `cards` column. Migration via `uv run alembic revision --autogenerate`; confirm the
  VARCHAR length of `card_limits.reset_basis` accommodates the new values
  (`card_quarter` is 12 chars, shorter than `calendar_month`), then `alembic check`.
- Schemas: `CardBase` / `CardResponse` gain `anniversary_date: Optional[date]`.
  `CardUpdate.anniversary_date` is **three-state**: omitted preserves, `null` clears
  (read via `exclude_unset`, as `limit_id` on `CardCategoryUpdate` already is).
  `LimitResetField` accepts the two new values.

## Window maths

In `limit_bounds` (`backend/src/services/card_service.py`):

- **`card_year`**: from the most recent anniversary on or before `on`, to the day
  before the next one. Anchor 14 Mar → 11 Sep 2026 falls in 14 Mar 2026 – 13 Mar 2027.
- **`card_quarter`**: the same in three-month steps from the anchor (14 Mar, 14 Jun,
  14 Sep, 14 Dec).
- **Every boundary is computed as `anchor + n×(12 | 3) months`, clamped to month
  end** — never by stepping from the previous boundary. This is the rule
  `recurring_service.occurrence` and `statement_bounds` already follow: stepping
  clamps 31 Jan → 30 Apr and never climbs back. So a 31 Jan anchor gives quarters
  starting 31 Jan, 30 Apr, 31 Jul, 31 Oct, every year; a 29 Feb anchor lands on
  28 Feb in non-leap years and returns to 29 Feb in leap years.
- A window's end is the day before the next boundary, so every day belongs to
  exactly one window.
- Dates before `anniversary_date` still resolve to the computed window; the year
  of the anchor is not a lower bound on the maths (spend is already bounded by the
  transactions that exist).
- Reuse the existing `_clamped_day` helper; guard year arithmetic at `MINYEAR` /
  `MAXYEAR` the way `_neighbouring_close` does.

## Missing anchor

- Creating or updating a limit to `card_year` / `card_quarter` on a card with no
  `anniversary_date` → **400**, explaining the card needs an anniversary first.
- Clearing `anniversary_date` (or sending `null`) while any of the card's limits use
  an anniversary basis → **400**, naming the limits.
- No silent fallback to the calendar year: that would meter over a window the issuer
  never applies, the same class of bug the codebase already treats as a defect.
- Defence in depth: if a status is computed for an anniversary limit whose card has
  no date (should be unreachable), `limit_bounds` raises rather than guessing.

## Clients

No client computes limit windows — the server returns `period_start` / `period_end`
and each client's `cycleLabel` formats them — so there is **no new parity module**.
The work is models and forms.

### All three

- Card model gains `anniversaryDate` (optional). `LimitResetBasis` gains
  `card_year` / `card_quarter`.
- Reset picker gains "Each card year" and "Each card quarter". Both are **disabled
  with a hint** ("Set the card's anniversary first") when the card has no date, so
  the 400 is a backstop.
- Anniversary date field in card setup and card edit — optional, clearable.
- No client renders a limit's own `period_start`/`period_end` today — the only
  window shown anywhere is the card's statement cycle in the section header, so a
  card-year cap renders under that header same as any other limit. Giving each
  limit its own window is real, deliberate follow-up work, not part of this
  branch.

### Lenient enum decoding (native)

Both native `LimitResetBasis` enums decode strictly today — iOS via synthesized
`Codable`, Android via kotlinx without `coerceInputValues` — so an unknown value fails
the whole card response and blanks the Cards screen. Add an `unknown` case with a
lenient decode on both (iOS `init(from:)` falling back to `.unknown`; Android a custom
serializer), rendered as "Custom schedule". Falling back to a *known* value (as the
iOS `LiquidityStatus` enum does to `.liquid`) is wrong here: it would label a card
year as a statement cycle. Builds already in the field remain strict; the backend
change and the native update should ship together, and the risk is limited to a user
creating an anniversary limit before updating.

### Web

`frontend/src/pages/Cards/CardDialogs.tsx`, `cards.loader.ts`, `types/types.ts`: two
new reset options, a date input on setup, and a **new card-settings section** in the
Manage dialog (cycle basis, statement day, anniversary) that finally submits the
existing `updateCard` action; an empty date submits as `null` to clear.

On iOS and Android, where a menu row cannot reliably be disabled, the anniversary
options are left out of the picker (with the same hint) rather than greyed out.

### iOS

`ios/FinanceTracker/Views/More/CardSetUpViews.swift`, `Models/Models.swift`:

- Date in card setup (an optional date — a toggle revealing a `DatePicker`).
- **New Edit card sheet**: cycle basis, statement day, anniversary. All fields listed
  in `.discardGuard(fields:)`.
- The card update body encodes `anniversary_date` in a hand-written `encode(to:)` —
  `encode` for explicit null to clear, key omitted to preserve — the same pattern as
  `SplitChange` / `card_category_id`.

### Android

`android/.../ui/more/CardDialogs.kt`, `data/model/Models.kt`:

- **Full reset-basis picker** on add-limit (replacing the hardcoded `"cycle"`).
- Date in card setup and a **new Edit card dialog** (cycle basis, statement day,
  anniversary).
- Update body carries `anniversaryDate` as a `JsonElement` (`JsonNull` to clear,
  absent to preserve), as `transactionUpdate(...)` does for `SplitChange`.

## Testing

**Backend** (`backend/tests/test_card_limits.py`):

- Every day of a year lands in exactly one window, for `card_year` and
  `card_quarter`, with anchors 14 Mar, 31 Jan and 29 Feb, over a leap year and the
  following non-leap year.
- No drift: a 31 Jan anchor's quarter still starts 31 Jan in year 3.
- 400 creating an anniversary limit on a card with no date; 400 updating a limit to
  an anniversary basis with no date; 400 clearing the date while a limit uses it.
- `CardUpdate.anniversary_date` three-state: omitted preserves, `null` clears.
- End-to-end status: a charge last April counts towards a 14 Mar card-year cap and
  not towards a calendar-year cap.
- `alembic check` reports no drift.

**Web** (Vitest): anniversary options disabled without a date and enabled with one;
the loader sends the date and sends `null` for a cleared field.

**iOS / Android**: card update encodes the expected key set in all three states
(omitted / value / explicit null); `LimitResetBasis` decodes `card_year`,
`card_quarter` and an unknown string (→ `unknown`) without throwing.

## Docs

Update the per-card spend limits section of `AGENTS.md`: the anniversary anchor, the
"computed, never stepped" boundary rule for it, the 400-not-fallback rule, lenient
native decoding with an `unknown` case, and the native Edit card screens. Note in
`ios/AGENTS.md` / `android/AGENTS.md` if they list card screens.
