# Android App — Agent Instructions

Native Jetpack Compose Android app for the Finance Tracker backend. Same FastAPI backend as
web/iOS; independent codebase (no shared package). Feature parity with `ios/` is the target —
when the two disagree, that's a bug in one of them, so read `ios/AGENTS.md` alongside this.

## Stack & Layout

- **Kotlin 2.0 / Jetpack Compose**, Material 3. `minSdk 26`, `compileSdk`/`targetSdk 34`,
  Java 17 bytecode. Gradle 8.13 + AGP 8.7.3 via the wrapper.
- **No third-party runtime dependencies beyond AndroidX + OkHttp + kotlinx.serialization** —
  the same rule iOS follows. Charts are drawn on a Compose `Canvas` (`ui/components/Charts.kt`)
  rather than pulled from a charting library: there are three fixed chart types over small,
  already-aggregated series, so a dependency would cost more in size and API churn than it saves.
- **Adaptive by window size class, never by device.** `MainScaffold` uses
  `NavigationSuiteScaffold`, which swaps a navigation **bar** (compact, <600dp — phones) for a
  navigation **rail** (medium/expanded — tablets, unfolded foldables, desktop windows) off the
  current window size class. Same five destinations either way, so nothing is hidden on a
  larger screen. Stat grids use `AdaptiveStatGrid` (2 columns on a phone, up to 4 on a tablet).
- **Edge-to-edge** via `enableEdgeToEdge()` in `MainActivity.onCreate` *before* `super`, with
  transparent system bars in `themes.xml`; the scaffolds apply the insets.
- `MainActivity` is a **`FragmentActivity`**, not a plain `ComponentActivity`: androidx.biometric's
  `BiometricPrompt` needs a FragmentActivity host and the private-vault lock is not optional.

```
android/app/src/main/java/com/ivanlee/financetracker/
  MainActivity.kt            # FragmentActivity + WaypointRoot (auth phase switch)
  WaypointApp.kt             # Application; wires Api.init once
  data/model/Models.kt       # Serializable mirrors of backend/src/schemas.py
  data/model/Enums.kt        # wire-value enums, lenient where the backend may add values
  data/net/ApiClient.kt      # `Api` object: Bearer auth, 401 → /auth/refresh retry
  data/net/Serializers.kt    # money-as-string, date parsing, Instant.apiDateOnly()
  data/net/TokenStore.kt     # EncryptedSharedPreferences (Android counterpart of the Keychain)
  security/BiometricAuth.kt  # fingerprint / face / device-PIN gate
  state/SessionViewModel.kt  # auth, user, households, active household (mirrors SessionStore)
  state/ViewModeViewModel.kt # Private/Household/Blended + vault lock (mirrors ViewModeStore)
  state/QuickAddViewModel.kt # command-sheet presentation + reloadToken
  logic/                     # PURE, JVM-testable: PortfolioAnalytics, GoalProjection, NetWorth,
                             #   BudgetPresentation, Formatters, ViewModeVisibility, CategoryPeriod
                             #   (the Top-Categories date window; its SharedPreferences half lives
                             #   in state/TopCategoryFilterStore.kt)
  ui/Navigation.kt           # Routes + the five TopLevelDestinations
  ui/MainScaffold.kt         # NavigationSuiteScaffold + Quick Add sheet + vault lifecycle
  ui/WaypointNavHost.kt      # every destination, one flat graph
  ui/theme/                  # Palette/AppTheme + GENERATED ThemePalettes.kt
  ui/components/             # SectionCard, AdaptiveStatGrid, Charts, Forms, SwipeRow,
                             #   QuickAddPull, ScreenScaffold, Toolbar, Haptics
  ui/auth/                   # LoginScreen, OnboardingScreen
  ui/dashboard/              # DashboardScreen (+ AccountRow/TransactionRow/HoldingRow, reused)
  ui/accounts/               # list, detail, form, add-balance, loan schedule
  ui/portfolio/              # PortfolioScreen, SubPortfolioDetail, Trades, TradeForm,
                             #   Dividends, SubPortfolioCash, AssetCreateDialog
  ui/goals/                  # GoalDetail, GoalForm — a goal is a sub-portfolio with a target
  ui/transactions/           # list, form, categories
  ui/more/                   # MoreScreen, SettingsScreens, Budgets, Recurring, Reports, Members
  ui/quickadd/QuickAddSheet.kt
```

Goals are **not** a tab, exactly as on iOS: a "goal" is a sub-portfolio with a target, shown
per sub-portfolio inside the Portfolio tab and drilled into via `GoalDetailScreen`.

## Conventions

- **JSON uses `JsonNamingStrategy.SnakeCase`**, so Kotlin properties are the camelCase versions
  of the Pydantic field names (the same rule as iOS's `.convertFromSnakeCase`). Keep
  `data/model/Models.kt` in sync with `backend/src/schemas.py`.
- **Money fields must be annotated `@Serializable(with = MoneySerializer::class)`** (or
  `OptionalMoneySerializer`). Pydantic serializes `Decimal` as a JSON **string** ("5000.00")
  while `float` fields are numbers; a plain `Double` fails to decode any Decimal field.
- **`explicitNulls = false`** is what makes every partial-update model work: a null property is
  omitted from the body, so the server leaves that field unchanged. Two consequences:
  - Response models need defaults on optional fields.
  - `SubPortfolioUpdate.ownerUserId` is a **`JsonElement?`**, not a `String?`. The backend PATCH
    uses `exclude_unset`, so *omitting* the key leaves ownership alone while an *explicit null*
    clears it — and with `explicitNulls = false` a plain `String?` can only ever express the
    first, which would make "Private → Shared" silently do nothing. Use
    `SubPortfolioUpdate.ownerUnchanged` / `ownerSetTo(...)`.
- **Dates are UTC everywhere.** Naive backend datetimes are read as UTC (`DateParser`), every
  formatter in `logic/Formatters.kt` renders in UTC, and date-only bodies go through
  `Instant.apiDateOnly()`. Rendering a backend date in local time would print the 18th for
  "2026-07-19" anywhere west of Greenwich — a transaction silently moving a day.
- **Query strings must go through `Api.url(path)`.** OkHttp's `addPathSegments` percent-encodes
  its argument, so a path like `"/x/projection?months=360"` would turn the `?` into `%3F`, the
  query would become part of the path, and the request would 404 — silently, if the call site
  swallowed the error. `ApiUrlTest` pins the splitting behaviour.
- **The backend has no single-resource GET for accounts, trades, or transactions** — they are
  only listed per household (`/accounts/household/{id}`, `/portfolio/trades/household/{id}`,
  `/cashflow/transactions/household/{id}`). Detail and edit screens fetch the list and pick
  their row out of it. Don't "fix" this by inventing `/accounts/{id}`; it doesn't exist.
  Sub-portfolios *do* have `GET /portfolio/subportfolios/{id}`.
- **Cancelling an invite is `DELETE /users/invites/{id}`**, not nested under the household.
- **API base URL** is `BuildConfig.API_BASE_URL`, set per build type in `app/build.gradle.kts`:
  debug is `http://10.0.2.2:8000` (the emulator's alias for the host's loopback, so a
  `docker compose up` backend is reachable with no configuration), release is the production
  endpoint. **Debug builds only** additionally honour a runtime override (`api_base_url` in
  SharedPreferences, editable from More ▸ API server and the login screen) for physical-device
  LAN testing; the whole override — UI and read path — is behind `BuildConfig.DEBUG` so it
  compiles out of release. Cleartext HTTP is opened for loopback/LAN only, in
  `res/xml/network_security_config.xml`.
- **View mode (Private/Household/Blended)** mirrors the web `ViewModeContext`.
  `ViewModeViewModel` holds the persisted mode plus a `hasSecondPerson` flag; the
  `ViewModeSwitcher` toolbar control renders only once the active household has a second person
  (a member beyond the owner, or a pending invite), because a three-way privacy control on a
  solo household is a confusing no-op. The rules themselves live in
  `logic/ViewModeVisibility.kt` as pure functions so they're testable without an emulator —
  this is the logic that decides whether someone's private balances appear on screen.
- **Private-vault lock.** `require_face_id_for_vault` (an iOS-flavoured backend column name;
  the Kotlin property is `requireBiometricForVault`, pinned with `@SerialName`) gates private
  items behind fingerprint / face / device PIN. `BIOMETRIC_WEAK or DEVICE_CREDENTIAL` is
  deliberate — the point is "prove you're the phone's owner", and a PIN does that; requiring
  STRONG would lock out anyone with no enrolled sensor. It **fails open**: a device that can't
  authenticate never counts as locked. `MainScaffold` re-locks on `ON_STOP` and re-prompts on
  `ON_RESUME` — never on `ON_PAUSE`, because the biometric prompt itself pauses the activity
  and locking there would fight the unlock it just triggered.
- **Theming** mirrors the web ThemeContext and iOS AppTheme: the user's
  `primary_color`/`secondary_color`/`base_color` resolve to Tailwind scales in
  `ui/theme/ThemePalettes.kt`, which is **generated** — regenerate with
  `python3 android/scripts/gen_palettes.py`, don't hand-edit. This is deliberately **not**
  Material You dynamic colour: the palette is a cross-client user preference synced from the
  backend, so honouring the wallpaper would make the same account look different here than on
  web/iOS. Surfaces stay M3 baseline neutrals (same rule as iOS, where the base palette is
  stored for parity but not painted onto backgrounds).
- **`ListItem` inside a `SectionCard` needs `colors = cardListItemColors()`** — by default it
  paints its own `surface` container, which reads as a lighter slab floating on the card.
- **Growth charts** (`logic/PortfolioAnalytics.kt`) share `equityCurve` between the Portfolio
  tab and the sub-portfolio detail screen. Same three deliberate divergences from web as iOS:
  only the range is exposed (the bin is derived from the data's span — two adjacent selectors
  don't fit a phone), binning keeps the **last** value in each bucket rather than a sum or mean
  (an equity curve is a running balance), and `allocationSlices` weights by
  `current_value_home_currency` rather than native value. `periodChange` returns a **null**
  fraction when the opening balance is under 1% of the closing one — a goal funded from $42 to
  $13,104 is not a +31,100% return.
    - That guard only catches the extreme case: `periodChange`'s fraction is a raw curve-endpoint
      ratio with no cash-flow adjustment at all, so a recurring contribution still counts as
      "growth" the same as a market gain (issue #256). Both `PortfolioScreen` and
      `SubPortfolioDetailScreen` swap it out for every range: `metrics.overallMetrics.simpleReturn`
      / `scopedMetrics.simpleReturn` for `ALL` (reusing the fetch the Performance grid already
      made), and for 1M/6M/1Y a `LaunchedEffect(range, …)` fetches `/metrics` scoped to that same
      window via `GrowthRange.cutoffDate(now)` as `start_date`, cached as `rangeMetrics` /
      `rangeMetricsRange` — the fetch is keyed by `range` so a slow response landing after a
      further flip is never shown as if it were current, and the fraction falls back to the
      naive curve ratio while a fetch is in flight or has failed. The dollar delta stays
      curve-based regardless of range, since "value went up by $X" is true no matter the source.
- **`logic/NetWorth.kt`** is the Kotlin port of `frontend/src/lib/networth.ts` (and iOS's
  `Support/NetWorth.swift`) — `summarizeAccounts` / `netWorthBreakdown` behind the Dashboard's
  net worth total and its Net Worth Split donut (`ui/components/Charts.kt`'s
  `NetWorthSplitChart`, on its own `NetWorthSplitColors` palette so a household's accent color
  never changes which hue a bucket wears). `netWorthBreakdown.sliceTotal` is the sum of the
  *visible* slices only — a negative bucket (e.g. an overdrawn household's cash) is dropped
  from the donut since a wedge can't be negative, so `sliceTotal` is deliberately not the same
  as gross assets in that case. `DashboardScreen` passes its own independently-computed
  `netWorth` into `NetWorthSplitChart` rather than letting the chart derive
  `sliceTotal - liabilities`, which would silently lose that dropped bucket from the total.
- **`logic/HistoryGroups.kt`** is the Kotlin port of `frontend/src/lib/historyGroups.ts` and
  iOS's `Support/HistoryGroups.swift` — the Activity list's day/month/year bucketing and the
  income/spend totals on each section header. Two judgement calls it encodes: transfers count
  on neither side (money between your own accounts is not income and not spending, the same
  rule the budget rollups use), and a row with no known base-currency value is left out of the
  total and surfaced as "partial" rather than summed at face value, which would mix currencies
  into a meaningless number. Bucketing is UTC, like every other date in this client.
- **`logic/BudgetPresentation.kt`** is the Kotlin port of `frontend/src/lib/budgets.ts` and
  iOS's `BudgetPresentation.swift`. Keep all three in sync; both judgement calls matter: a
  budget is "at risk" the moment its *projected* spend exceeds the limit (warning on the 10th
  is the point; warning on the 30th is useless), and a null `monthsCovered` renders as "Not
  enough data", never "∞" — an undefined runway is not an infinite one.

## Gestures

- **Pull down any main list to open Quick Add** (`ui/components/QuickAddPull.kt`) — the same
  signature gesture as iOS, and a deliberate divergence from the Android pattern library, which
  puts pull-to-refresh in this slot. Every screen reloads on resume and after any Quick Add
  write, so a manual refresh would be near-dead weight; a one-gesture path to "log something"
  is worth far more.
  Two signals drive it and neither is sufficient alone: `NestedScrollConnection.onPostScroll`
  gives the unconsumed downward drag once the list is already at the top (the overscroll
  distance) but knows nothing about the finger, and `onPreFling` fires exactly when the finger
  lifts and carries the lift-off velocity. The sheet opens only when the pull passes the
  trigger **and** the finger lifts below `FLICK_VELOCITY` — without the velocity gate a fast
  flick back to the top of a long list opens it too, which is what "too sensitive" means in
  practice.
- **Swipe rows** (`ui/components/SwipeRow.kt`) use `SwipeToDismissBox` but never complete the
  dismissal: `confirmValueChange` fires the action and returns false, so the row springs back.
  That's right here because every destructive action goes through a confirmation dialog — a row
  that had already animated away while the dialog was still open would be lying.
  `ConfirmDialog` (`ui/components/Forms.kt`) itself dismisses the instant its confirm button is
  tapped, before the async call it triggers even starts — so a screen that wants "in flight"
  feedback while that call runs (`RecurringScreen`'s delete, for instance) tracks it itself
  (a `deletingId` disabling that row's swipe actions and clicks, with a `CircularProgressIndicator`
  swapped in for its trailing content) rather than relying on the dialog for it.
- **Haptics** go through `ui/components/Haptics.kt` rather than Compose's `LocalHapticFeedback`,
  which only exposes LongPress and TextHandleMove — not enough vocabulary for a gesture that
  needs a distinct "armed" tick and "committed" thump. The richer constants landed in API 30,
  so pre-30 falls back to the closest long-standing constant instead of going silent.

## Build & Run

```sh
cd android
./gradlew :app:assembleDebug          # build
./gradlew :app:installDebug           # build + install on the running device/emulator
./gradlew :app:testDebugUnitTest      # unit tests
```

`local.properties` (gitignored) needs `sdk.dir=$HOME/Library/Android/sdk`. Backend must be
running (`docker compose up` at the repo root) — debug builds point at `10.0.2.2:8000`, which
is the host's loopback as seen from the emulator.

Emulator loop:

```sh
$ANDROID_HOME/emulator/emulator -avd Pixel_8_API_34 &
adb wait-for-device
./gradlew :app:installDebug
adb shell am start -n com.ivanlee.financetracker/.MainActivity
adb exec-out screencap -p > /tmp/shot.png
```

Android Studio works too — open the `android/` directory, not the repo root.

## Testing

Unit tests live in `app/src/test/` and are plain JUnit 4 — no Robolectric, no instrumentation.
Coverage focuses on **pure, deterministic logic**, which is where subtle regressions hide and
where tests pay off without a backend or an emulator:

- `PortfolioAnalyticsTest` — equity-curve aggregation, sub-portfolio scoping, range windows,
  the daily/weekly/monthly bin thresholds and last-in-bucket rule, `periodChange`'s small-base
  guard, allocation and FX exposure. Dates are built explicitly in UTC so results never depend
  on the machine's timezone.
- `GoalProjectionTest` — the goal projection math; the biggest suite, because it has several
  branches that differ only by whether a target date exists. Every call passes an explicit
  `now`, so nothing drifts with the wall clock.
- `ModelDecodingTest` — representative backend JSON through the real `Api.json`; catches
  `Models.kt` ⇄ `schemas.py` drift. Also covers money-as-string, lenient enums, and
  `SubPortfolioUpdate`'s omit-vs-explicit-null owner encoding.
- `BudgetPresentationTest` — budget tone, runway tone/label, normalized monthly commitments,
  UTC month bucketing.
- `ViewModeVisibilityTest` — the Private/Household/Blended rules and the vault's fail-open.
- `HistoryGroupsTest` — Activity-list bucketing and section totals (`logic/HistoryGroups.kt`).
- `ApiUrlTest` — query-string splitting.
- `FormattersTest` — dates asserted exactly (they're UTC by design); currency gets structural
  checks only, since its digit grouping comes from the JVM's locale data rather than from us.

New tests should stay backend-free: exercise the pure functions and the Codable models, don't
spin up `Api` network calls.

## Parity Notes

Things this app does that iOS does **not**, and why:

- The **Activity** tab shows income/expense/transfer filter chips (iOS has a search field
  instead). The day/month/year grouping and the per-section totals above it are shared with
  iOS and web — see `logic/HistoryGroups.kt`.
- **Reports** exports through a `FileProvider` + system share sheet (Android won't let another
  app read a raw `file://` path).
- The Portfolio tab's growth/allocation split is one scrolling screen; iOS's sub-portfolio
  detail tab strip is reproduced with `PrimaryTabRow` inside `SubPortfolioDetailScreen`.

Things iOS has that this app deliberately doesn't: the ⌘K keyboard shortcut (an iPad
accommodation for the absence of haptics there — Android phones and tablets both have them).
