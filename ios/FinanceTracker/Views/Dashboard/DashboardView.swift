import Charts
import SwiftUI

struct DashboardView: View {
    @Environment(SessionStore.self) private var session
    @Environment(QuickAddStore.self) private var quickAdd
    @Environment(ViewModeStore.self) private var viewModeStore

    /// Switches the tab bar to the Portfolio tab (wired from MainTabView).
    var onSeePortfolio: () -> Void = {}
    /// Switches the tab bar to the Accounts tab (wired from MainTabView).
    var onSeeAccounts: () -> Void = {}

    @State private var accounts: [AccountResponse] = []
    @State private var balances: [BalanceResponse] = []
    @State private var transactions: [TransactionResponse] = []
    @State private var categories: [CategoryResponse] = []
    /// Latest-date-only, per-asset rows (fetched with latest_only=true) — feeds
    /// latestHoldings/topHoldings, which never need history.
    @State private var snapshots: [PortfolioSnapshotResponse] = []
    /// Pre-aggregated (date, sub-portfolio) totals across full history — feeds the
    /// net-worth chart, which never needs per-asset detail.
    @State private var timeseries: [PortfolioTimeseriesPoint] = []
    @State private var subPortfolios: [SubPortfolioResponse] = []
    @State private var assets: [AssetResponse] = []
    @State private var metrics: PortfolioMetricsResponse?
    @State private var emergencyFund: EmergencyFundResponse?
    @State private var projection: NetWorthProjectionResponse?
    /// Outstanding debts either way. They sit in no account, so net worth has to
    /// be told about them or a split bill's unreturned half looks like money gone.
    @State private var owed: [CounterpartyBalanceResponse] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var lastLoadedAt: Date?
    /// Where the finger is on the net-worth chart, or nil when nobody is scrubbing.
    @State private var netWorthScrub: Date?

    private var baseCurrency: String { session.activeHousehold?.baseCurrency ?? "USD" }

    /// Adaptive rather than a fixed pair: 2 tiles wide on iPhone, 4+ on an iPad canvas.
    private let statColumns = [GridItem(.adaptive(minimum: 150), spacing: 10)]

    // MARK: Derived data

    /// Everything expensive the screen shows, computed **once per load** (and once per
    /// view-mode / vault change) instead of on every `body` evaluation.
    ///
    /// It used to be a stack of computed properties, which meant every redraw re-filtered
    /// the full balance and timeseries history and re-ran the O(dates × accounts)
    /// forward-fill behind the net-worth chart. Redraws are not rare on this screen —
    /// scrubbing the chart fires one per frame — so a household with a few years of
    /// history paid for its entire history on every frame of a drag.
    @State private var derived = DashboardDerived()

    private var visibleAccounts: [AccountResponse] { derived.accounts }

    /// O(1) row lookups instead of `.first { $0.id == ... }` scans re-run per row per render.
    @State private var assetsById: [String: AssetResponse] = [:]
    @State private var categoriesById: [String: CategoryResponse] = [:]
    @State private var accountsById: [String: AccountResponse] = [:]

    /// The inputs to `isVisible` that aren't part of a load: flipping the view-mode switch
    /// or unlocking the vault has to re-derive everything, without refetching.
    private var visibilityKey: DashboardVisibilityKey {
        DashboardVisibilityKey(
            mode: viewModeStore.effectiveMode,
            vaultLocked: viewModeStore.isVaultLocked,
            userId: session.user?.id
        )
    }

    private func recompute() {
        derived = DashboardDerived(
            accounts: accounts,
            balances: balances,
            transactions: transactions,
            snapshots: snapshots,
            timeseries: timeseries,
            subPortfolios: subPortfolios,
            // Outstanding debts either way. They sit in no account, so net worth has to
            // be told about them or a split bill's unreturned half looks like money gone.
            owed: owed,
            isVisible: { [viewModeStore, session] ownerId in
                viewModeStore.isVisible(ownerUserId: ownerId, currentUserId: session.user?.id)
            }
        )
        assetsById = Dictionary(assets.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        categoriesById = Dictionary(categories.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        accountsById = Dictionary(accounts.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    }

    var body: some View {
        // All pre-derived (see `DashboardDerived`) — nothing here re-walks the household's
        // history, which is what makes a scrub redraw cheap.
        let latestByAccount = derived.latestBalanceByAccount
        let bands = derived.bands
        // Where the finger is on the net-worth chart, if anywhere. The whole card reads
        // from this: headline figure, date label and both breakdown cells, so scrubbing
        // rewrites the numbers the reader already knows rather than adding new ones.
        let scrubbed = netWorthScrub.flatMap { ChartStyle.nearest(to: $0, in: bands, by: \.date) }
        let scrubReadout: ChartScrubReadout? = scrubbed.map { point in
            ChartScrubReadout(
                date: point.date,
                entries: [
                    ChartScrubEntry(label: "Cash", value: point.cash,
                                    color: ChartStyle.cash, markerY: point.cashTop),
                    ChartScrubEntry(label: "Investments", value: point.investments,
                                    color: ChartStyle.investments, markerY: point.investmentsTop),
                ]
            )
        }
        NavigationStack {
            List {
                QuickAddPullSensor()
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            Text(scrubbed.map(\.date.scrubDay) ?? "Net Worth")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                            // The reading sticks after the finger lifts (see
                            // `chartScrub`), so it needs a way back to today.
                            if scrubbed != nil {
                                Button { netWorthScrub = nil } label: {
                                    Image(systemName: "xmark.circle.fill")
                                        .font(.caption)
                                        .foregroundStyle(.tertiary)
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("Clear chart reading")
                            }
                        }
                        Text((scrubbed?.total ?? derived.netWorth).currency(baseCurrency))
                            .font(.system(.largeTitle, design: .rounded, weight: .bold))
                            .contentTransition(.numericText())
                    }
                    .padding(.vertical, 4)

                    if bands.count > 1 {
                        NetWorthAreaChart(
                            bands: bands,
                            currency: baseCurrency,
                            scrubDate: $netWorthScrub,
                            readout: scrubReadout
                        )
                        .padding(.vertical, 4)
                    }

                    // Doubles as the chart's legend — the two swatches name the bands,
                    // so the chart itself doesn't need a legend row restating them.
                    if derived.hasVisibleSnapshots || bands.count > 1 {
                        HStack(spacing: 12) {
                            BreakdownCell(
                                title: "Cash",
                                value: scrubbed?.cash ?? derived.currentCash,
                                color: ChartStyle.cash,
                                currency: baseCurrency
                            )
                            BreakdownCell(
                                title: "Investments",
                                value: scrubbed?.investments ?? derived.currentPortfolioValue,
                                color: ChartStyle.investments,
                                currency: baseCurrency
                            )
                        }
                        .padding(.vertical, 2)
                    }
                }

                if let emergencyFund {
                    Section {
                        NavigationLink {
                            BudgetsView()
                        } label: {
                            RunwaySummaryRow(fund: emergencyFund, currency: baseCurrency)
                        }
                    }
                }

                if !derived.breakdown.slices.isEmpty {
                    Section("Net Worth Split") {
                        NetWorthSplitChart(breakdown: derived.breakdown, netWorth: derived.netWorth, currency: baseCurrency)
                    }
                }

                if let projection, projection.currentNetWorth < 0 || projection.debtFreeDate != nil {
                    Section("Outlook") {
                        LabeledContent("Net worth positive") {
                            Text(projection.currentNetWorth >= 0
                                ? "Already there"
                                : projection.netWorthPositiveDate.map { $0.monthYear } ?? "Not within 30 years")
                                .monospacedDigit()
                        }
                        LabeledContent("Debt free") {
                            Text(projection.debtFreeDate.map { $0.monthYear } ?? "Not within 30 years")
                                .monospacedDigit()
                        }
                        LabeledContent("Interest still to pay") {
                            Text(projection.totalInterestRemaining.currencyWhole(baseCurrency))
                                .monospacedDigit()
                                .foregroundStyle(.red)
                        }
                    }
                }

                if !derived.latestHoldings.isEmpty {
                    Section("Returns") {
                        LazyVGrid(columns: statColumns, spacing: 10) {
                            let m = metrics?.overallMetrics
                            StatTile(title: "Overall Return", value: StatTile.percentString(m?.simpleReturn), tint: StatTile.returnTint(m?.simpleReturn))
                            StatTile(title: "TWR (\(StatTile.returnBasis(m?.annualized)))", value: StatTile.percentString(m?.timeWeightedReturn), tint: StatTile.returnTint(m?.timeWeightedReturn))
                            StatTile(title: "IRR / MWR (\(StatTile.returnBasis(m?.annualized)))", value: StatTile.percentString(m?.moneyWeightedReturn), tint: StatTile.returnTint(m?.moneyWeightedReturn))
                            StatTile(title: "Sharpe", value: StatTile.ratioString(m?.sharpeRatio))
                        }
                        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                        .listRowBackground(Color.clear)
                    }
                }

                if !derived.topHoldings.isEmpty {
                    Section {
                        HStack {
                            Text("Total Value")
                                .foregroundStyle(.secondary)
                            Spacer()
                            Text(derived.currentPortfolioValue.currency(baseCurrency))
                                .font(.body.monospacedDigit().weight(.semibold))
                        }
                        ForEach(derived.topHoldings) { holding in
                            HoldingRow(
                                holding: holding,
                                asset: assetsById[holding.assetId],
                                baseCurrency: baseCurrency
                            )
                        }
                    } header: {
                        HStack {
                            Text("Portfolio")
                            Spacer()
                            Button("See All", action: onSeePortfolio)
                                .font(.subheadline.weight(.semibold))
                                .textCase(nil)
                        }
                    }
                }

                Section {
                    if visibleAccounts.isEmpty && !isLoading {
                        ContentUnavailableView(
                            "No Accounts",
                            systemImage: "building.columns",
                            description: Text("Tap “See All” to add your first account.")
                        )
                    }
                    ForEach(visibleAccounts.prefix(4)) { account in
                        NavigationLink {
                            AccountDetailView(account: account, onChanged: load)
                        } label: {
                            AccountRow(
                                account: account,
                                latestBalance: latestByAccount[account.id],
                                baseCurrency: baseCurrency
                            )
                        }
                    }
                } header: {
                    HStack {
                        Text("Accounts")
                        Spacer()
                        Button("See All", action: onSeeAccounts)
                            .font(.subheadline.weight(.semibold))
                            .textCase(nil)
                    }
                }

                Section("Recent Activity") {
                    ForEach(derived.recentTransactions) { txn in
                        TransactionRow(
                            transaction: txn,
                            categoryName: categoriesById[txn.categoryId]?.name,
                            accountName: accountsById[txn.accountId]?.name,
                            baseCurrency: baseCurrency
                        )
                    }
                }
            }
            .navigationTitle(session.activeHousehold?.name ?? "Dashboard")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { VaultLockButton() }
                ToolbarItem(placement: .topBarLeading) { ViewModeSwitcher() }
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        quickAdd.open()
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel("Quick Add")
                }
            }
            .overlay {
                if isLoading && balances.isEmpty { LoadingSkeleton(showsHeader: true) }
            }
            .quickAddPull(quickAdd, onReload: load)
            .task { await loadIfNeeded() }
            // Flipping Private/Household/Blended or unlocking the vault changes what's
            // visible but not what's been fetched — re-derive without a round trip.
            .onChange(of: visibilityKey) { _, _ in recompute() }
            .alert("Couldn’t Load Dashboard", isPresented: .init(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )) {
                Button("Retry") { Task { await load() } }
                Button("OK", role: .cancel) {}
            } message: {
                Text(errorMessage ?? "")
            }
        }
    }

    /// Re-fetching all 10 dashboard requests on every tab reselect made switching
    /// Dashboard → Portfolio → Dashboard visibly re-spin the whole screen even
    /// though nothing had changed in the last few seconds. Skip the refetch when
    /// the data is still fresh; `onReload`/`onChanged` callbacks below bypass this
    /// and always force a real reload after an edit.
    private static let stalenessWindow: TimeInterval = 30

    private func loadIfNeeded() async {
        if let lastLoadedAt, Date().timeIntervalSince(lastLoadedAt) < Self.stalenessWindow {
            return
        }
        await load()
    }

    private func optionalGet<T: Decodable>(_ path: String) async -> T? {
        try? await APIClient.shared.get(path)
    }

    private func load() async {
        guard let household = session.activeHousehold else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            async let accountsReq: [AccountResponse] = APIClient.shared.get("/accounts/household/\(household.id)")
            async let balancesReq: [BalanceResponse] = APIClient.shared.get("/accounts/balances/household/\(household.id)")
            // Capped, not the full history: this screen shows five rows. 50 rather than 5
            // because the list is filtered again client-side by view mode, and a server-side
            // 5 could leave nothing at all to show in Private mode.
            async let txnsReq: [TransactionResponse] = APIClient.shared.get("/cashflow/transactions/household/\(household.id)?limit=50")
            async let categoriesReq: [CategoryResponse] = APIClient.shared.get("/cashflow/categories/household/\(household.id)")
            async let snapshotsReq: [PortfolioSnapshotResponse] = APIClient.shared.get("/portfolio/snapshots/household/\(household.id)?latest_only=true")
            async let timeseriesReq: [PortfolioTimeseriesPoint] = APIClient.shared.get("/portfolio/snapshots/household/\(household.id)/timeseries")
            async let subPortfoliosReq: [SubPortfolioResponse] = APIClient.shared.get("/portfolio/subportfolios/household/\(household.id)")
            async let assetsReq: [AssetResponse] = APIClient.shared.get("/portfolio/assets")
            // Metrics, emergency fund, and projection are supplementary — never
            // fail the whole dashboard if one of them errors out — and fetched
            // concurrently with each other instead of one after another.
            async let metricsReq: PortfolioMetricsResponse? = optionalGet("/portfolio/household/\(household.id)/metrics")
            async let emergencyFundReq: EmergencyFundResponse? = optionalGet("/cashflow/household/\(household.id)/emergency-fund")
            async let projectionReq: NetWorthProjectionResponse? = optionalGet("/accounts/household/\(household.id)/projection?months=360")
            async let owedReq: [CounterpartyBalanceResponse]? = optionalGet("/cashflow/reimbursements/household/\(household.id)")

            (accounts, balances, transactions, categories, snapshots, timeseries, subPortfolios, assets) =
                try await (accountsReq, balancesReq, txnsReq, categoriesReq, snapshotsReq, timeseriesReq, subPortfoliosReq, assetsReq)
            // Immediately, and *before* awaiting the supplementary requests below. The raw
            // arrays above are `@State`, so assigning them publishes a render; if `derived`
            // were still the previous (or initial, empty) value at that point, the screen
            // would draw a confident "Net Worth $0.00" over freshly-loaded data for as long
            // as the metrics/fund/projection calls take to come back.
            recompute()
            (metrics, emergencyFund, projection) = await (metricsReq, emergencyFundReq, projectionReq)
            owed = await owedReq ?? []
            // Recompute once more now that `owed` has landed — it wasn't part of the
            // primary batch above, so the first pass published net worth without it.
            recompute()
            lastLoadedAt = Date()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
