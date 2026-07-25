# iOS App — Agent Instructions

Native SwiftUI iOS app for the Finance Tracker backend. Same FastAPI backend as web/mobile; independent codebase (no shared package).

## Stack & Layout

- **Swift / SwiftUI**, iOS 18 minimum (uses `@Observable`, Swift Charts, `NavigationStack`, `ContentUnavailableView`, plus two iOS 18 APIs the app depends on: `.tabViewStyle(.sidebarAdaptable)` and `onScrollGeometryChange`).
- **Universal (iPhone + iPad)** — `TARGETED_DEVICE_FAMILY: "1,2"`. Layout adapts by **size class, never by device**: `MainTabView` uses `.tabViewStyle(.sidebarAdaptable)`, so regular width (iPad full screen) gets a sidebar and compact (iPhone, iPad in narrow Split View) keeps the tab bar — same 5 tabs either way. Stat grids use `GridItem(.adaptive(minimum:))` and charts use `.adaptiveChartHeight(compact:regular:)` (`Views/Components/AdaptiveLayout.swift`) so they reflow instead of stretching. iPhone is portrait-only but iPad declares all four orientations (`UISupportedInterfaceOrientations~ipad`) — iPadOS withholds Split View / Stage Manager from apps that don't rotate. Two iPad-only traps to remember: **haptics are a no-op**, which is why Quick Add also has a ⌘K shortcut, and a `UIActivityViewController` with no popover anchor is a hard crash (see `ShareSheet` in ReportsView).
- **XcodeGen** builds the project file: edit `project.yml`, never the `.xcodeproj` (it is generated; regenerate with `xcodegen generate` after adding/removing files).
- No third-party dependencies — networking is async/await `URLSession`, charts are Apple's Charts framework, tokens live in the Keychain.

```
FinanceTracker/
  FinanceTrackerApp.swift    # @main + RootView (auth phase switch)
  Models/Models.swift        # Codable mirrors of backend/src/schemas.py
  Networking/APIClient.swift # actor; Bearer auth, 401 → /auth/refresh retry (mirrors mobile/src/lib/api.ts)
  Networking/Keychain.swift  # token storage
  State/SessionStore.swift   # @Observable: user, households, activeHousehold (mirrors mobile AuthContext + HouseholdContext)
  Support/Formatters.swift   # currency/percent/date formatting helpers
  Support/GoalProjection.swift # Swift port of web lib/goals.ts (projectGoal / valueHistory) — keep in sync
  Support/AppTheme.swift     # Palette + AppTheme resolved from user's saved color names
  Support/ThemePalettes.swift# GENERATED sRGB scales from the web's Tailwind palette — regenerate, don't hand-edit
  Views/                     # Tab bar (5): Dashboard, Accounts, Portfolio, Transactions, More (+ Auth)
                             #   Accounts/  = the Accounts tab (AccountsListView, wrapped in a NavigationStack by
                             #     MainTabView; also pushed from Dashboard rows) + account create/edit
                             #     (AccountFormView), manual balance entry (AddBalanceView, POST /accounts/balances),
                             #     account detail chart/history. Dashboard's "See All" switches to this tab.
                             #   Goals are NOT a tab — a "goal" is a sub-portfolio with a target, shown per
                             #     sub-portfolio inside the Portfolio tab (GoalProgressRow). Tapping a goal opens
                             #     Goals/GoalDetailView.swift — the fleshed-out page (% ring, projected-completion
                             #     chart w/ target line, Funded-from + per-member contributions, recent
                             #     contributions, edit/delete/add-funds via the ⋯ menu); native counterpart of the
                             #     web /goals/:id screen. Projection math is Support/GoalProjection.swift.
                             #     Goals/GoalsView.swift holds GoalProgressRow + GoalFormView (old tab removed).
                             #     GoalFormView is dual-mode: `GoalFormView(householdId:)` creates a sub-portfolio
                             #     (Portfolio ▸ + ▸ New Goal / Sub-Portfolio → POST /portfolio/subportfolios) and
                             #     `GoalFormView(existing:)` edits one (⋯ ▸ Edit Goal → PATCH .../{id}). Name, risk
                             #     profile, target amount/date, and a Private toggle.
                             #   QuickAdd/  = the command bar (QuickAddView), an options-first quick-add opened by
                             #     pulling down ANY main List (`.quickAddPull` in Components/QuickAddPull.swift reads
                             #     overscroll via onScrollGeometryChange and shows a custom "pull/release" indicator
                             #     — NOT pull-to-refresh — then opens the sheet; QuickAddStore is the shared state).
                             #     Pick a mode (expense/income/transfer/trade/dividend/balance), fill fields, Log; on
                             #     submit it bumps QuickAddStore.reloadToken so open screens reload. Presented from
                             #     MainTabView; store lives in the environment (app root).
                             #   Components/ = shared UI: LoadingSkeleton (shimmering placeholder shown as an
                             #     `.overlay` while a screen's data loads, instead of a blank page), QuickAddPull,
                             #     ViewModeSwitcher (the Private/Household/Blended nav-bar menu; hidden until the
                             #     household has a second person — see ViewModeStore + the API/view-mode notes below),
                             #     and VaultLockButton (the Face ID vault lock/unlock nav-bar control; see the vault
                             #     note in Conventions). Both live in the four main screens' `.topBarLeading` toolbars.
                             #   Auth/      = LoginView (Log In / Sign Up) and OnboardingView, the guided first-run
                             #     flow shown by RootView when `session.needsOnboarding` (a fresh signup has no
                             #     household — backend POST /users doesn't make one). Two steps: create the first
                             #     household + optional starter accounts + private-by-default choice, then optionally
                             #     rename + invite. Native counterpart of the web /onboarding flow.
                             #   Portfolio/ also has an AllocationCard (donut by asset type + legend + FX-exposure
                             #     chips, colours matched to the web ALLOCATION_COLORS), plus TradesListView
                             #     tap to edit (TradeFormView in edit mode → PUT /portfolio/trades/{id}), swipe to
                             #     delete; the CASH pseudo-asset legs are filtered out. Trade editing needs the backend
                             #     TradeUpdate UUID fix (schemas.py) — the ID fields were Optional[int].
                             #   More/     = MoreView (the tab) + SettingsViews.swift, the native counterpart of the
                             #     web /settings sections: ProfileSettingsView (name + timezone),
                             #     SecuritySettingsView (change email / password), PrivacySettingsView (the private
                             #     vault toggles `hide_private_from_household` / `default_new_items_private`, plus
                             #     `require_face_id_for_vault` — the Face ID lock — all saved on change),
                             #     HouseholdSettingsView (rename + base currency → PUT
                             #     /users/households/{id}). Currency/timezone use `ReferencePicker`, a searchable
                             #     list over GET /reference/currencies|timezones. Appearance + Reports + Categories
                             #     stay inline in MoreView.
                             #   Create a household from More → Create Household (SessionStore.createHousehold →
                             #     POST /users/households, then switches active); More shows a household picker once
                             #     there's more than one.
                             #   Transactions/ = list + add/edit (TransactionFormView, tap a row to edit;
                             #     transfers are not editable here) + CategoriesView (category CRUD,
                             #     also reached from More → Categories and inline from the New Transaction sheet).
                             #   Reports/   = ReportsView (More → Reports): GET /exports/household/{id}/report
                             #     rendered as net worth / portfolio / cash flow / dividends / goals, plus CSV
                             #     export (GET .../csv → ZIP shared via ShareSheet + APIClient.getData).
                             #   Household/ = HouseholdMembersView (More → Members & Invites): list members
                             #     (GET /users/householdmember/{hid}), send/cancel email invites
                             #     (POST/DELETE /users/households/{hid}/invites), remove members.
```

## Conventions

- JSON decoding uses `.convertFromSnakeCase` — model properties are camelCase versions of the Pydantic field names. Keep `Models.swift` in sync with `backend/src/schemas.py` when schemas change.
- **Money fields must use `@MoneyAmount` / `@OptionalMoneyAmount`** (property wrappers in Models.swift): Pydantic serializes `Decimal` fields as JSON *strings* ("5000.00") while float fields are numbers. A plain `Double` property will fail to decode any backend Decimal field.
- Backend dates are naive ISO strings; `DateParser` in APIClient.swift handles date-only, datetime, and fractional-second variants.
- All aggregate money displays use the household `baseCurrency` and the `*_home_currency` fields; per-account/per-asset detail uses native currency (same rule as web/mobile).
- Private ownership (`owner_user_id != nil`) is rendered with a lock icon; the server already filters out other members' private data. Create forms (AccountFormView, GoalFormView) seed their Private toggle from the user's `default_new_items_private` in `.onAppear` (SessionStore isn't reachable from `init`), matching web.
    - `SubPortfolioUpdate.ownerUserId` is a `.unchanged` / `.set(String?)` enum with a hand-written `encode(to:)`, not a plain `String?`. The backend PATCH uses `exclude_unset`, so omitting the key leaves ownership alone while an explicit `null` clears it — a plain Optional can only express the first, which would make "Private → Shared" silently do nothing (the web UI has that limitation).
- **The QuickAdd pull gesture** (`Components/QuickAddPull.swift`) needs two signals: `onScrollGeometryChange` for the overscroll distance, and a `.simultaneousGesture(DragGesture)` for finger down/up. `onScrollPhaseChange` is the API that *looks* right, but on a `List` it only ever delivers `.idle` — no `.interacting`/`.decelerating` — so it cannot detect release. The bar opens only when the pull passes `trigger` (100pt of overscroll ≈ a 220pt pull) **and** the finger lifts below `flickVelocity` (1200 pt/s); momentum-only overscroll never arms it. Both halves matter — without the velocity check a fast flick from the top still opens it, which is what "too sensitive" meant.
- **API base URL** resolves in `APIClient.baseURL` via `AppConfig.defaultBaseURL`, which reads the `API_BASE_URL` Info.plist key (fed by the per-configuration `API_BASE_URL` build setting in `project.yml`, `$(API_BASE_URL)`; falls back to `http://localhost:8000`). **Debug builds only** additionally honour a runtime override (`UserDefaults` key `api_base_url`, editable in the More tab and on the login screen) for physical-device/LAN testing — the whole override (UI + read path) is wrapped in `#if DEBUG`, so it compiles out of Release/production builds. To ship against a real backend, set the Release `API_BASE_URL` build setting. ATS is opened for local networking only (`NSAllowsLocalNetworking`).
- **View mode (Private/Household/Blended)** mirrors the web `ViewModeContext`. `ViewModeStore` (`State/ViewModeStore.swift`, app-root environment) holds the persisted mode + a `hasSecondPerson` flag; the `ViewModeSwitcher` toolbar control (`Views/Components/`) renders only once the active household has a second person (member beyond owner, or a pending invite — refreshed on household change in `MainTabView` and after invite changes via `setComposition`). `isVisible(ownerUserId:currentUserId:)` filters accounts/sub-portfolios (and their balances/holdings/transactions) on Dashboard, Accounts, Portfolio, and Transactions. Solo households always render `blended` (everything the user owns), so filtering is a no-op until a second person exists.
- **Face ID vault lock** (`require_face_id_for_vault`, an existing backend field that neither the web nor mobile surfaced) is enforced only on iOS. `ViewModeStore` also owns the vault state: `configureVault(requireFaceId:)` (called from `MainTabView` on login / when the user record's flag changes) caches `BiometricAuth.isAvailable`; while `isVaultLocked` (setting on **and** device can authenticate **and** not yet unlocked), `isVisible` hides **all** private items regardless of view mode. Unlock is `LocalAuthentication` via `Support/BiometricAuth.swift` using `.deviceOwnerAuthentication` (Face ID / Touch ID with passcode fallback). **It fails open**: a device with no biometrics/passcode can't lock, so users are never shut out of their own data. `MainTabView` auto-prompts once on login/foreground and re-locks on `.background` (guarding against `.inactive`, since the biometric sheet itself makes the app inactive — locking there would loop). The `VaultLockButton` toolbar control shows a lock/unlock affordance when the feature is active. Note the backend **defaults this field to `true`**, so once enforced, every user's private vault is biometric-gated by default (the preview test user was flipped to `false` locally so browser/simulator verification isn't blocked by the prompt).
- **Performance metrics** come from `GET /portfolio/household/{id}/metrics` (`PortfolioMetricsResponse.overallMetrics`, a `PerformanceMetrics` mirroring the backend schema — includes `sortino_ratio`, `treynor_ratio`, `alpha`, `beta`). The Portfolio tab renders the full grid (Unrealized P&L, Div Yield, TWR, IRR/MWR, Sharpe, Sortino, Treynor+Beta, Jensen's α vs SPY); the Dashboard shows a compact Returns row (Overall Return, TWR, IRR/MWR, Sharpe). `StatTile` (in PortfolioView.swift) is the shared card, with `ratioString` / `percentString` / `returnTint` statics reused by both screens.
- **Theming** mirrors the web ThemeContext: the user's `primary_color`/`secondary_color`/`base_color` names (UserResponse) resolve to Tailwind color scales in `ThemePalettes.swift`, which is *generated* from `frontend/node_modules/tailwindcss/theme.css` (oklch → sRGB) — if the web palette choices change, regenerate it with `python3 ios/scripts/gen_palettes.py`. `SessionStore.theme` exposes the resolved `AppTheme`; the root view applies `.tint(theme.primary.accent)` (shade 600 light / 400 dark) and `preferredColorScheme` from `theme_mode`. Charts and gradient accents pull `session.theme` directly. The base palette is persisted for parity but (like the web today) not painted onto backgrounds. Appearance is editable in the More tab via `PUT /users` partial updates.

## Build & Run

```sh
cd ios
xcodegen generate          # after any file add/remove or project.yml change
open FinanceTracker.xcodeproj
```

CLI build: `xcodebuild -project FinanceTracker.xcodeproj -scheme FinanceTracker -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build`. The scheme is declared in `project.yml` (`targets.FinanceTracker.scheme`) so `xcodegen generate` always recreates a shared scheme — don't remove it, or the generated project ends up with no scheme and Xcode can't build/run. A `-scheme` build writes to DerivedData (same as the Xcode GUI). Note: `xcodebuild -target` (without `-scheme`) instead dumps products in `ios/build/` — mixing the two is a classic "running stale code" trap, so stick to `-scheme`. xcodebuild can also report SUCCEEDED off a stale incremental build; use `clean build` when a change isn't showing.

Backend must be running (`docker compose up` at repo root).

## Testing

Logic unit tests live in `FinanceTrackerTests/` and use **Swift Testing** (`import Testing`,
`@Test`, `#expect`), not XCTest. The `FinanceTrackerTests` target (declared in `project.yml`,
`type: bundle.unit-test`) depends on the app target, so XcodeGen auto-wires `TEST_HOST` +
`BUNDLE_LOADER` and every test file does `@testable import FinanceTracker` to reach internal
symbols. It's a hosted bundle — the app launches in the simulator, then tests run in-process.

Run them:

```sh
xcodebuild -project FinanceTracker.xcodeproj -scheme FinanceTracker \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' test
```

Coverage focuses on **pure, deterministic logic** — that's where subtle regressions hide and
where tests pay off without a running backend:
- `GoalProjectionTests` — the goal projection math (`Support/GoalProjection.swift`); the
  biggest suite. History-only fields (percent, remaining, pace, no-target-date on-track) are
  asserted exactly; `Date()`-relative fields (ETA, monthsToTarget, requiredPace) use tolerance.
- `MoneyDecodingTests` — `@MoneyAmount` / `@OptionalMoneyAmount` accepting both JSON numbers
  and Pydantic's Decimal-as-string.
- `ModelDecodingTests` — representative backend JSON through the real `APIClient.decoder`
  (`.convertFromSnakeCase` + `DateParser`); catches `Models.swift` ⇄ `schemas.py` drift. Also
  covers `SubPortfolioUpdate`'s omit-vs-explicit-null owner encoding.
- `ViewModeStoreTests` — the Private/Household/Blended `isVisible` + `effectiveMode` rules.
- `FormattersTests` — the backend-critical `Date.apiDateOnly` (exact); currency/percent
  helpers get locale-tolerant structural checks only (their output is Foundation's, not ours).

New tests should stay backend-free: exercise the pure functions and Codable models, don't spin
up `APIClient` network calls.
