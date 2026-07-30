# Graph Report - .  (2026-07-28)

## Corpus Check
- 376 files · ~262,070 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 4276 nodes · 10537 edges · 271 communities (209 shown, 62 thin omitted)
- Extraction: 83% EXTRACTED · 17% INFERRED · 0% AMBIGUOUS · INFERRED: 1795 edges (avg confidence: 0.61)
- Token cost: 9,500 input · 7,200 output

## Community Hubs (Navigation)
- Backend Pydantic Schemas & Enums
- Dividend Tracking & Calendar
- Portfolio Router & Trading
- iOS Dashboard View
- Backend Auth & OAuth
- Performance Metrics Calculation
- iOS Trade Entry & Asset Forms
- Backend Portfolio Tests
- Android API Client
- iOS Response Models (Decodable)
- Backend Household & User Tests
- iOS Request Models (Encodable)
- Android Data Models
- Frontend Shared UI Components
- Backend Cashflow Router
- iOS Portfolio Analytics View
- Android Account Forms & Settings
- iOS Settings Views
- iOS Goal Detail & Projection
- Android Enums
- iOS Sub-Portfolio Detail View
- Backend Recurring Transaction Tests
- Backend Accounts Tests
- Frontend Command Bar (Quick Add)
- iOS Quick Add Flow
- iOS Accounts View
- Backend Users Router
- Backend Property & Loan Tests
- Frontend Nav & Theme Context
- Backend Cache Service
- Frontend Household Selector & Topbar
- Frontend Budget Presentation Logic
- Backend Accounts Router
- iOS Portfolio Analytics Tests
- iOS Transactions View
- iOS App Session Store
- Backend Market Data Service
- iOS View Mode Store & Tests
- iOS Budget Presentation Tests
- Mobile UI Components (Expo)
- Frontend Package.json
- iOS Networking
- Frontend Pages
- Mobile Screens
- Android Src
- iOS LoanAndRecurringDecodingTests
- iOS Views
- Android Src
- iOS Models
- Frontend Package.json
- Android Src
- Backend Test Cashflow
- Backend Routers
- iOS Views
- iOS Models
- Android Src
- Android Src
- Android Src
- Android Src
- iOS Views
- iOS Support
- iOS Views
- Mobile Screens
- Mobile Types
- Android Src
- iOS Support
- Android Src
- Backend Services
- Backend Services
- Frontend Tsconfig.app.json
- iOS GoalProjectionTests
- Backend Services
- Backend Test Budgets And Emergency Fund
- iOS Views
- Android Src
- Android Src
- iOS Views
- Backend Services
- Android Src
- Frontend Tsconfig.node.json
- iOS Views
- Android Src
- Android Src
- iOS Views
- Backend Models
- Backend Test Adversarial
- iOS Views
- Mobile App.json
- Backend Test Transfers
- Backend Test Adversarial
- Backend Test Budgets And Emergency Fund
- Backend Test Exports
- iOS Views
- Mobile Lib
- Backend Test Budgets And Emergency Fund
- Backend Services
- Backend Test Budgets And Emergency Fund
- iOS ViewModeStoreTests
- Frontend Lib
- iOS Views
- Mobile Lib
- Android Src
- Android Src
- Mobile Lib
- Backend Test Trade Cash Settlement
- Community 105
- iOS Views
- Android AGENTS
- DEPLOYMENT
- Android Src
- Backend Test Portfolio Metrics And Dividends
- iOS Views
- Android Src
- Backend Database Schema.svg
- Backend Test Subportfolio Cash
- Frontend Components
- Android Src
- iOS Support
- Mobile Package.json
- iOS MoneyDecodingTests
- Android Src
- Backend Services
- Backend Test Adversarial
- Backend Test Trades Transactions
- iOS Support
- Backend Test Adversarial
- Frontend Package.json
- Frontend Package.json
- Frontend Pages
- iOS AGENTS
- iOS Support
- iOS Views
- Mobile Package.json
- Backend AGENTS
- Android Src
- Backend Test Adversarial
- Frontend Pages
- iOS Models
- iOS Networking
- AGENTS
- Android Src
- Backend Services
- Backend Test Adversarial
- DEVELOPER GUIDE
- Frontend Package.json
- iOS Support
- iOS FormattersTests
- AGENTS
- Android Src
- Backend Test Adversarial
- iOS Models
- iOS Gen Appicon
- Android Src
- Android Src
- iOS Models
- Docker Compose.prod
- iOS Project
- iOS Views
- Backend README
- Android Src
- Android Src
- Docker Compose
- Docker Compose.override
- Mobile Package.json
- Mobile Tsconfig.json
- Android Src
- Android Src
- Android Src
- Android Gradlew
- Android Gen Palettes
- Frontend AGENTS
- iOS AGENTS
- iOS Models
- Android Src
- Frontend Assets
- Frontend Tsconfig.json
- Bolt
- Android Src
- Frontend Package.json
- Mobile Package.json
- Mobile Package.json
- Mobile Package.json
- Mobile Package.json
- Mobile Package.json
- Mobile Package.json
- Mobile Package.json
- Frontend AGENTS
- Frontend Package.json
- Frontend Package.json
- Frontend Package.json
- Frontend Package.json
- Frontend Package.json
- Frontend Package.json
- iOS AGENTS
- iOS AGENTS
- iOS AGENTS
- Mobile Package.json
- Mobile Package.json
- Mobile Package.json
- Mobile Package.json
- Mobile Package.json
- Mobile Package.json
- Mobile Package.json
- Mobile Package.json
- Mobile Package.json
- Backend Database Schema.svg
- Frontend Favicon.svg
- Frontend README
- Frontend Assets
- Frontend Assets
- iOS AGENTS
- iOS AGENTS
- iOS AGENTS
- iOS AGENTS
- iOS AGENTS
- iOS Assets.xcassets
- Bolt
- Mobile AGENTS
- Mobile Android Icon Background.png
- Mobile Android Icon Foreground.png
- Mobile Android Icon Monochrome.png
- Mobile Favicon.png
- Mobile Icon.png
- Mobile Splash Icon.png
- Backend Pyproject.toml

## God Nodes (most connected - your core abstractions)
1. `User` - 155 edges
2. `TradeType` - 109 edges
3. `LiquidityStatus` - 105 edges
4. `TaxTreatment` - 105 edges
5. `AccountKind` - 105 edges
6. `TransactionType` - 105 edges
7. `HouseholdRoleType` - 105 edges
8. `ThemeMode` - 105 edges
9. `HouseholdInviteStatus` - 105 edges
10. `SplitMode` - 105 edges

## Surprising Connections (you probably didn't know these)
- `ViewModeViewModel (Private/Household/Blended)` --semantically_similar_to--> `Private/Household/Blended View Mode Switch`  [INFERRED] [semantically similar]
  android/AGENTS.md → AGENTS.md
- `Analytics Engine (snapshot_engine.py)` --semantically_similar_to--> `Multi-Currency Reporting Standardization`  [INFERRED] [semantically similar]
  backend/README.md → AGENTS.md
- `Multi-Currency Engine (Developer Guide)` --semantically_similar_to--> `Multi-Currency Reporting Standardization`  [INFERRED] [semantically similar]
  DEVELOPER_GUIDE.md → AGENTS.md
- `BudgetPresentation.kt (port of budgets.ts / BudgetPresentation.swift)` --semantically_similar_to--> `Recurring Transactions, Budgets & Emergency Fund`  [INFERRED] [semantically similar]
  android/AGENTS.md → AGENTS.md
- `Alembic Migration Workflow (Backend)` --semantically_similar_to--> `Alembic Autogenerate-Only Migration Workflow`  [INFERRED] [semantically similar]
  backend/AGENTS.md → AGENTS.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Cross-Client Parity Rules Shared by ios/android/frontend** — agents_native_client_parity, android_agents_growth_charts, android_agents_budget_presentation, android_agents_view_mode_viewmodel [INFERRED 0.85]
- **Migration Flow from GCP Cloud Run to VPS Docker Compose** — deployment_vps_docker_compose_stack, deployment_data_migration_gcloud_to_vps, cloudbuild_gcp_cloud_run_deployment, deployment_gcloud_decommission [EXTRACTED 0.90]
- **Multi-Currency Engine Described Across Docs** — agents_multi_currency_reporting, developer_guide_multi_currency_engine, backend_readme_analytics_engine [INFERRED 0.85]
- **Docker Compose Dev/Override/Prod Layering** — docker_compose_backend_service, docker_compose_override_dev_bind_mounts, docker_compose_prod_backend_service [INFERRED 0.85]
- **iOS Swift Ports of Web Client Logic** — ios_agents_goalprojection_swift, ios_agents_budgetpresentation_swift, ios_agents_themepalettes_swift, frontend_src_lib_goals_goals, frontend_src_lib_budgets_budgets [INFERRED 0.85]
- **iOS QuickAdd Pull-to-Open Flow** — ios_agents_quickaddview, ios_agents_quickaddpull_gesture, ios_agents_quickaddstore [EXTRACTED 1.00]

## Communities (271 total, 62 thin omitted)

### Community 0 - "Backend Pydantic Schemas & Enums"
Cohesion: 0.18
Nodes (123): AccountKind, BudgetPeriod, HouseholdInviteStatus, HouseholdRoleType, LiquidityStatus, RecurrenceFrequency, SplitMode, TaxTreatment (+115 more)

### Community 1 - "Dividend Tracking & Calendar"
Cohesion: 0.05
Nodes (69): detectCadenceDays(), DividendCalendarMonth, DividendSummary, HoldingDividendSummary, summarizeDividends(), getActiveHouseholdId(), getSSRContext(), parseCookies() (+61 more)

### Community 2 - "Portfolio Router & Trading"
Cohesion: 0.09
Nodes (78): AssetCreate, User, create_asset(), create_portfolio_snapshot(), create_scheduled_dividends(), create_subportfolio(), delete_asset(), delete_dividend() (+70 more)

### Community 3 - "iOS Dashboard View"
Cohesion: 0.04
Nodes (59): AccountRow, .body, BreakdownCell, .body, DashboardView, .accountsById, .assetsById, .baseCurrency (+51 more)

### Community 4 - "Backend Auth & OAuth"
Cohesion: 0.05
Nodes (50): create_refresh_token(), get_current_user(), OAuth2PasswordBearerWithCookie, Request, Session, UUID, verify_password(), get_db() (+42 more)

### Community 5 - "Performance Metrics Calculation"
Cohesion: 0.06
Nodes (59): calculate_performance_metrics(), _calculate_xirr(), _empty_metrics(), fetch_rf_and_benchmark_rows(), date, PerformanceMetrics, Session, UUID (+51 more)

### Community 6 - "iOS Trade Entry & Asset Forms"
Cohesion: 0.05
Nodes (50): AssetCreateView, .body, .canSave, CashMoveFormView, .amount, .body, .canSave, .fundingCurrency (+42 more)

### Community 7 - "Backend Portfolio Tests"
Cohesion: 0.05
Nodes (33): Asset, PortfolioSnapshot, SubPortfolio, Trade, auth_headers(), test_manual_sync_endpoint(), other_auth_headers(), other_household() (+25 more)

### Community 8 - "Android API Client"
Cohesion: 0.07
Nodes (33): Api, ApiException, B, Context, SharedPreferences, T, SessionExpiredException, _NonFiniteJSONToken (+25 more)

### Community 9 - "iOS Response Models (Decodable)"
Cohesion: 0.10
Nodes (54): Codable, Hashable, Identifiable, AccountResponse, .hasLoanTerms, .isLiability, AmortizationRow, .id (+46 more)

### Community 10 - "Backend Household & User Tests"
Cohesion: 0.05
Nodes (23): create_access_token(), auth_headers(), fixture, test_account(), test_category(), test_household(), test_user(), household() (+15 more)

### Community 11 - "iOS Request Models (Encodable)"
Cohesion: 0.11
Nodes (43): Encodable, AccountCreate, AccountUpdate, AssetCreate, BalanceCreate, BudgetCreate, BudgetUpdate, CategoryCreate (+35 more)

### Community 12 - "Android Data Models"
Cohesion: 0.04
Nodes (49): AccountResponse, AccountUpdate, AmortizationRow, AssetCreate, AssetResponse, BalanceResponse, BudgetResponse, BudgetStatusResponse (+41 more)

### Community 13 - "Frontend Shared UI Components"
Cohesion: 0.12
Nodes (29): BrandMark(), SidebarButton(), SidebarButtonProps, Badge(), BadgeProps, Button, ButtonProps, Card (+21 more)

### Community 14 - "Backend Cashflow Router"
Cohesion: 0.12
Nodes (47): Verifies if the current user has access to the specified household., verify_household_access(), create_budget(), create_category(), create_recurring_transaction(), create_transfer(), delete_budget(), delete_category() (+39 more)

### Community 15 - "iOS Portfolio Analytics View"
Cohesion: 0.06
Nodes (44): FXSlice, AllocationCard, .body, GrowthChart, GrowthRangePicker, .body, HoldingRow, .body (+36 more)

### Community 16 - "Android Account Forms & Settings"
Cohesion: 0.13
Nodes (36): UserUpdate, AccountDetailScreen(), AccountFormScreen(), AddBalanceScreen(), SectionCard(), DateField(), DropdownField(), FormField() (+28 more)

### Community 17 - "iOS Settings Views"
Cohesion: 0.09
Nodes (38): .body, Content, CurrencyPicker, .body, DefaultAccountPicker, .body, HouseholdSettingsView, .body (+30 more)

### Community 18 - "iOS Goal Detail & Projection"
Cohesion: 0.07
Nodes (39): Accessory, GoalProjection, ContributionRow, DetailCard, .body, FundedRow, GoalDetailView, .accent (+31 more)

### Community 19 - "Android Enums"
Cohesion: 0.05
Nodes (43): AccountKind, ASSET, LIABILITY, BudgetPeriod, MONTHLY, YEARLY, BudgetPeriodSerializer, from() (+35 more)

### Community 20 - "iOS Sub-Portfolio Detail View"
Cohesion: 0.07
Nodes (39): DetailedHoldingRow, .body, .costBasis, .currency, .gain, .gainPercent, .isCash, .isForeign (+31 more)

### Community 21 - "Backend Recurring Transaction Tests"
Cohesion: 0.08
Nodes (35): household(), owner(), owner_headers(), fixture, parametrize, Recurring transactions: the rules that stop a user retyping rent and salary…, The FK would otherwise surface as a bare 500. The user should be told what is…, A rule anchored on the 31st must clamp into February and then climb back — the… (+27 more)

### Community 22 - "Backend Accounts Tests"
Cohesion: 0.08
Nodes (32): AccountBalance, FinancialAccount, Household, auth_headers(), other_auth_headers(), other_household(), other_user(), fixture (+24 more)

### Community 23 - "Frontend Command Bar (Quick Add)"
Cohesion: 0.10
Nodes (34): BalanceResolution, BalanceView(), CommandBar(), DividendResolution, DividendView(), ExpenseView(), fmt(), fmtA() (+26 more)

### Community 24 - "iOS Quick Add Flow"
Cohesion: 0.08
Nodes (30): B, QuickAddView, .accent, .amount, .balanceFields, .baseCurrency, .body, .canSave (+22 more)

### Community 25 - "iOS Accounts View"
Cohesion: 0.08
Nodes (32): AccountKind, AccountDetailView, .body, .sorted, AccountFormView, .body, .canSave, .loanStartValue (+24 more)

### Community 26 - "Backend Users Router"
Cohesion: 0.14
Nodes (38): hash_password(), add_household_member(), cancel_household_invite(), create_household(), create_user(), delete_household(), delete_user(), get_all_household_members() (+30 more)

### Community 27 - "Backend Property & Loan Tests"
Cohesion: 0.09
Nodes (26): _account(), _balance(), household(), owner(), owner_headers(), fixture, parametrize, Property (illiquid) accounts, loan amortization, home equity and the forward… (+18 more)

### Community 28 - "Frontend Nav & Theme Context"
Cohesion: 0.08
Nodes (27): HIDDEN_ON, QuickAddButton(), MobileNav(), NAV_ITEMS, NavContent(), CommandBarTrigger(), AuthContext, AuthContextType (+19 more)

### Community 29 - "Backend Cache Service"
Cohesion: 0.13
Nodes (34): cache_get(), cache_set(), invalidate_household(), invalidate_prefix(), Any, Lightweight in-process response cache for expensive, read-heavy computations…, Drop every cached entry whose key starts with `prefix`., Drop every cached response scoped to this household. Called at the write… (+26 more)

### Community 30 - "Frontend Household Selector & Topbar"
Cohesion: 0.12
Nodes (27): HouseholdSelector(), MODES, TopBar(), ViewModeSwitch(), cn(), Dialog(), DialogFooter(), DialogHeader() (+19 more)

### Community 31 - "Frontend Budget Presentation Logic"
Cohesion: 0.11
Nodes (30): budgetBarPercent(), budgetTone, FREQUENCY_LABELS, frequencyLabel(), groupOccurrencesByMonth(), netUpcoming(), periodElapsedPercent(), runwayLabel() (+22 more)

### Community 32 - "Backend Accounts Router"
Cohesion: 0.15
Nodes (35): AccountCreate, AccountUpdate, Raises 403 if the resource is privately owned by someone other than the current…, verify_private_owner_visibility(), add_account_balance(), create_account(), delete_account(), delete_account_balance() (+27 more)

### Community 33 - "iOS Portfolio Analytics Tests"
Cohesion: 0.13
Nodes (12): GoalHistoryPoint, .id, equityCurve(), Date, T, PortfolioAnalyticsTests, AssetResponse, Calendar (+4 more)

### Community 34 - "iOS Transactions View"
Cohesion: 0.11
Nodes (28): AccountResponse, Bool, CategoryResponse, Date, IndexSet, Set, String, TimeInterval (+20 more)

### Community 35 - "iOS App Session Store"
Cohesion: 0.08
Nodes (22): App, FinanceTrackerApp, .body, Phase, authenticated, loading, unauthenticated, SessionStore (+14 more)

### Community 36 - "Backend Market Data Service"
Cohesion: 0.12
Nodes (32): ExchangeRate, MarketPrice, fetch_and_cache_exchange_rates(), fetch_and_cache_exchange_rates_range(), fetch_and_cache_market_prices(), fetch_and_cache_market_prices_range(), fetch_and_cache_treasury_rates(), date (+24 more)

### Community 37 - "iOS View Mode Store & Tests"
Cohesion: 0.12
Nodes (12): Bool, Int, String, ViewMode, ViewModeStore, .effectiveMode, .isVaultLocked, .vaultLockActive (+4 more)

### Community 38 - "iOS Budget Presentation Tests"
Cohesion: 0.10
Nodes (10): BudgetPresentationTests, Bool, BudgetStatusRow, EmergencyFundResponse, Int, RecurrenceFrequency, RecurringTransactionResponse, String (+2 more)

### Community 39 - "Mobile UI Components (Expo)"
Cohesion: 0.13
Nodes (26): Badge(), Card(), HeroCard(), ScreenHeader(), StatTile(), styles, Toggle(), Dividends() (+18 more)

### Community 40 - "Frontend Package.json"
Cohesion: 0.06
Nodes (33): @babel/core, babel-plugin-react-compiler, eslint, eslint-plugin-react-hooks, eslint-plugin-react-refresh, devDependencies, @babel/core, babel-plugin-react-compiler (+25 more)

### Community 41 - "iOS Networking"
Cohesion: 0.09
Nodes (18): Data, DateFormatter, APIError, .errorDescription, http, invalidURL, sessionExpired, DateParser (+10 more)

### Community 42 - "Frontend Pages"
Cohesion: 0.11
Nodes (27): acc(), AccountLike, AccountTotals, cashChartAccountsOf(), latestBalanceHome(), ProjectionSample, sampleProjection(), summarizeAccounts() (+19 more)

### Community 43 - "Mobile Screens"
Cohesion: 0.12
Nodes (25): PrimaryButton(), SecondaryButton(), AuthContext, AuthContextType, useAuth(), RootNavigator(), Stack, RootStackParamList (+17 more)

### Community 44 - "Android Src"
Cohesion: 0.08
Nodes (19): QuickAddViewModel, AccountsScreen(), EquityRow(), LinkedEquityRow, Haptics, rememberHaptics(), Modifier, quickAddPull() (+11 more)

### Community 45 - "iOS LoanAndRecurringDecodingTests"
Cohesion: 0.11
Nodes (7): APIClient, .baseURL, .rows, LoanAndRecurringDecodingTests, ModelDecodingTests, JSONDecoder, JSONEncoder

### Community 46 - "iOS Views"
Cohesion: 0.11
Nodes (25): EmptyBody, RecurringFormView, .amount, .body, .canSave, RecurringRuleRow, .body, .isIncome (+17 more)

### Community 47 - "Android Src"
Cohesion: 0.12
Nodes (26): BudgetCreate, BudgetUpdate, ConfirmDialog(), EmergencyFundResponse, RunwaySummary(), BudgetFormDialog(), BudgetRow(), BudgetsScreen() (+18 more)

### Community 48 - "iOS Models"
Cohesion: 0.06
Nodes (31): CaseIterable, AccountKind, asset, .id, .label, liability, TaxTreatment, .id (+23 more)

### Community 49 - "Frontend Package.json"
Cohesion: 0.06
Nodes (31): clsx, date-fns, dependencies, axios, clsx, date-fns, isbot, lucide-react (+23 more)

### Community 50 - "Android Src"
Cohesion: 0.12
Nodes (25): RecurringTransactionCreate, RecurringTransactionUpdate, AdaptiveStatGrid(), cardListItemColors(), EmptyState(), androidx, Composable, ImageVector (+17 more)

### Community 51 - "Backend Test Cashflow"
Cohesion: 0.09
Nodes (17): Transaction, auth_headers(), other_auth_headers(), other_household(), other_user(), fixture, Reassigning a transaction's category by UUID must succeed and flip the derived…, test_account() (+9 more)

### Community 52 - "Backend Routers"
Cohesion: 0.17
Nodes (25): _accounts_rows(), _balances_rows(), _categories_rows(), _dec(), _dividends_rows(), _enum_value(), export_household_dataset(), export_household_zip() (+17 more)

### Community 53 - "iOS Views"
Cohesion: 0.12
Nodes (24): BudgetStatusResponse, BudgetTone, BudgetFormView, .amount, .body, BudgetRowView, .body, .detailLine (+16 more)

### Community 54 - "iOS Models"
Cohesion: 0.09
Nodes (19): BudgetPeriod, .id, .label, monthly, yearly, KeyedDecodingContainer, LiquidityStatus, .id (+11 more)

### Community 55 - "Android Src"
Cohesion: 0.13
Nodes (7): BudgetStatusRow, EmergencyFundResponse, RecurringTransactionResponse, UpcomingOccurrence, BudgetPresentationTest, RecurrenceFrequency, TransactionType

### Community 56 - "Android Src"
Cohesion: 0.10
Nodes (13): HouseholdCreate, HouseholdInviteCreate, HouseholdUpdate, UserCreate, AndroidViewModel, AppTheme, HouseholdResponse, UserUpdate (+5 more)

### Community 57 - "Android Src"
Cohesion: 0.10
Nodes (17): BudgetPresentation, BudgetTone, AT_RISK, OK, OVER, BudgetStatusRow, EmergencyFundResponse, RecurringTransactionResponse (+9 more)

### Community 58 - "Android Src"
Cohesion: 0.19
Nodes (7): GoalProjection, GoalHistoryPoint, T, projectGoal(), valueHistory(), GoalProjectionTest, GoalHistoryPoint

### Community 59 - "iOS Views"
Cohesion: 0.09
Nodes (16): Charts, RootView, .body, Palette, String, ThemePalettes, AppTab, accounts (+8 more)

### Community 60 - "iOS Support"
Cohesion: 0.09
Nodes (17): BudgetPresentation, BudgetTone, atRisk, .label, ok, over, RunwayTone, critical (+9 more)

### Community 61 - "iOS Views"
Cohesion: 0.09
Nodes (20): EquityRow, .body, .ownedFraction, LoanScheduleView, .body, AccountResponse, LinkedEquityRow, String (+12 more)

### Community 62 - "Mobile Screens"
Cohesion: 0.14
Nodes (23): useHousehold(), isVisibleInViewMode(), useViewMode(), ViewModeContext, ViewModeContextType, ViewModeProvider(), Accounts(), fmtMoney() (+15 more)

### Community 63 - "Mobile Types"
Cohesion: 0.08
Nodes (25): fmtMoney(), GoalDetail(), Props, styles, AccountAccessResponse, AccountRoleType, CountryResponse, CurrencyResponse (+17 more)

### Community 64 - "Android Src"
Cohesion: 0.11
Nodes (24): AccountRow(), BreakdownCell(), buildNetWorthSeries(), DashboardScreen(), HoldingRow(), KeyValue(), AccountResponse, BalanceResponse (+16 more)

### Community 65 - "iOS Support"
Cohesion: 0.10
Nodes (21): AllocationSlice, .id, .label, allocationSlices(), bin(), fxExposure(), GrowthBin, daily (+13 more)

### Community 67 - "Backend Services"
Cohesion: 0.14
Nodes (23): A transaction the household knows is coming again: salary, rent, a…, RecurringTransaction, post, Session, scheduled_snapshot_job(), _days(), _index_of(), materialize_due() (+15 more)

### Community 68 - "Backend Services"
Cohesion: 0.18
Nodes (23): amortization_schedule(), AmortizationRow, _dec(), _latest_balance_home(), loan_terms_for(), LoanTerms, _money(), monthly_payment_for() (+15 more)

### Community 69 - "Frontend Tsconfig.app.json"
Cohesion: 0.08
Nodes (23): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection, moduleResolution (+15 more)

### Community 70 - "iOS GoalProjectionTests"
Cohesion: 0.21
Nodes (5): projectGoal(), Date, GoalProjectionTests, GoalHistoryPoint, TimeInterval

### Community 71 - "Backend Services"
Cohesion: 0.20
Nodes (22): budget_statuses(), BudgetStatus, _dec(), emergency_fund_status(), EmergencyFundStatus, _money(), _one_day(), period_bounds() (+14 more)

### Community 72 - "Backend Test Budgets And Emergency Fund"
Cohesion: 0.11
Nodes (14): account(), dining(), household(), owner(), owner_headers(), fixture, parametrize, Budgets and the emergency-fund runway. The two things that must not go wrong:… (+6 more)

### Community 73 - "iOS Views"
Cohesion: 0.10
Nodes (20): Field, email, name, password, LoginView, .body, .brandGradient, .canSubmit (+12 more)

### Community 74 - "Android Src"
Cohesion: 0.12
Nodes (12): AndroidViewModel, FragmentActivity, ViewMode, ViewModeViewModel, AutoUnlockVault(), BackButton(), FragmentActivity, rememberFragmentActivity() (+4 more)

### Community 75 - "Android Src"
Cohesion: 0.18
Nodes (19): BarChart(), chartAccent(), DonutChart(), drawDonut(), AllocationSlice, androidx, Color, GoalHistoryPoint (+11 more)

### Community 76 - "iOS Views"
Cohesion: 0.14
Nodes (17): AnyView, Configuration, AnyButtonStyle, FlowChips, .body, OnboardingView, .defaultHouseholdName, .stepOne (+9 more)

### Community 77 - "Backend Services"
Cohesion: 0.22
Nodes (20): Dividend, materialize_scheduled_dividends(), date, Session, UUID, Attribute a dividend to the account the asset was bought through in this sub-…, Automatically records dividends for every asset held by the household whose ex-…, Turn due ScheduledDividend rows (payment date reached, not yet materialized)… (+12 more)

### Community 78 - "Android Src"
Cohesion: 0.18
Nodes (10): apiDateOnly(), DateParser, InstantSerializer, Decoder, Encoder, KSerializer, MoneySerializer, OptionalInstantSerializer (+2 more)

### Community 79 - "Frontend Tsconfig.node.json"
Cohesion: 0.10
Nodes (20): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, moduleResolution, noEmit (+12 more)

### Community 80 - "iOS Views"
Cohesion: 0.15
Nodes (15): HouseholdInviteResponse, HouseholdRole, HouseholdMembersView, .body, .household, .pendingInvites, InviteMemberView, .body (+7 more)

### Community 81 - "Android Src"
Cohesion: 0.25
Nodes (3): equityCurve(), T, PortfolioAnalyticsTest

### Community 82 - "Android Src"
Cohesion: 0.10
Nodes (7): Routes, TopLevelDestination, ACCOUNTS, DASHBOARD, MORE, PORTFOLIO, TRANSACTIONS

### Community 83 - "iOS Views"
Cohesion: 0.16
Nodes (13): HouseholdReportResponse, ExportFile, ReportsView, .baseCurrency, .body, ShareSheet, Any, Context (+5 more)

### Community 84 - "Backend Models"
Cohesion: 0.14
Nodes (16): Run migrations in 'offline' mode. This configures the context with just a URL…, Run migrations in 'online' mode. In this scenario we need to create an Engine…, run_migrations_offline(), run_migrations_online(), AccountAccess, AccountRoleType, Budget, BudgetCategory (+8 more)

### Community 85 - "Backend Test Adversarial"
Cohesion: 0.19
Nodes (7): parametrize, Decimal price of 'NaN' string must not slip through., 1e400 overflows a float to +inf; must be rejected, not stored. Sent as a raw…, POST a body containing the non-standard JSON tokens NaN/Infinity that a real…, raw_post(), TestNumericPoisoning, _trade_body()

### Community 86 - "iOS Views"
Cohesion: 0.14
Nodes (15): DividendsView, .baseCurrency, .body, .byMonth, .total, RecordPriceView, .body, .canSave (+7 more)

### Community 87 - "Mobile App.json"
Cohesion: 0.11
Nodes (18): backgroundColor, backgroundImage, foregroundImage, monochromeImage, adaptiveIcon, predictiveBackGestureEnabled, expo, android (+10 more)

### Community 88 - "Backend Test Transfers"
Cohesion: 0.17
Nodes (17): HouseholdMember, household(), test_cannot_link_to_another_members_private_account(), _account(), _balance(), headers(), household(), owner() (+9 more)

### Community 89 - "Backend Test Adversarial"
Cohesion: 0.18
Nodes (7): make_account(), make_asset(), make_category(), make_subportfolio(), Bob owns a household; he tries to post a trade in his household but pointing…, TestCrossTenantIsolation, TestPrivateOwnership

### Community 90 - "Backend Test Budgets And Emergency Fund"
Cohesion: 0.18
Nodes (18): _budget(), _expense(), `categories` may be a single Category or a list/tuple of them., A transfer between your own accounts is not spending., Guards through the new join table the same way it did through the old column., The exclusion is runway-only. Budgeting "Investment" to cap how much goes into…, test_another_members_private_account_spend_is_excluded(), test_budget_status_endpoint() (+10 more)

### Community 91 - "Backend Test Exports"
Cohesion: 0.18
Nodes (11): _auth(), member_auth_headers(), member_user(), outsider_auth_headers(), outsider_user(), owner_auth_headers(), owner_user(), fixture (+3 more)

### Community 92 - "iOS Views"
Cohesion: 0.16
Nodes (10): QuickAddStore, QuickAddPull, .indicator, .progress, QuickAddPullSensor, .body, CGFloat, Content (+2 more)

### Community 93 - "Mobile Lib"
Cohesion: 0.18
Nodes (14): chipStyles, fmt(), fmtA(), { height: SCREEN_HEIGHT }, QuickAddSheet(), styles, CATEGORY_RULES, FALLBACK_ASSETS (+6 more)

### Community 94 - "Backend Test Budgets And Emergency Fund"
Cohesion: 0.12
Nodes (17): Category, One of several requested categories already belongs to another budget., An Investment purchase four months ago must not make a household look like it…, One old, unrelated charge (e.g. an annual subscription renewal) must not…, Buying shares is filed under the app's auto-created "Investment" expense…, test_a_single_old_transaction_does_not_dilute_concentrated_recent_spending(), test_balance_adjustments_do_not_inflate_the_burn_rate(), test_create_budget_spanning_multiple_categories() (+9 more)

### Community 95 - "Backend Services"
Cohesion: 0.20
Nodes (15): propagate_balance_change(), date, Decimal, Session, UUID, Propagates a balance change forward until hitting a manual checkpoint. Includes…, Synchronizes a transaction's effect to the account_balances table. Includes…, sync_transaction_to_balances() (+7 more)

### Community 96 - "Backend Test Budgets And Emergency Fund"
Cohesion: 0.12
Nodes (17): _balance(), 12,000 cash against 2,000/month of spending is 6 months of runway., An emergency fund you must sell equities or a house to reach isn't one., An overdrawn account means no runway — "-3.7 months" is meaningless., A household that only started logging expenses last month must get that month's…, test_emergency_fund_endpoint(), test_emergency_fund_respects_a_custom_target(), test_illiquid_and_investment_accounts_are_excluded() (+9 more)

### Community 97 - "iOS ViewModeStoreTests"
Cohesion: 0.22
Nodes (8): FinanceTracker, Foundation, AppConfig, .defaultBaseURL, .isDebugBuild, Bool, URL, Testing

### Community 98 - "Frontend Lib"
Cohesion: 0.26
Nodes (10): Input, InputProps, OwnershipTag(), formatDueDate(), GoalProjection, projectGoal(), valueHistoryForGoal(), GoalDetail() (+2 more)

### Community 99 - "iOS Views"
Cohesion: 0.22
Nodes (12): CategoriesView, .body, CategoryEditView, .body, .canSave, .trimmedName, Bool, CategoryResponse (+4 more)

### Community 100 - "Mobile Lib"
Cohesion: 0.15
Nodes (12): App(), navTheme, AuthProvider(), HouseholdProvider(), QuickAddContext, QuickAddContextType, QuickAddProvider(), useQuickAdd() (+4 more)

### Community 103 - "Mobile Lib"
Cohesion: 0.17
Nodes (13): SQLAlchemy Models (backend/src/models.py), Pydantic Schemas (backend/src/schemas.py), API-Driven UX Architecture (SubPortfolio = Goal), React Router v7 SSR Architecture (Loaders/Actions/Cookies), APIClient.swift (actor, Bearer auth, 401 refresh retry), Models.swift (Codable mirrors of schemas.py), URL.appending(path:) Percent-Encoding Query-String Bug, Per-Configuration API_BASE_URL (Debug/Release) (+5 more)

### Community 104 - "Backend Test Trade Cash Settlement"
Cohesion: 0.25
Nodes (15): auth_headers(), _buy_payload(), _deposit_cash(), fixture, test_account(), test_asset(), test_buy_settled_from_cash_consumes_subportfolio_cash(), test_buy_settled_from_cash_insufficient_funds_rejected() (+7 more)

### Community 105 - "Community 105"
Cohesion: 0.17
Nodes (12): Date, .dueMonthYear, GoalProjection, Bool, Int, String, T, valueHistory() (+4 more)

### Community 106 - "iOS Views"
Cohesion: 0.17
Nodes (13): GoalFormView, .body, .canSave, .targetAmount, GoalProgressRow, .body, .progress, Bool (+5 more)

### Community 107 - "Android AGENTS"
Cohesion: 0.16
Nodes (15): Recurring Transactions, Budgets & Emergency Fund, Adaptive-by-Window-Size-Class Navigation, API Base URL Config (BuildConfig, Emulator Loopback, Debug Override), Api.url(path) Query-String Encoding Workaround, Private-Vault Biometric Lock, BudgetPresentation.kt (port of budgets.ts / BudgetPresentation.swift), Dates Are UTC Everywhere, Android App Agent Instructions (+7 more)

### Community 108 - "DEPLOYMENT"
Cohesion: 0.14
Nodes (15): Pull-Down-to-Quick-Add Gesture, Caddy Reverse Proxy (auto-HTTPS), Data Migration off Old (gcloud) Database, Nightly pg_dump Backup Service, Decommissioning the gcloud (Cloud Run) Deployment, Scheduler Container: Daily Snapshot Cron, Swappable Infra Choices (Proxy, Build Location), VPS Production Deployment Stack (Docker Compose) (+7 more)

### Community 109 - "Android Src"
Cohesion: 0.20
Nodes (13): AllocationSlice, allocationSlices(), bin(), fxExposure(), FXSlice, GoalHistoryPoint, GrowthBin, DAILY (+5 more)

### Community 110 - "Backend Test Portfolio Metrics And Dividends"
Cohesion: 0.17
Nodes (12): fresh_treasury_rate(), headers(), household(), owner(), portfolio(), fixture, API-level tests for portfolio metrics, manual sync, and manual dividend CRUD., Seed a recent ^IRX row so metrics endpoints skip the yfinance treasury fetch. (+4 more)

### Community 111 - "iOS Views"
Cohesion: 0.22
Nodes (12): CreateHouseholdView, .body, .canSave, MoreView, .body, .themeModeBinding, PaletteSwatchRow, .body (+4 more)

### Community 112 - "Android Src"
Cohesion: 0.18
Nodes (6): compactCurrency(), currency(), currencyFormat(), currencySymbol(), currencyWhole(), NumberFormat

### Community 113 - "Backend Database Schema.svg"
Cohesion: 0.25
Nodes (14): account_access table, account_balances table, assets table, categories table, dividends table, financial_accounts table, household_members table, households table (+6 more)

### Community 114 - "Backend Test Subportfolio Cash"
Cohesion: 0.25
Nodes (13): auth_headers(), _cash_payload(), fixture, test_account(), test_cash_is_scoped_per_subportfolio(), test_deposit_appears_in_snapshots_at_face_value(), test_deposit_creates_cash_trade_and_transaction(), test_household() (+5 more)

### Community 115 - "Frontend Components"
Cohesion: 0.20
Nodes (9): Select, SelectOption, SelectProps, FEW_OPTIONS, FRUIT, onboardingAction(), onboardingLoader(), OnboardingLoaderData (+1 more)

### Community 116 - "Android Src"
Cohesion: 0.18
Nodes (11): CategoryCreate, CategoryUpdate, Color, ImageVector, Modifier, Quint, SwipeActionRow(), CategoriesScreen() (+3 more)

### Community 117 - "iOS Support"
Cohesion: 0.24
Nodes (8): Equatable, AppTheme, Palette, .accent, Color, Int, String, UserResponse

### Community 118 - "Mobile Package.json"
Cohesion: 0.15
Nodes (13): expo-font, @expo-google-fonts/plus-jakarta-sans, @expo/metro-runtime, dependencies, axios, expo-font, @expo-google-fonts/plus-jakarta-sans, @expo/metro-runtime (+5 more)

### Community 119 - "iOS MoneyDecodingTests"
Cohesion: 0.18
Nodes (3): Holder, MoneyDecodingTests, OptionalHolder

### Community 120 - "Android Src"
Cohesion: 0.22
Nodes (7): FragmentActivity, MainActivity, WaypointRoot(), LoginScreen(), OnboardingScreen(), PresetAccountCard(), Bundle

### Community 121 - "Backend Services"
Cohesion: 0.27
Nodes (10): cash_ticker(), get_or_create_cash_asset(), get_subportfolio_cash_balance(), date, Session, UUID, Find or create the cash pseudo-asset for a currency (ticker CASH.<CUR>)., Cash units of one cash asset held in a sub-portfolio as of a date (inclusive). (+2 more)

### Community 122 - "Backend Test Adversarial"
Cohesion: 0.44
Nodes (5): add_member(), headers_for(), make_household(), make_user(), fixture

### Community 123 - "Backend Test Trades Transactions"
Cohesion: 0.27
Nodes (7): auth_headers(), fixture, test_account(), test_asset(), test_household(), test_subportfolio(), test_user()

### Community 124 - "iOS Support"
Cohesion: 0.22
Nodes (9): BiometricAuth, .biometryType, .displayName, .isAvailable, .symbolName, Bool, String, LABiometryType (+1 more)

### Community 126 - "Frontend Package.json"
Cohesion: 0.20
Nodes (9): devEngines, runtime, name, private, name, onFail, version, type (+1 more)

### Community 127 - "Frontend Package.json"
Cohesion: 0.22
Nodes (10): pnpm, onlyBuiltDependencies, supportedArchitectures, libc, os, current, esbuild, linux (+2 more)

### Community 128 - "Frontend Pages"
Cohesion: 0.33
Nodes (4): getApiUrl(), action(), action(), action()

### Community 129 - "iOS AGENTS"
Cohesion: 0.20
Nodes (10): frontend/src/lib/goals.ts (projectGoal/valueHistory), ViewModeContext, GoalProjection.swift, Growth Charts (equityCurve/growthBin binning divergence), Performance Metrics Grid (StatTile/PerformanceTileGrid), PortfolioAnalytics.swift (equity curve/allocation/FX math), Swift Testing Unit Test Suite (FinanceTrackerTests), Face ID Vault Lock (require_face_id_for_vault, fails open) (+2 more)

### Community 130 - "iOS Support"
Cohesion: 0.22
Nodes (5): Date, .apiDateOnly, .monthYear, .shortDay, String

### Community 131 - "iOS Views"
Cohesion: 0.20
Nodes (10): Mode, balance, dividend, expense, .icon, .id, income, .label (+2 more)

### Community 132 - "Mobile Package.json"
Cohesion: 0.20
Nodes (9): devDependencies, @types/react, typescript, @types/react, typescript, main, name, private (+1 more)

### Community 133 - "Backend AGENTS"
Cohesion: 0.22
Nodes (9): Alembic Autogenerate-Only Migration Workflow, SSR Cookie Forwarding for JWT Auth, No Single-Resource GET for Accounts/Trades/Transactions, API Design Principles (REST, Aggregation Endpoints), Backend AI Agent Instructions, Backend Implementation Standards, Alembic Migration Workflow (Backend), Backend Security: JWT Auth & Household Authorization (+1 more)

### Community 136 - "Frontend Pages"
Cohesion: 0.50
Nodes (3): loaderData, customRender(), setupAuth()

### Community 137 - "iOS Models"
Cohesion: 0.22
Nodes (9): RecurrenceFrequency, biweekly, .id, .label, monthly, .occurrencesPerMonth, quarterly, weekly (+1 more)

### Community 138 - "iOS Networking"
Cohesion: 0.33
Nodes (3): Keychain, String, Security

### Community 139 - "AGENTS"
Cohesion: 0.25
Nodes (8): Project AI Agent Instructions (AGENTS.md), Data Export & Reports, Dividend Cash Crediting, Docker Compose Infrastructure (dev + prod VPS), Property, Loans & Net Worth Projection, Settle Trade From Sub-Portfolio Cash, Sub-Portfolio Cash Pseudo-Asset, CLAUDE.md (imports AGENTS.md)

### Community 140 - "Android Src"
Cohesion: 0.25
Nodes (7): QuickAddMode, BALANCE, DIVIDEND, EXPENSE, INCOME, TRADE, TRANSFER

### Community 141 - "Backend Services"
Cohesion: 0.29
Nodes (7): add_months(), months_between(), date, Calendar arithmetic shared by the loan schedule and the recurrence engine., Whole months elapsed from `start` to `end` (negative if end precedes start)., Add whole months, clamping to the end of shorter months. Always computed from…, ValueError

### Community 143 - "DEVELOPER GUIDE"
Cohesion: 0.25
Nodes (8): Cloud Run Backend Service Config, Cloud Run Frontend Service Config, GCP Cloud Build -> Cloud Run Deployment Pipeline (deprecated), Microsoft Clarity Analytics, Developer Guide, Local Development Setup (Backend & Frontend), Native Mobile Clients (iOS & Android build/run), Styling Standards (Vanilla CSS + Tailwind 4, Premium UI)

### Community 144 - "Frontend Package.json"
Cohesion: 0.25
Nodes (8): scripts, build, dev, lint, preview, start, test, test:coverage

### Community 145 - "iOS Support"
Cohesion: 0.25
Nodes (8): GrowthRange, all, .id, .months, oneMonth, oneYear, sixMonths, Int

### Community 147 - "AGENTS"
Cohesion: 0.29
Nodes (7): Household Invites (email-based auto-accept), Native-Client Parity (ios/android/frontend), Private vs. Shared Ownership Model, Private/Household/Blended View Mode Switch, ViewModeViewModel (Private/Household/Blended), Household Multi-Tenancy & UUID7 Keys, Running the Mobile App (Expo)

### Community 148 - "Android Src"
Cohesion: 0.38
Nodes (3): Context, SharedPreferences, TokenStore

### Community 149 - "Backend Test Adversarial"
Cohesion: 0.29
Nodes (4): _no_network(), Adversarial / abuse test suite. These tests take the perspective of a savvy,…, Neutralize the yfinance-backed snapshot/dividend/price refreshers so the happy-…, TestPasswordStrength

### Community 150 - "iOS Models"
Cohesion: 0.29
Nodes (7): HouseholdMemberUserResponse, HouseholdRole, editor, .id, .label, owner, viewer

### Community 151 - "iOS Gen Appicon"
Cohesion: 0.38
Nodes (5): build_pixels(), dist_to_segment(), grid_to_px(), Generate the Waypoint app icon. Draws the same mark as the web's…, Distance from (px,py) to segment a->b.

### Community 153 - "Android Src"
Cohesion: 0.33
Nodes (3): BiometricAuth, Context, FragmentActivity

### Community 154 - "iOS Models"
Cohesion: 0.33
Nodes (6): CodingKey, CodingKeys, name, ownerUserId, targetAmount, targetDate

### Community 155 - "Docker Compose.prod"
Cohesion: 0.33
Nodes (6): Backend Service (prod), Caddy Reverse Proxy Service (prod), Nightly pg_dump Backup Service, 14-day Retention, Postgres 18 DB Service (prod), Frontend Service (prod), Scheduler Container Replacing Cloud Scheduler

### Community 156 - "iOS Project"
Cohesion: 0.33
Nodes (6): Release Archive + IPA Export/Install Process, XcodeGen project.yml Workflow, Orientation Config (iPhone portrait-only, iPad all four), Declared Shared Scheme (survives xcodegen regenerate), Signing Config Must Live in project.yml, not Xcode UI, XcodeGen project.yml Root Config (deploymentTarget iOS 18)

### Community 158 - "Backend README"
Cohesion: 0.40
Nodes (5): Multi-Currency Reporting Standardization, Analytics Engine (snapshot_engine.py), Database Schema Diagram (database_schema.svg), Finance Tracker Backend README, Multi-Currency Engine (Developer Guide)

### Community 159 - "Android Src"
Cohesion: 0.40
Nodes (5): GrowthRange, ALL, ONE_MONTH, ONE_YEAR, SIX_MONTHS

### Community 160 - "Android Src"
Cohesion: 0.60
Nodes (4): BodyCell(), HeaderCell(), LoanScheduleScreen(), TextAlign

### Community 161 - "Docker Compose"
Cohesion: 0.40
Nodes (5): Backend Service (dev), Postgres 18 DB Service (dev), Dev Bind-Mount / Anonymous Volume Pattern, WATCHFILES_FORCE_POLLING for fastapi dev --reload, Explicit -f Excludes docker-compose.override.yml in Prod

### Community 162 - "Docker Compose.override"
Cohesion: 0.40
Nodes (5): Frontend Service (dev), CHOKIDAR_USEPOLLING/INTERVAL for Vite HMR in container, CI=true to skip pnpm interactive purge prompt, pnpm store dir off bind mount (npm_config_store_dir), pnpm allowBuilds (parcel/watcher, esbuild)

### Community 163 - "Mobile Package.json"
Cohesion: 0.40
Nodes (5): scripts, android, ios, start, web

### Community 164 - "Mobile Tsconfig.json"
Cohesion: 0.40
Nodes (4): compilerOptions, strict, extends, expo/tsconfig.base

### Community 165 - "Android Src"
Cohesion: 0.50
Nodes (3): AccountCreate, BalanceCreate, LiquidityStatus

### Community 166 - "Android Src"
Cohesion: 0.50
Nodes (3): CashDirection, DEPOSIT, WITHDRAW

### Community 168 - "Android Gradlew"
Cohesion: 0.83
Nodes (3): gradlew script, die(), warn()

### Community 170 - "Frontend AGENTS"
Cohesion: 0.50
Nodes (4): Brand Theme Scheme A (Sky/Fuchsia/Mauve), Frontend 4pt Grid / Sizing / Typography Design System, Frontend Design Philosophy (Rich Aesthetics, Micro-animations), Frontend Tech Stack (React 19, RRv7, Tailwind 4, Recharts)

### Community 172 - "iOS AGENTS"
Cohesion: 0.50
Nodes (4): Native SwiftUI Stack (iOS 18, no 3rd-party deps), ios/CLAUDE.md @-imports AGENTS.md, mobile/ Frozen as of 2026-07-26 (superseded by ios/), mobile/CLAUDE.md @-imports AGENTS.md

### Community 173 - "iOS Models"
Cohesion: 0.50
Nodes (4): UserResponse, .defaultsNewItemsPrivate, .hidesPrivateFromHousehold, .requiresFaceIdForVault

### Community 203 - "Frontend Assets"
Cohesion: 1.33
Nodes (3): Hero Image (Landing Page Marketing Graphic), Stacked Rounded-Square Tile Motif (Abstract 3D Illustration), Purple/Violet Gradient Brand Accent Color

### Community 205 - "Bolt"
Cohesion: 1.00
Nodes (3): Chart Data Aggregation Optimization (restated), ISO Date String Relational Comparison over localeCompare, O(N) Single-Pass Time-Series Aggregation

## Knowledge Gaps
- **758 isolated node(s):** `LIQUID`, `MARKET_LIQUID`, `TIME_LOCKED`, `RETIREMENT`, `ILLIQUID` (+753 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **62 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `create_user()` connect `Backend Users Router` to `Portfolio Router & Trading`, `iOS App Session Store`?**
  _High betweenness centrality (0.252) - this node is a cross-community bridge._
- **Why does `User` connect `Portfolio Router & Trading` to `Backend Pydantic Schemas & Enums`, `Backend Auth & OAuth`, `Backend Portfolio Tests`, `Backend Household & User Tests`, `Backend Cashflow Router`, `Backend Recurring Transaction Tests`, `Backend Accounts Tests`, `Backend Users Router`, `Backend Property & Loan Tests`, `Backend Accounts Router`, `Backend Test Cashflow`, `Backend Routers`, `Backend Services`, `Backend Test Budgets And Emergency Fund`, `Backend Models`, `Backend Test Transfers`, `Backend Test Exports`, `Backend Test Trade Cash Settlement`, `Backend Test Portfolio Metrics And Dividends`, `Backend Test Subportfolio Cash`, `Backend Test Adversarial`, `Backend Test Trades Transactions`?**
  _High betweenness centrality (0.143) - this node is a cross-community bridge._
- **Are the 103 inferred relationships involving `TradeType` (e.g. with `AccountAccessBase` and `AccountAccessCreate`) actually correct?**
  _`TradeType` has 103 INFERRED edges - model-reasoned connections that need verification._
- **Are the 103 inferred relationships involving `LiquidityStatus` (e.g. with `AccountAccessBase` and `AccountAccessCreate`) actually correct?**
  _`LiquidityStatus` has 103 INFERRED edges - model-reasoned connections that need verification._
- **Are the 103 inferred relationships involving `TaxTreatment` (e.g. with `AccountAccessBase` and `AccountAccessCreate`) actually correct?**
  _`TaxTreatment` has 103 INFERRED edges - model-reasoned connections that need verification._
- **What connects `LIQUID`, `MARKET_LIQUID`, `TIME_LOCKED` to the rest of the system?**
  _758 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Dividend Tracking & Calendar` be split into smaller, more focused modules?**
  _Cohesion score 0.047619047619047616 - nodes in this community are weakly interconnected._