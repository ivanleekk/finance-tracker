import SwiftUI
import Charts

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
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var lastLoadedAt: Date?

    private var baseCurrency: String { session.activeHousehold?.baseCurrency ?? "USD" }

    /// Adaptive rather than a fixed pair: 2 tiles wide on iPhone, 4+ on an iPad canvas.
    private let statColumns = [GridItem(.adaptive(minimum: 150), spacing: 10)]

    // MARK: View-mode visibility

    /// Accounts / sub-portfolios visible under the current view mode; their derived data
    /// (balances, holdings, transactions) inherits that visibility.
    private var visibleAccounts: [AccountResponse] {
        accounts.filter { viewModeStore.isVisible(ownerUserId: $0.ownerUserId, currentUserId: session.user?.id) }
    }
    private var visibleAccountIds: Set<String> { Set(visibleAccounts.map(\.id)) }
    private var visibleSubPortfolioIds: Set<String> {
        Set(subPortfolios
            .filter { viewModeStore.isVisible(ownerUserId: $0.ownerUserId, currentUserId: session.user?.id) }
            .map(\.id))
    }
    private var visibleBalances: [BalanceResponse] {
        balances.filter { visibleAccountIds.contains($0.accountId) }
    }
    private var visibleSnapshots: [PortfolioSnapshotResponse] {
        snapshots.filter { visibleSubPortfolioIds.contains($0.subPortfolioId) }
    }
    private var visibleTimeseries: [PortfolioTimeseriesPoint] {
        timeseries.filter { visibleSubPortfolioIds.contains($0.subPortfolioId) }
    }

    /// O(1) row lookups instead of `.first { $0.id == ... }` scans re-run per row per render.
    private var assetsById: [String: AssetResponse] {
        Dictionary(uniqueKeysWithValues: assets.map { ($0.id, $0) })
    }
    private var categoriesById: [String: CategoryResponse] {
        Dictionary(uniqueKeysWithValues: categories.map { ($0.id, $0) })
    }
    private var accountsById: [String: AccountResponse] {
        Dictionary(uniqueKeysWithValues: accounts.map { ($0.id, $0) })
    }

    /// Liability accounts (loans, mortgages) hold their outstanding balance as a
    /// positive number; they count *against* net worth (mirrors web Dashboard).
    private var liabilityIds: Set<String> {
        Set(accounts.filter { $0.kind == "liability" }.map(\.id))
    }

    /// Latest known balance per account, netting out liabilities. This is the
    /// "cash" side of net worth — money held in real accounts.
    private var currentCash: Double {
        Dictionary(grouping: visibleBalances, by: \.accountId).reduce(0.0) { sum, entry in
            let (accountId, history) = entry
            guard let bal = history.max(by: { $0.date < $1.date })?.homeValue else { return sum }
            return sum + (liabilityIds.contains(accountId) ? -bal : bal)
        }
    }

    /// Holdings on the most recent snapshot date only (mirrors PortfolioView).
    private var latestHoldings: [PortfolioSnapshotResponse] {
        guard let latest = visibleSnapshots.map(\.date).max() else { return [] }
        return visibleSnapshots.filter { $0.date == latest && $0.quantity > 0 }
    }

    /// Total investment value on the most recent snapshot date.
    private var currentPortfolioValue: Double {
        latestHoldings.reduce(0) { $0 + $1.currentValueHomeCurrency }
    }

    /// The largest holdings by home-currency value, for the dashboard preview.
    private var topHoldings: [PortfolioSnapshotResponse] {
        Array(
            latestHoldings
                .sorted { $0.currentValueHomeCurrency > $1.currentValueHomeCurrency }
                .prefix(4)
        )
    }

    /// Net worth = liquid accounts (net of liabilities) + investments.
    private var netWorth: Double { currentCash + currentPortfolioValue }

    /// Net worth broken into buckets for the split donut: cash, investments,
    /// retirement/locked, property, and whatever's left over.
    private var worthBreakdown: NetWorthBreakdown {
        let byAccount = Dictionary(grouping: visibleBalances, by: \.accountId)
        let inputs = visibleAccounts.map { account in
            NetWorthAccountInput(kind: account.kind, liquidity: account.liquidity, history: byAccount[account.id] ?? [])
        }
        return netWorthBreakdown(accounts: inputs, portfolioValue: currentPortfolioValue)
    }

    /// One stacked-area band per (date, series). Cash is forward-filled from
    /// account balances; investments are forward-filled from snapshot totals.
    /// Together the two bands sum to net worth on every date.
    private var netWorthSeries: [NetWorthPoint] {
        let cal = Calendar.current
        let dates = Set(
            visibleBalances.map { cal.startOfDay(for: $0.date) } +
            visibleTimeseries.map { cal.startOfDay(for: $0.date) }
        ).sorted()
        guard !dates.isEmpty else { return [] }

        let byAccount = Dictionary(grouping: visibleBalances, by: \.accountId)
            .mapValues { $0.sorted { $0.date < $1.date } }
        let portfolioByDate = Dictionary(
            grouping: visibleTimeseries, by: { cal.startOfDay(for: $0.date) }
        ).mapValues { $0.reduce(0.0) { $0 + $1.value } }
        let snapshotDates = portfolioByDate.keys.sorted()

        return dates.flatMap { date -> [NetWorthPoint] in
            let cutoff = date.addingTimeInterval(86_399)
            let cash = byAccount.reduce(0.0) { sum, entry in
                let (accountId, history) = entry
                let bal = history.last { $0.date <= cutoff }?.homeValue ?? 0
                return sum + (liabilityIds.contains(accountId) ? -bal : bal)
            }
            let portfolio = snapshotDates.last { $0 <= date }.map { portfolioByDate[$0] ?? 0 } ?? 0
            return [
                NetWorthPoint(date: date, series: .cash, value: cash),
                NetWorthPoint(date: date, series: .investments, value: portfolio),
            ]
        }
    }

    private var recentTransactions: [TransactionResponse] {
        Array(transactions
            .filter { visibleAccountIds.contains($0.accountId) }
            .sorted { $0.date > $1.date }
            .prefix(5))
    }

    var body: some View {
        // Computed once per body evaluation and reused for every account row
        // below, instead of each row re-scanning the whole balance history.
        let latestByAccount = latestBalanceByAccount
        // netWorthSeries does an O(dates × accounts) forward-fill; bind it once
        // instead of triggering it separately for the date-count gate and the
        // chart itself.
        let series = netWorthSeries
        let seriesDateCount = Set(series.map(\.date)).count
        NavigationStack {
            List {
                QuickAddPullSensor()
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Net Worth")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Text(netWorth.currency(baseCurrency))
                            .font(.system(.largeTitle, design: .rounded, weight: .bold))
                            .contentTransition(.numericText())
                    }
                    .padding(.vertical, 4)

                    if seriesDateCount > 1 {
                        Chart(series) { point in
                            AreaMark(
                                x: .value("Date", point.date),
                                y: .value("Value", point.value)
                            )
                            .foregroundStyle(by: .value("Type", point.series.label))
                            .interpolationMethod(.monotone)
                            .opacity(0.85)
                        }
                        .chartForegroundStyleScale([
                            NetWorthPoint.Series.investments.label: session.theme.primary.accent,
                            NetWorthPoint.Series.cash.label: session.theme.secondary.accent,
                        ])
                        .chartLegend(position: .bottom, spacing: 8)
                        .chartYAxis {
                            AxisMarks(position: .trailing) { value in
                                AxisGridLine()
                                AxisValueLabel {
                                    if let v = value.as(Double.self) {
                                        Text(v.compactCurrency(baseCurrency))
                                    }
                                }
                            }
                        }
                        .adaptiveChartHeight(compact: 180, regular: 300)
                        .padding(.vertical, 4)
                    }

                    if !visibleSnapshots.isEmpty {
                        HStack(spacing: 12) {
                            BreakdownCell(
                                title: "Cash",
                                value: currentCash,
                                color: session.theme.secondary.accent,
                                currency: baseCurrency
                            )
                            BreakdownCell(
                                title: "Investments",
                                value: currentPortfolioValue,
                                color: session.theme.primary.accent,
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

                if !worthBreakdown.slices.isEmpty {
                    Section("Net Worth Split") {
                        NetWorthSplitChart(breakdown: worthBreakdown, netWorth: netWorth, currency: baseCurrency)
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

                if !latestHoldings.isEmpty {
                    Section("Returns") {
                        LazyVGrid(columns: statColumns, spacing: 10) {
                            let m = metrics?.overallMetrics
                            StatTile(title: "Overall Return", value: StatTile.percentString(m?.simpleReturn), tint: StatTile.returnTint(m?.simpleReturn))
                            StatTile(title: "TWR (Ann.)", value: StatTile.percentString(m?.timeWeightedReturn), tint: StatTile.returnTint(m?.timeWeightedReturn))
                            StatTile(title: "IRR / MWR", value: StatTile.percentString(m?.moneyWeightedReturn), tint: StatTile.returnTint(m?.moneyWeightedReturn))
                            StatTile(title: "Sharpe", value: StatTile.ratioString(m?.sharpeRatio))
                        }
                        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                        .listRowBackground(Color.clear)
                    }
                }

                if !topHoldings.isEmpty {
                    Section {
                        HStack {
                            Text("Total Value")
                                .foregroundStyle(.secondary)
                            Spacer()
                            Text(currentPortfolioValue.currency(baseCurrency))
                                .font(.body.monospacedDigit().weight(.semibold))
                        }
                        ForEach(topHoldings) { holding in
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
                            AccountRow(account: account, latestBalance: latestByAccount[account.id])
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
                    ForEach(recentTransactions) { txn in
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
            }
            .overlay {
                if isLoading && balances.isEmpty { LoadingSkeleton(showsHeader: true) }
            }
            .quickAddPull(quickAdd, onReload: load)
            .task { await loadIfNeeded() }
            .alert("Couldn’t Load Dashboard", isPresented: .init(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(errorMessage ?? "")
            }
        }
    }

    /// One pass over the whole balance history instead of re-filtering it per
    /// account row (`.filter { ... }.max { ... }` was O(accounts × balances)).
    private var latestBalanceByAccount: [String: BalanceResponse] {
        balances.reduce(into: [:]) { result, balance in
            if let existing = result[balance.accountId], existing.date >= balance.date { return }
            result[balance.accountId] = balance
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
            async let txnsReq: [TransactionResponse] = APIClient.shared.get("/cashflow/transactions/household/\(household.id)")
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

            (accounts, balances, transactions, categories, snapshots, timeseries, subPortfolios, assets) =
                try await (accountsReq, balancesReq, txnsReq, categoriesReq, snapshotsReq, timeseriesReq, subPortfoliosReq, assetsReq)
            (metrics, emergencyFund, projection) = await (metricsReq, emergencyFundReq, projectionReq)
            lastLoadedAt = Date()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct AccountRow: View {
    let account: AccountResponse
    let latestBalance: BalanceResponse?

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(account.name)
                        .font(.body)
                    if account.ownerUserId != nil {
                        Image(systemName: "lock.fill")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                Text(account.liquidity.label)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Text((latestBalance?.balance ?? 0).currency(account.currency))
                .font(.body.monospacedDigit())
        }
    }
}

struct TransactionRow: View {
    let transaction: TransactionResponse
    let categoryName: String?
    let accountName: String?
    let baseCurrency: String

    private var isIncome: Bool { transaction.transactionType == .income }

    var body: some View {
        HStack {
            Image(systemName: transaction.transferId != nil
                  ? "arrow.left.arrow.right"
                  : (isIncome ? "arrow.down.circle.fill" : "arrow.up.circle.fill"))
                .foregroundStyle(transaction.transferId != nil ? .secondary : (isIncome ? Color.green : Color.red))
                .font(.title3)
            VStack(alignment: .leading, spacing: 2) {
                Text(transaction.description?.isEmpty == false
                     ? transaction.description!
                     : (categoryName ?? "Transaction"))
                Text([categoryName, accountName, transaction.date.shortDay]
                    .compactMap(\.self).joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Text((isIncome ? "+" : "−") + transaction.amount.currency(transaction.currency ?? baseCurrency))
                .font(.body.monospacedDigit())
                .foregroundStyle(isIncome ? .green : .primary)
        }
    }
}

/// A single stacked-area data point for the net-worth chart.
struct NetWorthPoint: Identifiable {
    enum Series {
        case cash, investments

        var label: String {
            switch self {
            case .cash: return "Cash"
            case .investments: return "Investments"
            }
        }
    }

    let id = UUID()
    let date: Date
    let series: Series
    let value: Double
}

/// Donut + legend for the Dashboard's Net Worth Split: gross asset composition,
/// with liabilities and the net total as plain rows below rather than wedges
/// (a donut can't render a negative slice). Native counterpart of the web
/// Dashboard's "Net Worth Split" card.
struct NetWorthSplitChart: View {
    let breakdown: NetWorthBreakdown
    /// The household's actual net worth (assets net of liabilities across
    /// *every* bucket, including one dropped from the donut for being
    /// negative) — deliberately not derived from `breakdown.sliceTotal`,
    /// which only covers the visible (positive) slices.
    let netWorth: Double
    let currency: String

    /// Matches the web's `--chart-cat-1..5` — a CVD-validated categorical
    /// palette kept deliberately separate from `AllocationCard.palette` so
    /// category identity never shifts with the household's chosen accent.
    static let palette: [Color] = [
        Color(red: 0.165, green: 0.471, blue: 0.839), // #2a78d6
        Color(red: 0.922, green: 0.408, blue: 0.204), // #eb6834
        Color(red: 0.106, green: 0.686, blue: 0.478), // #1baf7a
        Color(red: 0.929, green: 0.631, blue: 0.000), // #eda100
        Color(red: 0.910, green: 0.482, blue: 0.643), // #e87ba4
    ]

    private func color(_ index: Int) -> Color { Self.palette[index % Self.palette.count] }

    var body: some View {
        VStack(spacing: 16) {
            Chart(Array(breakdown.slices.enumerated()), id: \.element.id) { index, slice in
                SectorMark(
                    angle: .value("Value", slice.value),
                    innerRadius: .ratio(0.62),
                    angularInset: 1.5
                )
                .cornerRadius(3)
                .foregroundStyle(color(index))
            }
            .chartLegend(.hidden)
            .frame(height: 150)

            VStack(spacing: 8) {
                ForEach(Array(breakdown.slices.enumerated()), id: \.element.id) { index, slice in
                    HStack(spacing: 8) {
                        RoundedRectangle(cornerRadius: 3, style: .continuous)
                            .fill(color(index))
                            .frame(width: 11, height: 11)
                        Text(slice.label)
                            .font(.caption)
                        Spacer()
                        Text(slice.value.currencyWhole(currency))
                            .font(.caption.monospacedDigit())
                        Text("\(Int((slice.value / breakdown.sliceTotal * 100).rounded()))%")
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.secondary)
                            .frame(width: 36, alignment: .trailing)
                    }
                }

                if breakdown.liabilities > 0 {
                    Divider()
                    HStack {
                        Text("− Liabilities")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Spacer()
                        Text(breakdown.liabilities.currencyWhole(currency))
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.red)
                    }
                }
                HStack {
                    Text("Net worth")
                        .font(.caption.weight(.semibold))
                    Spacer()
                    Text(netWorth.currencyWhole(currency))
                        .font(.caption.monospacedDigit().weight(.semibold))
                }
            }
        }
        .padding(.vertical, 4)
    }
}

/// Small labelled figure with a colour swatch matching its chart band.
struct BreakdownCell: View {
    let title: String
    let value: Double
    let color: Color
    let currency: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 5) {
                Circle()
                    .fill(color)
                    .frame(width: 7, height: 7)
                Text(title)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Text(value.currency(currency))
                .font(.subheadline.monospacedDigit().weight(.semibold))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Compact runway readout for the Dashboard, linking through to Budgets.
struct RunwaySummaryRow: View {
    let fund: EmergencyFundResponse
    let currency: String

    private var tint: Color {
        switch BudgetPresentation.runwayTone(fund) {
        case .critical: return .red
        case .low: return .orange
        case .ok: return .green
        case .unknown: return .secondary
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("Emergency fund runway")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(BudgetPresentation.runwayLabel(fund))
                .font(.title3.bold())
                .foregroundStyle(tint)
            if fund.monthsCovered == nil {
                Text("Log some expenses to measure your burn rate.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            } else {
                Text("\(fund.liquidTotal.currencyWhole(currency)) liquid against \(fund.averageMonthlyExpenses.currencyWhole(currency))/month")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}
