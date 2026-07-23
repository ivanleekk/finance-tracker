# iOS App — Agent Instructions

Native SwiftUI iOS app for the Finance Tracker backend. Same FastAPI backend as web/mobile; independent codebase (no shared package).

## Stack & Layout

- **Swift / SwiftUI**, iOS 17 minimum (uses `@Observable`, Swift Charts, `NavigationStack`, `ContentUnavailableView`).
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
  Support/AppTheme.swift     # Palette + AppTheme resolved from user's saved color names
  Support/ThemePalettes.swift# GENERATED sRGB scales from the web's Tailwind palette — regenerate, don't hand-edit
  Views/                     # Tab bar (5): Dashboard, Accounts, Portfolio, Transactions, More (+ Auth)
                             #   Accounts/  = the Accounts tab (AccountsListView, wrapped in a NavigationStack by
                             #     MainTabView; also pushed from Dashboard rows) + account create/edit
                             #     (AccountFormView), manual balance entry (AddBalanceView, POST /accounts/balances),
                             #     account detail chart/history. Dashboard's "See All" switches to this tab.
                             #   Goals are NOT a tab — a "goal" is a sub-portfolio with a target, shown per
                             #     sub-portfolio inside the Portfolio tab (GoalProgressRow, tap to edit via
                             #     GoalTargetEditView → PATCH /portfolio/subportfolios/{id}). Goals/GoalsView.swift
                             #     holds those components (the old standalone GoalsView tab was removed).
                             #   QuickAdd/  = the command bar (QuickAddView), an options-first quick-add opened by
                             #     pulling down ANY main List (`.pullDownToQuickAdd` repurposes pull-to-refresh via
                             #     QuickAddStore). Pick a mode (expense/income/transfer/trade/dividend/balance),
                             #     fill fields, Log; on submit it bumps QuickAddStore.reloadToken so open screens
                             #     reload. Presented from MainTabView; store lives in the environment (app root).
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
- Private ownership (`owner_user_id != nil`) is rendered with a lock icon; the server already filters out other members' private data.
- API base URL: `http://localhost:8000` by default (simulator → Mac). Overridable at runtime in the More tab (stored in `UserDefaults` key `api_base_url`) for physical devices. ATS is opened for local networking only (`NSAllowsLocalNetworking`).
- **Theming** mirrors the web ThemeContext: the user's `primary_color`/`secondary_color`/`base_color` names (UserResponse) resolve to Tailwind color scales in `ThemePalettes.swift`, which is *generated* from `frontend/node_modules/tailwindcss/theme.css` (oklch → sRGB) — if the web palette choices change, regenerate it with `python3 ios/scripts/gen_palettes.py`. `SessionStore.theme` exposes the resolved `AppTheme`; the root view applies `.tint(theme.primary.accent)` (shade 600 light / 400 dark) and `preferredColorScheme` from `theme_mode`. Charts and gradient accents pull `session.theme` directly. The base palette is persisted for parity but (like the web today) not painted onto backgrounds. Appearance is editable in the More tab via `PUT /users` partial updates.

## Build & Run

```sh
cd ios
xcodegen generate          # after any file add/remove or project.yml change
open FinanceTracker.xcodeproj
```

CLI build: `xcodebuild -project FinanceTracker.xcodeproj -scheme FinanceTracker -destination 'generic/platform=iOS Simulator' build`

Backend must be running (`docker compose up` at repo root).
