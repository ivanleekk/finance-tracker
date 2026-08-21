# Project AI Agent Instructions

This document provides a high-level overview and instructions for AI agents working across the entire Finance Tracker project.

## 1. Project Overview

- **Goal:** A modern finance tracker for young adults to plan life milestones and visualize long-term goal progress.
- **Architecture:** Monorepo with a FastAPI backend and a React/TypeScript frontend.
- **Deployment:** Containerized using Docker Compose.

## 2. Core Tech Stack

- **Backend:** Python 3.14, FastAPI, SQLAlchemy, Alembic, Polars, uv.
- **Frontend (web):** React 19, TypeScript, Vite 8, Tailwind CSS 4, pnpm.
- **iOS:** Swift / SwiftUI, XcodeGen.
- **Android:** Kotlin / Jetpack Compose (Material 3), Gradle.
- **Mobile (legacy):** Expo / React Native, TypeScript — frozen.
- **Database:** PostgreSQL 18.

## 3. Directory Structure

- `backend/`: FastAPI application, database models, migrations, and tests.
- `frontend/`: React (web) application, UI components, and assets.
- `ios/`: Native SwiftUI app — same backend, independent codebase. See `ios/AGENTS.md`.
- `android/`: Native Jetpack Compose app — same backend, independent codebase. See `android/AGENTS.md`.
- `mobile/`: Expo / React Native application - same backend, independent codebase (no shared package; small utilities like the ⌘K/quick-add parser are intentionally duplicated between `frontend/src/lib/commandParser.ts` and `mobile/src/lib/commandParser.ts` - keep them in sync by hand when the parsing rules change). **Frozen as of 2026-07-26** — `ios/` and `android/` are the active mobile clients; see `mobile/AGENTS.md` for what that means before touching this directory.
- **Native-client parity:** `ios/` and `android/` are deliberate ports of each other, down to the
  shared judgement calls (goal projection, budget tone, growth-chart binning, the
  transactions-list group totals, the Private/Household/Blended rules, the pull-to-Quick-Add
  gesture, the Top-Categories period window). A behaviour change to one of
  those rules is a change to *three* codebases — `frontend/src/lib/`, `ios/FinanceTracker/Support/`,
  and `android/.../logic/` — plus the unit tests each keeps over it. If they disagree, that's a
  bug in one of them, not a platform difference.
- **Nonsense numbers are reported as absent, never as numbers.** A recurring judgement call across
  all three clients: `periodChange` returns no percentage when the opening balance is under 1% of
  the closing one, `monthsCovered` renders "Not enough data" rather than "∞", and `projectGoal`
  reports **no ETA** past `MAX_PROJECTABLE_MONTHS` (1200 = 100 years) instead of a date. That last
  one is also a crash fix: a near-zero pace against a large target yields a months count in the
  millions, which traps `Int(_:)` on iOS, throws `DateTimeException` from `plusMonths` on Android,
  and renders "QNaN 'aN" on web. Keep the cap identical in `frontend/src/lib/goals.ts`,
  `ios/.../GoalProjection.swift` and `android/.../logic/GoalProjection.kt`.
- `docker-compose.yml`: Infrastructure orchestration (backend + web frontend only; mobile runs via `expo start`).
- `docker-compose.prod.yml` + `deploy/` + `DEPLOYMENT.md`: Fully dockerized VPS production stack (Caddy auto-HTTPS proxy, Postgres, cron container for the daily snapshot job, nightly pg_dump backups). The old Cloud Run flow (`cloudbuild.yaml`) is deprecated.

## 4a. Private vs. Shared Ownership

- `FinancialAccount.owner_user_id` and `SubPortfolio.owner_user_id` are nullable: `NULL` means shared with the household, a user id means private to that user. This is enforced server-side (`verify_private_owner_visibility` in `backend/src/auth.py`) as well as filtered client-side (`isVisibleInViewMode` in both frontends' `lib/ViewModeContext.tsx`).
- **List endpoints need the predicate form, not the single-row guard.** `verify_private_owner_visibility` checks one row and cannot protect a query that returns many, so an endpoint filtering on `household_id` alone returns every other member's private rows. Use `visible_owner_filter` / `visible_account_ids` / `visible_sub_portfolio_ids` (all in `auth.py`) for anything returning a collection — the household transactions, trades, dividends, snapshots and timeseries endpoints each leaked this way until `tests/test_private_list_scoping.py` pinned them. Client-side filtering is not a substitute: the native clients gate private data behind a biometric vault lock, which means nothing if the API serves the same rows to any member.
- The Private/Household/Blended 3-way switch (or the mobile equivalent) only renders once a household has a real second person - a member beyond the owner, or a pending invite. Every user technically has their own household (created during onboarding), so household _count_ alone is not the right signal; see `ViewModeContext`'s `hasSecondPerson` check.
- Household invites (`HouseholdInvite` model) are email-based and auto-accept into a real `HouseholdMember` on signup or login for a matching email (`resolve_pending_invites` in `backend/src/routers/users.py`).

## 4. Cross-Cutting Concerns

- **Authentication:** JWT-based authentication via HTTP-only cookies. The React Router v7 SSR frontend must manually extract and forward cookies from the incoming browser request to the backend during server-side `loader` and `action` execution.
- **API Communication:** Frontend communicates with backend via REST API. Client-side fetches use `http://localhost:8000`, but Server-Side fetches (in loaders/actions) MUST use the internal Docker network `http://backend:8000` (handled by `getApiUrl` utility).
- **Data Consistency:** Ensure that frontend models/types stay in sync with backend Pydantic schemas (`backend/src/schemas.py`).
- **Data Fetching Paradigm:** The frontend strictly uses React Router v7 SSR paradigms (Loaders and Actions). Do not use `useEffect` for data fetching or mutations.
- **Development Workflow:**
    - Backend uses `uv` for dependency management.
    - Frontend uses `pnpm` for dependency management.
    - Docker is used for local development and orchestration.
- Always use `alembic` for schema changes.
- Run `uv run alembic revision --autogenerate -m "description"` after modifying `models.py`. ALWAYS generate migrations via this native CLI — never hand-write a migration file from scratch. Hand-coding invites drift from the autogenerate diff (missed constraints, wrong `op.` ordering, forgotten downgrade) that the CLI gets right by construction; if the autogenerate output needs tweaking (e.g. data backfills, renamed-column detection), edit the CLI-generated file rather than authoring one by hand.
- **Multi-Currency Reporting**: The system standardizes all financial reporting (Dashboard, Portfolio, Net Worth) to the household's `base_currency`.
    - Backend models (`AccountBalance`, `PortfolioSnapshot`) store a `home_currency` equivalent calculated at the time of the record.
    - The `snapshot_engine.py` uses `yfinance` to fetch historical exchange rates for conversion.
    - Frontend components should prioritize displaying these converted values for aggregate views, while potentially showing native currency values for individual account details.
- **Editing an asset's identity** (`PUT /portfolio/assets/{id}`, `backend/src/services/asset_service.py`): a ticker created with the wrong currency (a `.SI` listing entered as USD) misvalues every snapshot it appears in, so the correction is not a plain column update. `market_prices` is keyed by **ticker**, not asset id: a rename carries a manually-priced asset's recorded prices across, and *drops* a market-priced one's (they belong to the old symbol; the engine refetches). A currency change never discards prices — the closes were always quoted in the listing's real currency, only the label was wrong; discarding them would blank valuations until the next fetch. Either change then replays snapshots for **every** holding household from its first trade in that asset, since `snapshot_engine` converts by the asset's currency and the daily FX rate (not the rate recorded on each trade), which is what makes the correction possible at all. Trades keep their own `exchange_rate` — that's the rate at which money actually moved. Pseudo-assets (`cash`, `linked_account`) are rejected, a ticker collision is a 409, and editing an asset only *another* household holds is a 403. All three clients expose it from the holdings list (web: an Edit button per row; iOS: swipe-to-Edit plus the detail-row menu; Android: a pencil in the row) and reload afterwards rather than patching their copy.

- **Sub-Portfolio Cash**: Uninvested cash inside a sub-portfolio is modeled as a pseudo-asset (`Asset.type == "cash"`, ticker `CASH.<CUR>`, always priced at 1.0 in its own currency — see `CASH_ASSET_TYPE` in `backend/src/models.py`). Deposits/withdrawals are buy/sell trades created via `POST /portfolio/subportfolios/{id}/cash`, so they flow through the normal transaction, balance, snapshot, and performance pipelines. Cash assets are excluded from yfinance price and dividend lookups. Shared helpers live in `backend/src/services/cash_service.py`.
    - **Settle from cash**: `TradeCreate.settle_from_cash` (used by `POST /portfolio/trades`) settles a stock buy/sell against a sub-portfolio's own cash instead of a funding-account transaction. It creates a companion trade of the cash pseudo-asset moving the opposite direction and links the pair via `Trade.settlement_trade_id` (self-referential FK). Neither leg gets a `Transaction` — no real money crosses a household account. Buys are rejected with 400 if cash is insufficient; editing/deleting a cash-settled trade keeps its companion in sync (see `settle_trade_from_cash` in `cash_service.py` and `execute_trade`/`update_trade`/`delete_trade` in `routers/portfolio.py`).
    - **Earmarked accounts** (`FinancialAccount.sub_portfolio_id`, #252): links a *real* household account to a sub-portfolio for money that funds a goal but can't be moved into the portfolio — Singapore CPF OA counting towards housing being the motivating case. Distinct from sub-portfolio cash, which moves real money out of an account; this only *references* it, so the balance counts once towards net worth (`summarizeAccounts` reads account balances only, never snapshots) **and** towards the goal. Implemented by giving each linked account a pseudo-asset (`ACCT.<uuid>`, type `linked_account`) that `snapshot_engine` values daily at the account's own forward-filled balance, so holdings/timeseries/goal projection pick it up with no client-side maths changes. `services/linked_account_service.py` owns the pseudo-asset and the balance series; days before the account's first balance are omitted, not zero-filled, or the goal's curve opens with a phantom crash.
        - **Excluded from the return metrics on purpose**: `services/performance.py` filters `linked_account` assets out of the equity curve feeding TWR/IRR/Sharpe/Sortino/Treynor/alpha. A CPF contribution is a deposit, not investment performance, and leaving it in inflates every ratio on the Portfolio tab. Cash pseudo-assets deliberately stay in — that money really was moved into the portfolio. `tests/test_linked_accounts.py` pins this (the exclusion test fails if the filter is removed).
        - Linking is validated against the same household **and** the private-ownership rule, so an account can't be earmarked into another member's private goal. Link changes, balance entries on an earmarked account, and deletes all replay snapshots from the account's *first balance date*, not from today.
    - **Dividend cash crediting**: Auto-tracked dividends (`sync_dividends_range` in `dividend_engine.py`) no longer credit a real bank account. They credit sub-portfolio cash directly via `sync_dividend_cash_credit`, which creates/updates a buy trade of the cash pseudo-asset linked through `Dividend.cash_trade_id`. This means dividend payouts show up in the portfolio equity curve immediately (via `PortfolioSnapshot`) instead of only bumping `AccountBalance`.

- **Property, Loans & Net Worth Projection**: A household can record the asset a loan bought, not just the loan.
    - `LiquidityStatus.illiquid` is the bucket for property/vehicles/physical assets. It counts towards net worth but is deliberately excluded from "liquid now" and from the Accounts page cash chart (`cashChartAccountsOf` in `frontend/src/lib/networth.ts`) — a 500k valuation stacked on the cash chart flattens every other account.
    - Liability accounts carry optional loan terms (`original_principal`, `interest_rate_annual`, `loan_term_months`, `monthly_payment`, `loan_start_date`). With all of them set, `backend/src/services/loan_service.py` amortizes the debt; without them the account keeps its old flat manual balance. The final payment is trimmed so the schedule lands exactly on zero (a cent-rounded payment otherwise leaves a few dollars at term end).
    - `FinancialAccount.linked_account_id` is a self-FK tying a property to the loan secured against it. It may be set from either side; `GET /accounts/household/{id}/equity` resolves both directions. Links are validated against the same household **and** the private-ownership rule, so they can't leak another member's private account.
    - `GET /accounts/household/{id}/projection` walks assets and debts forward month by month (loans amortize, illiquid assets grow at `appreciation_rate_annual`, cash is held flat) and returns `net_worth_positive_date` / `debt_free_date`. Cash is held flat on purpose — inventing an income curve would make the crossover date look better than the user has reason to expect.
    - `GET /accounts/{id}/loan-schedule` returns the full amortization table; the web app loads it on demand through the `/accounts/loan-schedule/:accountId` resource route rather than with the Accounts page.
    - Adding a `LiquidityStatus` value is a cross-client change: the iOS `LiquidityStatus` enum decodes leniently (unknown values fall back to `.liquid`) and groups by `allCases`, but `mobile/src/screens/Accounts.tsx` filters by an explicit list and must be updated by hand or the accounts silently disappear.

- **Recurring Transactions, Budgets & Emergency Fund** (all under `/cashflow`):
    - **Every** `Transaction` row is created by `create_transaction` in `backend/src/services/transaction_service.py` — currency conversion (to account *and* home currency) plus `sync_transaction_to_balances` are three coupled steps, and the recurring engine must not reimplement them. `POST /cashflow/transactions` and the recurring engine both go through it. Transfers are the one exception (they write a linked pair by hand).
    - `RecurringTransaction.next_due_date` is the only state materialization needs, which is what makes `materialize_due` idempotent and able to catch up several missed periods after idle time. Occurrences are computed as "the nth occurrence from `start_date`" (`recurring_service.occurrence`), never by stepping from the previous one — stepping clamps Jan 31 → Feb 28 and then never climbs back, silently moving a rent date. `MAX_CATCHUP_PER_RUN` caps a single run.
    - The nightly job (`POST /internal/tasks/daily-snapshot`) posts due recurring transactions for **every** household before the snapshot work, including households with no portfolio activity. `POST /cashflow/recurring/household/{id}/run` is the same service exposed as a "don't wait until tomorrow" button.
    - Deleting a rule leaves the transactions it already posted (`Transaction.recurring_transaction_id` is `ON DELETE SET NULL`). Deleting a category or account still referenced by a rule returns **409 with an explanation** rather than tripping the FK into a 500 — see `delete_category`/`delete_account`.
    - Budget and runway rollups always exclude transfers (`transfer_id IS NULL`) and income. Counting a transfer between your own accounts as spending would blow every budget and wreck the burn rate.
    - The emergency fund counts only `kind == asset AND liquidity == liquid` accounts — investments, retirement and property are deliberately excluded. `months_covered` is `None` (not infinity) when there is no spending history: an undefined runway, not a reassuring one, and `frontend/src/lib/budgets.ts` renders it as "Not enough data". It is also floored at 0, because an overdrawn household has no runway rather than a negative one.
    - The **burn rate** additionally skips `models.SYSTEM_CATEGORY_NAMES` — the categories the app creates for itself (`Investment` from `execute_trade`, `Balance Adjustment` from `add_account_balance`, `Transfer` from `create_transfer`). Stock purchases are filed as `expense` under "Investment", and counting them roughly doubled the fund users were told to hold. **Budgets deliberately still count them** — capping monthly investing is a legitimate budget. Those three names are constants in `models.py`; the find-or-create sites reference them so the strings can't drift out of sync with the exclusion list.
    - `Household.emergency_fund_target_months` is set on the Budgets page. `update_household` in `routers/users.py` assigns fields **explicitly**, so any new household column must be wired in there as well as in the schema.
    - A `Budget` can span **multiple categories** via the `BudgetCategory` join table (`backend/src/models.py`), not a single `category_id` column. `BudgetCategory` denormalizes `household_id`/`owner_user_id` from the parent budget so its own unique constraint (`household_id`, `category_id`, `owner_user_id`) can still enforce "a category belongs to at most one budget per owner scope" at the DB level, the same guarantee the old column-level constraint gave. `budget_service.budget_statuses` sums spend across a budget's `category_ids`. A budget's category set is fixed at creation — `BudgetUpdate` only ever covers `amount`/`period`, matching the old behavior where category was already immutable post-creation — so changing categories means deleting and recreating the budget. `BudgetResponse.category_ids` / `BudgetStatusRow.category_ids`+`category_names` are lists in the API and in all three clients' models; each client's create form is a multi-select (checkbox list) rather than the old single-select dropdown, and each excludes categories already claimed by another budget the same way `Budgets.tsx`'s `budgetableCategories` always has.

- **Data Export & Reports** (`backend/src/routers/exports.py`):
    - `GET /exports/household/{id}/csv` returns a ZIP of denormalized CSVs (accounts, balances, transactions, trades, dividends, scheduled_dividends, holdings, goals, categories); `GET /exports/household/{id}/csv/{dataset}` returns one of them. Both filter through the private-ownership rule, so another member's private accounts/sub-portfolios never appear in an export.
    - `GET /exports/household/{id}/report` returns the aggregated `HouseholdReportResponse` (net worth from latest balances, latest-snapshot holdings, cash flow by category over `start`/`end` — default current calendar year, transfers excluded — dividends, goal progress) consumed by the web `/reports` page (`frontend/src/pages/Reports`). That page renders a print-styled "paper" sheet; **Save as PDF** is just `window.print()` plus the `@media print` rules in `frontend/src/index.css` and `print:` utility classes on the app shell/sidebar.
    - **Transactions list group totals**: the activity list buckets by day / month / year and each
      group header carries what moved inside it. The rules live in `frontend/src/lib/historyGroups.ts`,
      `ios/FinanceTracker/Support/HistoryGroups.swift` and `android/.../logic/HistoryGroups.kt` — three
      ports of one thing, each with its own unit tests. Two of those rules are deliberate: transfers
      are excluded from both sides (money between your own accounts is neither income nor spending —
      the same rule the budget/runway rollups use), and a row with no known base-currency value is
      left out of the total and flagged "partial" rather than summed at face value, which would mix
      currencies into a meaningless number.

    - Client-side file downloads go through `downloadFromApi` in `frontend/src/lib/download.ts` (axios blob + Content-Disposition filename).

## 5. Global Agent Guidelines

- **Security:** Never commit secrets or hardcode API keys. Use environment variables.
- **Consistency:** Maintain consistent naming conventions and architectural patterns across both backend and frontend.
- **Documentation:** Keep `AGENTS.md` files updated as the project evolves.
- **Testing:** Always ensure that changes are accompanied by appropriate tests (Pytest for backend, Vitest/React Testing Library for frontend).
