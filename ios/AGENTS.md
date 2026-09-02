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
  Support/HistoryGroups.swift # Swift port of web lib/historyGroups.ts — day/month/year bucketing
                             #   and the per-section income/spend totals on the Transactions list
  Support/NetWorth.swift    # Swift port of web lib/networth.ts (summarizeAccounts / netWorthBreakdown) — keep in sync
  Support/PortfolioAnalytics.swift # pure equity-curve / allocation / FX maths shared by the Portfolio tab
                             #   and the per-sub-portfolio detail screen (see the growth-chart note below)
  Support/CashFlowSummary.swift # The "plan" half of the Cash Flow tab: what needs attention
                             #   (over/at-risk budgets, burst/at-pace card limits, rules due now),
                             #   the near-horizon upcoming window, and the shared `load` both the
                             #   Cash Flow tab and the Dashboard's exception row call
  Support/CategoryPeriod.swift # Date window + saved filter for the Transactions "Top Categories"
                             #   card (port of the web's CategoryPeriodPreset); UserDefaults-backed
                             #   TopCategoryFilterStore keyed per household
  Support/AppTheme.swift     # Palette + AppTheme resolved from user's saved color names
  Support/ThemePalettes.swift# GENERATED sRGB scales from the web's Tailwind palette — regenerate, don't hand-edit
  Views/                     # Tab bar (5): Dashboard, Accounts, Portfolio, Cash Flow, More (+ Auth)
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
                             #   Portfolio/SubPortfolioDetailView.swift = one sub-portfolio scoped to
                             #     Growth / Holdings / Dividends, pushed from a sub-portfolio's row in the
                             #     Portfolio tab. Native counterpart of the WEB PORTFOLIO TAB BAR: the web
                             #     re-scopes its whole page to the selected sub-portfolio, which a phone-width
                             #     tab strip can't do, so the scoping is a drill-in here. There's no "Overall"
                             #     segment — PortfolioView itself is the overall view. Growth = scoped equity
                             #     curve + range picker + PerformanceTileGrid off that sub-portfolio's
                             #     PerformanceMetrics + (when a target is set) goal progress linking on to
                             #     GoalDetailView. Holdings = scoped AllocationCard + DetailedHoldingRow
                             #     (shares / avg cost / price in native *and* home currency, return, and a
                             #     trade / record-price / edit-asset / manage-cash menu). Dividends = scoped payouts with
                             #     total received, trailing yield and per-share detail.
                             #   Portfolio/ also has an AllocationCard (donut by asset type + legend + FX-exposure
                             #     chips, colours matched to the web ALLOCATION_COLORS), plus TradesListView
                             #     tap to edit (TradeFormView in edit mode → PUT /portfolio/trades/{id}), swipe to
                             #     delete; the CASH pseudo-asset legs are filtered out. Trade editing needs the backend
                             #     TradeUpdate UUID fix (schemas.py) — the ID fields were Optional[int].
                             #   Asset details are correctable after the fact (a ticker created under the
                             #     wrong currency is the motivating case): AssetEditView (PUT
                             #     /portfolio/assets/{id}), reached by swiping a Portfolio holding row or from
                             #     DetailedHoldingRow's menu. Pseudo-assets (cash, earmarked accounts) are
                             #     excluded — the API refuses them. A ticker or currency change replays
                             #     snapshots server-side, so the caller reloads instead of patching its copy.
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
                             #   CashFlow/  = the summary block that turned the Transactions tab into
                             #     "Cash Flow": NeedsAttentionSection (exception-only — renders nothing
                             #     when the household is fine) and SummaryLinkRow, the one-line
                             #     Budgets / Cards / Coming up / Shared rows that push the full screens.
                             #     Both are hosted by TransactionsView; NeedsAttentionSection is also
                             #     mounted on the Dashboard, which is the point — the Dashboard asks
                             #     "is anything wrong?" unprompted, the tab is where you look on purpose.
                             #   Transactions/ = list + add/edit (TransactionFormView, tap a row to edit;
                             #     transfers are not editable here) + CategoriesView (category CRUD,
                             #     also reached from More → Categories and inline from the New Transaction sheet).
                             #   Budgets/   = BudgetsView (More → Budgets & Emergency Fund): the runway
                             #     readout + editable target (PUT /users/households/{id}) over
                             #     GET /cashflow/household/{id}/emergency-fund, plus budget rows with a
                             #     pace marker over GET /cashflow/budgets/household/{id}/status, and
                             #     BudgetFormView for create/edit. Native counterpart of web /budgets.
                             #   Recurring/ = RecurringView (More → Recurring, and the Cash Flow tab's
                             #     "Coming up" row): normalized monthly commitment stats plus a
                             #     "Where it goes" breakdown by category, a "post due now" button
                             #     (POST .../run — the nightly job does this anyway), rules grouped by
                             #     BudgetPresentation.health (Needs attention / Active / Paused) with
                             #     swipe to pause/resume/delete, and the 90-day agenda grouped by month.
                             #     A row pushes RecurringDetailView — schedule, track record
                             #     (posted count / total to date, off the backend's posted_count and
                             #     posted_total_home_currency) and the transactions the rule posted, via
                             #     GET /cashflow/transactions/household/{id}?recurring_transaction_id=…
                             #     Native counterpart of web /recurring.
                             #     Delete asks for confirmation first (a `.confirmationDialog`) and tracks
                             #     pending/error state per-rule in RecurringView itself, not on
                             #     RecurringRuleRow — a dialog presented from inside a swipe-actions row can
                             #     get torn down with the row's own collapse animation before it's shown.
                             #   Accounts/ also has LoanScheduleView (account detail → Payoff schedule,
                             #     shown only when `AccountResponse.hasLoanTerms`) and EquityRow, the
                             #     property-vs-loan band at the top of the accounts list.
                             #   Reports/   = ReportsView (More → Reports): GET /exports/household/{id}/report
                             #     rendered as net worth / portfolio / cash flow / dividends / goals, plus CSV
                             #     export (GET .../csv → ZIP shared via ShareSheet + APIClient.getData).
                             #   Household/ = HouseholdMembersView (More → Members & Invites): list members
                             #     (GET /users/householdmember/{hid}), send/cancel email invites
                             #     (POST/DELETE /users/households/{hid}/invites), remove members.
```

## Conventions

- JSON decoding uses `.convertFromSnakeCase` — model properties are camelCase versions of the Pydantic field names. Keep `Models.swift` in sync with `backend/src/schemas.py` when schemas change.
- **Money fields must use `@MoneyAmount` / `@OptionalMoneyAmount`** (property wrappers in Models.swift): Pydantic serializes `Decimal` fields as JSON _strings_ ("5000.00") while float fields are numbers. A plain `Double` property will fail to decode any backend Decimal field.
- Backend dates are naive ISO strings; `DateParser` in APIClient.swift handles date-only, datetime, and fractional-second variants. It is a **hand-rolled byte scanner, not a `DateFormatter`** — deliberately, and it must stay that way. Date decoding is the app's hottest path (a Dashboard load decodes tens of thousands of date fields across balances, transactions and the portfolio timeseries), and the old six-formatter fallback chain cost ~100µs per field, with the *most common* shape (date-only) paying four failed parses before the one that worked. That was the bulk of the app's half-minute cold start; the scanner is ~2000× faster on the same input. `DateParser.legacyParse` keeps the formatter chain as a fallback for shapes the scanner rejects, and `DateParserTests` pins the two against each other for every format the backend emits. If you ever need to accept a new date shape, extend the scanner *and* the test's `backendShapes` — don't reintroduce a formatter on the fast path.
- **Display formatters must render in UTC**, via `Date.FormatStyle.utc` (`Support/Formatters.swift`). Backend dates mean a *calendar date* and are parsed at UTC midnight, so `.formatted(.dateTime…)` with the device calendar shifts them a day — a 31 Dec goal printed "January 2026" on a UTC+8 machine, and rows drift out of the month section header they sit under (headers group in UTC via `BudgetPresentation.groupedByMonth`). `apiDateOnly` already pinned UTC for the write path; `shortDay` / `monthYear` / `dueMonthYear` / `utcDayMonthYear` / `utcYear` are the read path. **The same rule binds anything that *buckets* dates, not just anything that formats them.** `groupHistory` / `historyGroupLabel` (`Support/HistoryGroups.swift`) default to `historyCalendar` (UTC) rather than `.current` — they used to bucket in the device calendar while labelling in UTC, which headed every month section with the previous month's name for anyone east of Greenwich (a Singapore user's July rows sat under "June 2026") and disagreed with the rows' own `shortDay` west of it. Android's `HistoryGroups.kt` has always used `ZoneOffset.UTC` throughout. **The one deliberate exception is `historyGroupLabel`'s `localCalendar`**, which decides Today/Yesterday: that is the only question on the screen that is about the reader's day rather than the backend's calendar date, and answering it in UTC headed today's rows with their date and *yesterday's* rows "Today" for the eight hours each morning Singapore runs ahead of UTC. Android's `localZone` parameter is the twin. Android says the same in `logic/Formatters.kt`; `FormattersTests` straddles both ends of the UTC day so the assertions bite in any non-UTC timezone.
- All aggregate money displays use the household `baseCurrency` and the `*_home_currency` fields; per-account/per-asset detail uses native currency (same rule as web/mobile).
- **A liability is rendered as money owed, never as a balance.** `AccountRow` negates and reddens a `kind == "liability"` account and captions it "Owed", and `AccountsListView` keeps liabilities out of the liquidity sections entirely, in their own "Loans & liabilities" one. Liquidity describes how fast an asset could be spent and says nothing useful about a debt, so a mortgage filed as `liquid` used to sit under a "Liquid" header showing `$440,000.00` in the same ink and sign as real cash — while net worth quietly subtracted it. The web Accounts page has always done it this way (`isLiability ? -balanceHome : balanceHome`, in red, under its own group); Android's `AccountsScreen.kt` does the same.
- `AccountRow` names the account's own currency in its caption only when it differs from the household's base currency — the amount renders in `account.currency`, so a USD and an SGD account otherwise print the same "$" with nothing to tell them apart. It also takes `showsLiquidity`, which the Accounts tab turns off: the row sits under a section header naming the bucket already, and repeating it spent the row's only secondary line on a word the reader had just read.
- Private ownership (`owner_user_id != nil`) is rendered with a lock icon; the server already filters out other members' private data. Create forms (AccountFormView, GoalFormView) seed their Private toggle from the user's `default_new_items_private` in `.onAppear` (SessionStore isn't reachable from `init`), matching web.
    - `SubPortfolioUpdate.ownerUserId` is a `.unchanged` / `.set(String?)` enum with a hand-written `encode(to:)`, not a plain `String?`. The backend PATCH uses `exclude_unset`, so omitting the key leaves ownership alone while an explicit `null` clears it — a plain Optional can only express the first, which would make "Private → Shared" silently do nothing (the web UI has that limitation).
- **Gestures come in pairs, and destructive ones confirm.** Every swipe action on a row is
  mirrored by a `.contextMenu` carrying the same items — a swipe is invisible until you try it
  and is out of reach of Voice Control and Switch Control, so it can never be the only path to
  an action. Anything irreversible (delete a transaction / trade / budget / category, remove a
  household member) uses `.swipeActions(allowsFullSwipe: false)` plus a `.confirmationDialog`,
  never `.onDelete` — a full swipe must reveal the button, not commit. The dialog's state lives
  on the **screen**, not the row: a dialog presented from inside a swipe-actions row is torn
  down with the row's own collapse animation before it is ever shown. Cancelling an invite is
  the deliberate exception (re-inviting undoes it), so it keeps a plain swipe.
    - **Where the confirmation *appears* depends on which view carries the modifier.** It
      renders as a bubble anchored to that view, so a `.confirmationDialog` hung off the
      screen points at the top of the list however far down the button was — Log Out at the
      bottom of More produced a bubble whose tail aimed at "Budgets & Emergency Fund".
      Anything triggered by an ordinary **button or menu** therefore carries the modifier on
      that control: `MoreView`'s Log Out, `DiscardGuard`'s Cancel, `GoalDetailView`'s toolbar
      menu, `RecurringDetailView`'s Delete. Anything triggered by a **swipe action** cannot,
      and must stay at screen level: attaching it to the row was tried and *silently* fails —
      tapping the swipe's Delete collapses the row, the dialog goes with it, and the user gets
      neither a confirmation nor a deletion. Scoping the binding to the row's id doesn't help;
      it is the row's teardown, not the shared state, that kills it. A mis-anchored bubble is
      the lesser of the two problems.
- **The QuickAdd pull gesture** (`Components/QuickAddPull.swift`) needs two signals: `onScrollGeometryChange` for the overscroll distance, and a `.simultaneousGesture(DragGesture)` for finger down/up. `onScrollPhaseChange` is the API that _looks_ right, but on a `List` it only ever delivers `.idle` — no `.interacting`/`.decelerating` — so it cannot detect release. The bar opens when the pull passes `trigger` (100pt of overscroll ≈ a 220pt pull) and the finger then lifts without flicking back *up* faster than `retractVelocity` (900 pt/s). It is the release **direction** that decides, not its speed: still moving down, or roughly still, completes the gesture the "Release for Quick Add" badge just promised, and a confident fast pull is the most deliberate version of that, not the least — only a sharp flick upward reads as taking it back. Momentum-only overscroll can't arm it at all, because `dragging` (set by the `DragGesture`, cleared on end *and* when the sheet opens) gates every update.
  The live gesture state lives in an `@Observable`
  `PullState` read only by the `PullIndicator` subview, **not** as `@State` on the modifier:
  `pull` is rewritten every frame of a drag, and on the modifier that invalidated its own body
  each frame, re-installing the `DragGesture` recognizer and re-laying-out the overlay against
  the whole List. Keep new per-frame gesture state out of the modifier body for the same reason.
  It is on **every browse screen** — the five tabs, the pushed detail screens (account, goal,
  loan schedule, sub-portfolio), and the More-tab pages (Budgets, Categories, Recurring,
  Reports, Members). It fully replaces `.refreshable`, which no longer appears anywhere: the
  same downward pull had to mean the same thing on every screen, and two different meanings
  split by "main tab vs. More tab" was a distinction only the code could see. Screens refetch
  on `.task` and on `QuickAddStore.reloadToken`; there is no manual refresh control. Modal
  sheets and edit forms deliberately have no pull — interrupting a half-filled form with
  another modal is not a gesture anyone wants.
- **Charts are interactive, through `Views/Components/ChartStyle.swift`.** Time-series charts
  (Dashboard net worth, `GrowthChart`, the goal projection, an account's balance) take
  `.chartScrub(selection:readout:)`: the caller owns the `Date?` the gesture writes and
  resolves a `ChartScrubReadout` from it with `ChartStyle.nearest` (curves are *binned*, so the
  finger lands between points far more often than on one), and the modifier draws the rule and
  the dots and ticks a `.selection` haptic per datum. Readouts go in a `ChartScrubCaption`
  beside the plot, not a floating tooltip — a bubble covers the data being asked about and has
  to be measured and clamped every frame. The Dashboard goes further and rewrites its own
  headline figure, date label and Cash/Investments cells from the scrub instead of adding a
  caption. Donuts (Net Worth Split, Allocation, Top Categories) use `.chartAngleSelection` +
  `ChartStyle.sliceIndex`, which resolves the *cumulative* angle the API reports back to a
  slice; the picked wedge grows outward and the rest dim, the donut's centre reads it out, and
  the legend rows are buttons that select the same wedge (a thin sector is a poor touch target
  and the only accessible way in).
- **Sheets can't discard unsaved work by accident** — `.discardGuard(fields:settled:)`
  (`Views/Components/DiscardGuard.swift`) is on all ten create/edit sheets. It supplies the
  Cancel button (so the wording and the confirmation are identical everywhere rather than ten
  near-copies), blocks the drag-to-dismiss while the form is dirty, and asks "Discard changes?"
  on Cancel. Dirtiness is a comparison against a baseline the modifier snapshots, not an
  `initial` copy hand-maintained inside each form — those drift as forms gain fields and a
  stale one silently stops guarding. A field omitted from `fields` under-protects (the sheet
  behaves as it did before) rather than misbehaving.
    - **`settled:` is the part that isn't obvious.** Forms don't all arrive fully populated:
      `AccountFormView` fills in the household currency and the private-by-default toggle in
      `onAppear` (SessionStore isn't reachable from `init`), and `QuickAddView` picks its
      default account / category / sub-portfolio in `applyDefaults()` *after* a fetch.
      Snapshotting "the values as first drawn" caught both mid-setup and read their own seeding
      as a user edit, so a brand-new account sheet asked "Discard changes?" before it had been
      touched. Those two pass `settled:` (`didSeedPrivacy && !currency.isEmpty`, and `loaded`);
      the baseline is taken when it turns true. Any new form that seeds itself must do the same.
- **API base URL** resolves in `APIClient.baseURL` via `AppConfig.defaultBaseURL`, which reads the `API_BASE_URL` Info.plist key (fed by the per-configuration `API_BASE_URL` build setting in `project.yml`, `$(API_BASE_URL)`; falls back to `http://localhost:8000`). **Debug builds only** additionally honour a runtime override (`UserDefaults` key `api_base_url`, editable in the More tab and on the login screen) for physical-device/LAN testing — the whole override (UI + read path) is wrapped in `#if DEBUG`, so it compiles out of Release/production builds. To ship against a real backend, set the Release `API_BASE_URL` build setting. ATS is opened for local networking only (`NSAllowsLocalNetworking`).
- **View mode (Private/Household/Blended)** mirrors the web `ViewModeContext`. `ViewModeStore` (`State/ViewModeStore.swift`, app-root environment) holds the persisted mode + a `hasSecondPerson` flag; the `ViewModeSwitcher` toolbar control (`Views/Components/`) renders only once the active household has a second person (member beyond owner, or a pending invite — refreshed on household change in `MainTabView` and after invite changes via `setComposition`). `isVisible(ownerUserId:currentUserId:)` filters accounts/sub-portfolios (and their balances/holdings/transactions) on Dashboard, Accounts, Portfolio, and Transactions. Solo households always render `blended` (everything the user owns), so filtering is a no-op until a second person exists.
- **Face ID vault lock** (`require_face_id_for_vault`, an existing backend field that neither the web nor mobile surfaced) is enforced only on iOS. `ViewModeStore` also owns the vault state: `configureVault(requireFaceId:)` (called from `MainTabView` on login / when the user record's flag changes) caches `BiometricAuth.isAvailable`; while `isVaultLocked` (setting on **and** device can authenticate **and** not yet unlocked), `isVisible` hides **all** private items regardless of view mode. Unlock is `LocalAuthentication` via `Support/BiometricAuth.swift` using `.deviceOwnerAuthentication` (Face ID / Touch ID with passcode fallback). **It fails open**: a device with no biometrics/passcode can't lock, so users are never shut out of their own data. `MainTabView` auto-prompts once on login/foreground and re-locks on `.background` (guarding against `.inactive`, since the biometric sheet itself makes the app inactive — locking there would loop). The `VaultLockButton` toolbar control shows a lock/unlock affordance when the feature is active. Note the backend **defaults this field to `false`** (flipped from `true` — a mandatory Face ID/passcode prompt before the first Dashboard load was pure friction for the common case of a solo household with no one to hide data from) — a user opts in from Privacy & Vault. The preview test user matches this default, so browser/simulator verification isn't blocked by the prompt unless it's turned on locally.
- **Query strings must go through `APIClient.url(base:path:)`.** `URL.appending(path:)` percent-encodes its argument, so a path like `"/x/projection?months=360"` turns the `?` into `%3F`, the query becomes part of the path, and the request 404s _silently_ if the call site uses `try?` (which is how the dashboard's net-worth outlook first went missing). `send` routes every request through the splitter; don't reintroduce `baseURL.appending(path:)` at a call site. `APIURLTests` pins the behaviour.
- **`Support/BudgetPresentation.swift`** is the Swift port of the web's `frontend/src/lib/budgets.ts` — budget tone (over / at-risk / ok), the runway label and tone, the recurring commitment/agenda helpers, and the **rule health** rules (`health` / `scheduleLabel` / `postingLabel` / `isCommitted` / `commitmentByCategory`). Keep the two in sync; both clients must say the same thing about the same numbers. Two rules it encodes deliberately: a budget is "at risk" the moment its _projected_ spend exceeds the limit (warning on the 10th is the point; warning on the 30th is useless), and a nil `monthsCovered` renders as "Not enough data", never "∞" — an undefined runway is not an infinite one.
    - **Rule health is four states, not two.** A rule due *today* is healthy — rules post overnight, so nothing has been missed — while a date already behind us is `.overdue`. A rule past its `end_date` is `.ended` even though `is_active` is still true, because the engine only clears that flag the next time it runs; `.ended` also outranks `.paused`, since "finished" is the more useful of the two words. This is what `isCommitted` is for: `is_active` alone counted a cancelled gym membership as a monthly commitment forever, in both the headline figure and the by-category breakdown.
- **Performance metrics** come from `GET /portfolio/household/{id}/metrics` (`PortfolioMetricsResponse.overallMetrics`, a `PerformanceMetrics` mirroring the backend schema — includes `sortino_ratio`, `treynor_ratio`, `alpha`, `beta`). The Portfolio tab renders the full grid (Unrealized P&L, Div Yield, TWR, IRR/MWR, Sharpe, Sortino, Treynor+Beta, Jensen's α vs SPY); the Dashboard shows a compact Returns row (Overall Return, TWR, IRR/MWR, Sharpe). `StatTile` (in PortfolioView.swift) is the shared card, with `ratioString` / `percentString` / `returnTint` statics reused by both screens. `PerformanceTileGrid` wraps the full grid so `SubPortfolioDetailView` can render the same tiles off `subPortfolioMetrics[…].metrics` instead of the overall ones.
- **Growth charts** (`Support/PortfolioAnalytics.swift`) are built by `equityCurve(snapshots:subPortfolioId:range:now:)` and shared by the Portfolio tab and the sub-portfolio detail screen. Two deliberate divergences from web:
    - The web has _two_ controls — a range (1M…ALL) and a Daily/Weekly/Monthly/Yearly binning selector. Two adjacent selectors don't fit a phone, so only the range is exposed and the bin is derived from the data's span (`growthBin(forSpanDays:)`: ≤92d daily, ≤550d weekly, else monthly). Binning keeps the **last** value in each bucket, not a sum or mean — an equity curve is a running balance (this matches the web's `binHistory`). Bucketing uses a **UTC, Monday-first** calendar so a snapshot can't drift into a neighbouring bucket by timezone.
    - `allocationSlices` weights by `current_value_home_currency`, whereas the web weights by native value — which mixes units in a multi-currency portfolio (a US$1 and a S$1 position get the same wedge there).
    - `periodChange` returns a **nil** `fraction` when the opening balance is under 1% of the closing one. A goal funded from $42 to $13,104 is not a +31,100% return, and printing that as one is worse than printing no percentage.
    - `periodChange`'s fraction is a raw curve-endpoint ratio with **no cash-flow adjustment**, so a recurring contribution still counts as "growth" the same as a market gain — the 1%-base guard above only catches the extreme case, not a household funding a goal $500/month. `SubPortfolioDetailView` is the only screen that shows this badge (the main Portfolio tab's growth chart has no percentage overlay); for every range it swaps in a `/metrics` call scoped to that same window (`metrics.simpleReturn` for `.all`, reusing the fetch the Performance grid already made; a fresh `start_date`-scoped fetch via `GrowthRange.cutoffDate(now:)` for 1M/6M/1Y, cached as `rangeMetrics`/`rangeMetricsRange`) instead of the naive fraction — `simpleReturn` is already flow-adjusted the same way TWR/IRR are (see `performance.py`, issue #256). The dollar delta stays curve-based regardless, since "value went up by $X" is true no matter where the money came from; `rangeMetricsRange == range` guards against showing a slow response after the user has already flipped ranges again, falling back to the naive fraction while a fetch is in flight or has failed.
- **Net Worth Split** (`Support/NetWorth.swift`, rendered on the Dashboard by `NetWorthSplitChart`) is a donut of gross-asset composition — Cash / Investments / Retirement & Locked / Property / Other Assets — with liabilities and the net total as plain rows underneath rather than wedges (a `SectorMark` donut can't render a negative slice). `netWorthBreakdown`'s `sliceTotal` is the sum of the *visible* slices only, which is deliberately not the same as gross assets when a bucket (e.g. cash, for an overdrawn household) goes negative and gets dropped — that's also why `NetWorthSplitChart` takes the screen's independently-computed `netWorth` as its own parameter instead of deriving `sliceTotal - liabilities`, which would silently drop the excluded negative bucket from the total.
- **Charts all go through `Views/Components/ChartStyle.swift`.** Three rules it exists to keep:
  **multi-slice breakdowns are fixed, not themed** (`ChartStyle.categorical` = the web's
  `--chart-cat-1..5`, with its own validated dark steps; assigned by *key* via
  `netWorthColor(key:)`, never by the slice's index — the donut drops empty buckets, so an
  index would repaint the survivors), **fills are gradient washes with a 2pt edge line**
  rather than saturated blocks, and **chrome recedes** (hairline *solid* gridlines, few
  ticks, secondary-ink labels, no plot border) via `.financeChartAxes(currency:dateSpan:)`.
  Pass `dateSpan` — it picks year / month-year / day-month labels, and the last label is
  right-anchored so it isn't truncated by the trailing y-axis gutter. Charts with only one or
  two named series (a goal curve, one account's balance, the Dashboard's Cash/Investments
  area chart) keep `session.theme` accent instead of the fixed categorical palette — matching
  web and Android — since there's no third slice for the accent to be confused with. The
  Dashboard's net-worth chart draws its two bands explicitly (`NetWorthAreaChart`, taking
  `cashColor`/`investmentsColor` from `session.theme.secondary`/`primary.accent`) instead of
  letting Swift Charts stack them, because cash goes negative for an overdrawn household and
  an automatic stack renders that flipped through the axis instead of hanging below zero. Its
  series is **binned by span** through
  the same `growthBin(forSpanDays:)` the growth charts use — a household tracking daily for
  five years is ~1,800 dates, which is more marks than a phone-width plot can resolve and
  which Swift Charts re-lays-out on every redraw. `NetWorthBandPoint.id` is the **date**,
  never a fresh `UUID`: per-instance identity means Charts can't match a mark to its previous
  self and rebuilds the whole plot each time.
- **Screen-level aggregates are derived once per load, not per `body`.** `DashboardDerived`
  (DashboardView.swift) computes the visible-account filtering, the latest-balance-per-account
  pass, the net-worth split and the chart bands in a single pass, stored in `@State` and
  refreshed by `load()` plus an `.onChange(of: visibilityKey)` for a view-mode flip or vault
  unlock. As computed properties these re-ran on every `body` evaluation — and scrubbing a
  chart evaluates `body` once per frame, so a drag re-walked the household's entire history
  ~120 times a second. Android's `DashboardScreen` does the same thing with `remember(...)`.
- **Theming** mirrors the web ThemeContext: the user's `primary_color`/`secondary_color`/`base_color` names (UserResponse) resolve to Tailwind color scales in `ThemePalettes.swift`, which is _generated_ from `frontend/node_modules/tailwindcss/theme.css` (oklch → sRGB) — if the web palette choices change, regenerate it with `python3 ios/scripts/gen_palettes.py`. `SessionStore.theme` exposes the resolved `AppTheme`; the root view applies `.tint(theme.primary.accent)` (shade 600 light / 400 dark) and `preferredColorScheme` from `theme_mode`. Charts and gradient accents pull `session.theme` directly. The base palette is persisted for parity but (like the web today) not painted onto backgrounds. Appearance is editable in the More tab via `PUT /users` partial updates.

## Build & Run

```sh
cd ios
xcodegen generate          # after any file add/remove or project.yml change
open FinanceTracker.xcodeproj
```

CLI build: `xcodebuild -project FinanceTracker.xcodeproj -scheme FinanceTracker -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build`. The scheme is declared in `project.yml` (`targets.FinanceTracker.scheme`) so `xcodegen generate` always recreates a shared scheme — don't remove it, or the generated project ends up with no scheme and Xcode can't build/run. A `-scheme` build writes to DerivedData (same as the Xcode GUI). Note: `xcodebuild -target` (without `-scheme`) instead dumps products in `ios/build/` — mixing the two is a classic "running stale code" trap, so stick to `-scheme`. xcodebuild can also report SUCCEEDED off a stale incremental build; use `clean build` when a change isn't showing.

Backend must be running (`docker compose up` at repo root).

## Release Build & Install on Your Own Device

Two ways to get a Release build onto your iPhone/iPad, depending on what you need:

**Quick iteration (most testing)** — run a Release-configured build straight from Xcode with a
cable attached: `open FinanceTracker.xcodeproj` → Product ▸ Scheme ▸ Edit Scheme… ▸ Run ▸ Build
Configuration → **Release** → pick your device as the destination → Cmd+R. This exercises the
real `Release` `API_BASE_URL` (`https://financeapi.ivanleekaikiat.com` per `project.yml`) and
optimizations, without producing a distributable artifact. The first time you do this for a given
device, Xcode auto-registers its UDID with the `9SA33W38S2` team and provisions it — required
before the archive/export route below will work for that device.

**Archive + install an IPA (to test off-cable, or hand the build to the device without Xcode
attached)**:

1.  Confirm the device is paired and note its identifier:
    ```sh
    xcrun devicectl list devices
    ```
2.  Archive in Release:
    ```sh
    xcodebuild archive \
      -project FinanceTracker.xcodeproj -scheme FinanceTracker -configuration Release \
      -destination 'generic/platform=iOS' -archivePath build/FinanceTracker.xcarchive
    ```
3.  Create `ios/exportOptions.plist` (one-time; not checked in — add it to `.gitignore` if you
    keep it in the repo tree) for **development** distribution, which signs for devices already
    registered to the team rather than the App Store:
    ```xml
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">
    <dict>
      <key>method</key><string>development</string>
      <key>teamID</key><string>9SA33W38S2</string>
      <key>signingStyle</key><string>automatic</string>
    </dict>
    </plist>
    ```
4.  Export the `.ipa`:
    ```sh
    xcodebuild -exportArchive -archivePath build/FinanceTracker.xcarchive \
      -exportOptionsPlist exportOptions.plist -exportPath build/export
    ```
5.  Install onto the paired device from step 1 (swap in its `Identifier`):
    ```sh
    xcrun devicectl device install app --device <device-udid> build/export/FinanceTracker.ipa
    ```
    Launch it immediately, optionally:
    ```sh
    xcrun devicectl device process launch --device <device-udid> com.ivanlee.financetracker
    ```

Dragging the `.ipa` onto Xcode's Window ▸ Devices and Simulators panel works the same way as step
5, if you prefer the GUI. A `development`-method export only installs on devices already
registered with the team (see the Quick Iteration note above) — it is not a TestFlight/App Store
build and does not need App Store Connect at all.

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
- `PortfolioAnalyticsTests` — `Support/PortfolioAnalytics.swift`: equity-curve aggregation,
  sub-portfolio scoping, range windows, the daily/weekly/monthly bin thresholds and
  last-in-bucket rule, `periodChange`'s small-base guard, allocation and FX exposure. Dates
  are built with an explicit UTC calendar so results don't depend on the machine's timezone.
- `HistoryGroupsTests` — `Support/HistoryGroups.swift`: day/month/year bucketing, the
  section totals (transfers excluded on both legs, unconverted rows counted rather than
  summed), and the Today/Yesterday labels. Dates use an explicit UTC calendar.
  `HistoryGroupTimezoneTests` sits alongside it and deliberately does **not** pass a
  calendar, because passing one is what hid a live bug: every test in the older suite
  supplied `calendar: utc` while `TransactionsView` calls `groupHistory` with the default,
  so the suite pinned a path the app never took. A test for a function with a
  timezone-dependent default has to exercise that default.
- `CashFlowSummaryTests` — `Support/CashFlowSummary.swift`: what counts as due, the
  upcoming window's bounds, view-mode scoping of occurrences, and the attention wording
  (over vs at-risk, a burst cap vs a missed minimum, unmetered limits skipped). Every `now`
  is injected and dates are built in UTC.
- `CategoryPeriodTests` — the Top-Categories date-window math (`Support/CategoryPeriod.swift`);
  every case passes an explicit `now` and dates are built in UTC.
- `ReimbursementsTests` / `ReimbursementCodingTests` — `Support/Reimbursements.swift` (the
  N-way split maths, shared with web and Android) plus the `TransactionUpdate` encoder. The
  coding suite is the important half: it pins that a transaction with **no** `splits` key still
  decodes as an empty split (every row logged before the ledger comes back that way), and that
  `TransactionUpdate.splits` follows plain `encodeIfPresent` semantics — nil omits the key
  (leave the recorded split alone), `[]` sends an empty array (clear it), a populated array
  sends it (replace it wholesale). A plain optional array already has an unambiguous empty
  state, so unlike `cardCategoryId` (still hand-written for its own explicit-null requirement)
  there is no tri-state wrapper for this field.
- `ViewModeStoreTests` — the Private/Household/Blended `isVisible` + `effectiveMode` rules.
- `FormattersTests` — the backend-critical `Date.apiDateOnly` (exact); currency/percent
  helpers get locale-tolerant structural checks only (their output is Foundation's, not ours).
- `DateParserTests` — the hand-rolled ISO-8601 scanner in `APIClient.swift`, asserted
  **against `DateParser.legacyParse`** (the formatter chain it replaced) for every shape the
  backend emits, plus the UTC-midnight and offset-removal rules and a garbage-rejection set.
  A scanner that is fast but subtly wrong would silently shift rows into the neighbouring day,
  so the old implementation stays in the file as the reference the fast path is pinned to.

New tests should stay backend-free: exercise the pure functions and Codable models, don't spin
up `APIClient` network calls.


## Shared spending (reimbursements)

`Views/Reimbursements/ReimbursementsView.swift`, reached from More. Three flows, matching web
and Android: the split toggle on the transaction form, the who-owes-whom list with an inline
settle sheet, and "someone paid for me" (which has **no account picker**, because no account of
yours moved — that is the whole point of it).

A `Counterparty` (`Models.swift`) is a first-class, reusable, renameable row scoped to the
household — `id` + `name` — not a free-text string. Every place that used to type a name now
picks from a `GET /cashflow/counterparties/household/{id}` list, with an inline "+ New Person"
affordance (mirrors the existing "+ New Category" pattern) that `POST`s a new one and selects it
immediately. `TransactionFormView`, `SpendOnYourBehalfFormView` and the transaction form's split
section all fetch/receive the list the same way `categories` already was — passed in from the
parent screen (`TransactionsView`/`ReimbursementsView`), not fetched per-sheet.

A transaction can be split among **multiple** named people, not just one: `TransactionResponse`
carries `splits: [TransactionSplitRow]` (`counterpartyId`/`counterpartyName`/`amount`) instead of
a single `owedBy`/`owedAmount` pair, and `TransactionCreate`/`TransactionUpdate` send
`splits: [TransactionSplitInput]?` (`counterpartyId`/`amount`). `Support/Reimbursements.swift`'s
`assessSplit(amount:entries:)` takes a list of `SplitEntry` and rejects the whole split if any
entry is incomplete, if the same counterparty appears twice, or if the combined total exceeds
the bill; `evenSplitRemainder` divides what's left of the bill evenly across the rows that
weren't given an explicit amount (cashshare-telegram's `/add` semantics — some people get an
explicit share, everyone else splits the rest equally). `TransactionFormView`'s split section is
a list of person-picker + amount rows with "+ Add Person", inline "+ New Person", and
"Split Remainder Evenly".

Rules worth not re-deriving:

- The amount field is never reduced by the split. The whole sum left the account, and showing
  the user's share instead would contradict their bank. `TransactionRow` puts the combined owed
  amount underneath in orange — the single person's name for one split, "split with A, B, …" for
  more than one; web and Android do the same.
- `Reimbursements.countsAsSpending` filters `expenseTransactions`, keeping both repayments and
  **transfers** out of Top Categories. Without it the card reads "Reimbursement · 100%"; the
  transfer half is the older bug — this was the one rollup that never applied the
  transfers-aren't-spending rule the backend and `HistoryGroups` both use. Pass the real
  `transferId != nil`, never a literal.
- `TransactionUpdate.splits` is a plain `[TransactionSplitInput]?`, not a tri-state wrapper:
  omit to leave the recorded split alone, send `[]` to clear it, send a populated array to
  replace it wholesale. A plain optional array already has an unambiguous empty state, so an
  unrelated description edit still can't silently drop a split — there is just no longer a
  hand-rolled enum needed to get that right.
- The split section only renders for `.expense`; income has no counterparty.
- `QuickAddView` deliberately has **no** split support — a separate, later pass.
