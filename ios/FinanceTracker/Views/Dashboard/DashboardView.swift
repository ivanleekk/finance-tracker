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
    /// One row per date holding both buckets, rather than two rows tagged by series.
    /// The chart draws the bands itself instead of asking Swift Charts to stack them:
    /// cash goes negative for an overdrawn household, and an automatic stack renders
    /// that as a band flipped through the axis rather than debt hanging below zero.
    private var netWorthBands: [NetWorthBandPoint] {
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

        return dates.map { date in
            let cutoff = date.addingTimeInterval(86_399)
            let cash = byAccount.reduce(0.0) { sum, entry in
                let (accountId, history) = entry
                let bal = history.last { $0.date <= cutoff }?.homeValue ?? 0
                return sum + (liabilityIds.contains(accountId) ? -bal : bal)
            }
            let portfolio = snapshotDates.last { $0 <= date }.map { portfolioByDate[$0] ?? 0 } ?? 0
            return NetWorthBandPoint(date: date, cash: cash, investments: portfolio)
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
        // netWorthBands does an O(dates × accounts) forward-fill; bind it once
        // instead of triggering it separately for the date-count gate and the
        // chart itself.
        let bands = netWorthBands
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

                    if bands.count > 1 {
                        NetWorthAreaChart(bands: bands, currency: baseCurrency)
                            .padding(.vertical, 4)
                    }

                    // Doubles as the chart's legend — the two swatches name the bands,
                    // so the chart itself doesn't need a legend row restating them.
                    if !visibleSnapshots.isEmpty || bands.count > 1 {
                        HStack(spacing: 12) {
                            BreakdownCell(
                                title: "Cash",
                                value: currentCash,
                                color: ChartStyle.cash,
                                currency: baseCurrency
                            )
                            BreakdownCell(
                                title: "Investments",
                                value: currentPortfolioValue,
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
                            StatTile(title: "TWR (\(StatTile.returnBasis(m?.annualized)))", value: StatTile.percentString(m?.timeWeightedReturn), tint: StatTile.returnTint(m?.timeWeightedReturn))
                            StatTile(title: "IRR / MWR (\(StatTile.returnBasis(m?.annualized)))", value: StatTile.percentString(m?.moneyWeightedReturn), tint: StatTile.returnTint(m?.moneyWeightedReturn))
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
struct NetWorthBandPoint: Identifiable {
    let id = UUID()
    let date: Date
    /// Cash-like accounts net of liabilities — negative for an overdrawn household.
    let cash: Double
    let investments: Double

    /// Cash occupies the band between zero and itself, so debt hangs *below* the axis
    /// instead of being stacked upwards as if it were an asset.
    var cashBottom: Double { min(cash, 0) }
    var cashTop: Double { max(cash, 0) }
    /// Investments always sit on the positive side, on top of whatever cash there is.
    var investmentsBottom: Double { max(cash, 0) }
    var investmentsTop: Double { max(cash, 0) + investments }
    var total: Double { cash + investments }
}

/// The Dashboard's net-worth composition over time: a cash band and an investments
/// band, with the net-worth line drawn over them.
///
/// The line isn't decoration — with liabilities pulling cash negative the two bands no
/// longer add up to what the reader is looking for, and the line is the only thing on
/// the chart that states net worth. It stays for the positive case too, so the shape
/// people learn to read doesn't change with their balance sheet.
struct NetWorthAreaChart: View {
    let bands: [NetWorthBandPoint]
    let currency: String

    private var hasDebtBelowZero: Bool { bands.contains { $0.cash < 0 } }

    private var span: TimeInterval? {
        guard let first = bands.first?.date, let last = bands.last?.date else { return nil }
        return last.timeIntervalSince(first)
    }

    /// Points where each band actually has height. A band's edge line is only drawn
    /// where its fill exists — otherwise the investments line runs along the top of the
    /// *cash* fill for every month before the first trade, and the colours stop matching
    /// what they bound.
    private var cashPoints: [NetWorthBandPoint] { bands.filter { abs($0.cash) > 0.005 } }
    private var investmentPoints: [NetWorthBandPoint] { bands.filter { $0.investments > 0.005 } }

    var body: some View {
        Chart {
            ForEach(bands) { point in
                AreaMark(
                    x: .value("Date", point.date),
                    yStart: .value("From", point.cashBottom),
                    yEnd: .value("To", point.cashTop),
                    series: .value("Band", "cash")
                )
                .foregroundStyle(ChartStyle.fill(ChartStyle.cash))
                .interpolationMethod(.monotone)

                AreaMark(
                    x: .value("Date", point.date),
                    yStart: .value("From", point.investmentsBottom),
                    yEnd: .value("To", point.investmentsTop),
                    series: .value("Band", "investments")
                )
                .foregroundStyle(ChartStyle.fill(ChartStyle.investments))
                .interpolationMethod(.monotone)
            }

            // The separator is drawn slightly wider than the cash edge line that lands on
            // top of it, so what's left is a hairline of surface colour either side of a
            // blue line: the house 2pt gap between touching fills, and the cash band's own
            // edge, in one stroke. A border around each band would be ink that isn't data.
            ForEach(cashPoints) { point in
                LineMark(
                    x: .value("Date", point.date),
                    y: .value("Cash", point.cashTop),
                    series: .value("Series", "separator")
                )
                .foregroundStyle(ChartStyle.surface)
                .lineStyle(StrokeStyle(lineWidth: ChartStyle.lineWidth + ChartStyle.separatorWidth))
                .interpolationMethod(.monotone)
            }

            ForEach(cashPoints) { point in
                LineMark(
                    x: .value("Date", point.date),
                    y: .value("Cash", point.cashTop),
                    series: .value("Series", "cash")
                )
                .foregroundStyle(ChartStyle.cash)
                .lineStyle(StrokeStyle(lineWidth: ChartStyle.lineWidth, lineCap: .round, lineJoin: .round))
                .interpolationMethod(.monotone)
            }

            ForEach(investmentPoints) { point in
                LineMark(
                    x: .value("Date", point.date),
                    y: .value("Investments", point.investmentsTop),
                    series: .value("Series", "investments")
                )
                .foregroundStyle(ChartStyle.investments)
                .lineStyle(StrokeStyle(lineWidth: ChartStyle.lineWidth, lineCap: .round, lineJoin: .round))
                .interpolationMethod(.monotone)
            }

            // "You are here": one marker on the topmost band, in that band's own colour,
            // with a 2pt ring in the surface colour so it stays legible on the line.
            if let last = bands.last {
                let onInvestments = last.investments > 0.005
                let markerY = onInvestments ? last.investmentsTop : last.cashTop
                let markerColor = onInvestments ? ChartStyle.investments : ChartStyle.cash
                PointMark(x: .value("Date", last.date), y: .value("Latest", markerY))
                    .symbolSize(60)
                    .foregroundStyle(markerColor)
                PointMark(x: .value("Date", last.date), y: .value("Latest", markerY))
                    .symbolSize(14)
                    .foregroundStyle(ChartStyle.surface)
            }

            // Only when debt pulls cash below zero, where the top of the stack is no
            // longer the number the reader came for. With cash positive the stack's own
            // top edge *is* net worth, and a second line over it is just doubled ink.
            if hasDebtBelowZero {
                ForEach(bands) { point in
                    LineMark(
                        x: .value("Date", point.date),
                        y: .value("Net worth", point.total),
                        series: .value("Series", "total")
                    )
                    .foregroundStyle(.primary.opacity(0.45))
                    .lineStyle(StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))
                    .interpolationMethod(.monotone)
                }

                RuleMark(y: .value("Zero", 0))
                    .foregroundStyle(ChartStyle.grid)
                    .lineStyle(StrokeStyle(lineWidth: 1))
            }
        }
        .chartLegend(.hidden)
        .financeChartAxes(currency: currency, dateSpan: span)
        .adaptiveChartHeight(compact: 180, regular: 300)
    }
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

    /// Keyed by bucket, not by position in the list: empty buckets are dropped before
    /// this renders, so an index would hand "Other Assets" the colour Property had on
    /// another household's screen. See `ChartStyle.netWorthColor`.
    private func color(_ slice: NetWorthSlice) -> Color { ChartStyle.netWorthColor(key: slice.key) }

    var body: some View {
        VStack(spacing: 16) {
            Chart(breakdown.slices) { slice in
                SectorMark(
                    angle: .value("Value", slice.value),
                    innerRadius: .ratio(0.62),
                    angularInset: 1.5
                )
                .cornerRadius(3)
                .foregroundStyle(color(slice))
            }
            .chartLegend(.hidden)
            .frame(height: 150)

            VStack(spacing: 8) {
                ForEach(breakdown.slices) { slice in
                    HStack(spacing: 8) {
                        RoundedRectangle(cornerRadius: 3, style: .continuous)
                            .fill(color(slice))
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
