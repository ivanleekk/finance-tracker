import SwiftUI
import Charts

struct PortfolioView: View {
    @Environment(SessionStore.self) private var session
    @Environment(QuickAddStore.self) private var quickAdd
    @Environment(ViewModeStore.self) private var viewModeStore

    /// Latest-date-only, per-asset rows (fetched with latest_only=true) — feeds the
    /// holdings table, allocation and FX exposure, which never need history.
    @State private var snapshots: [PortfolioSnapshotResponse] = []
    /// Pre-aggregated (date, sub-portfolio) totals across full history — feeds the
    /// equity curve, which never needs per-asset detail.
    @State private var timeseries: [PortfolioTimeseriesPoint] = []
    @State private var assets: [AssetResponse] = []
    @State private var subPortfolios: [SubPortfolioResponse] = []
    @State private var accounts: [AccountResponse] = []
    @State private var metrics: PortfolioMetricsResponse?
    @State private var isLoading = true
    @State private var showingAddTrade = false
    @State private var showingMoveCash = false
    @State private var showingNewGoal = false
    @State private var pricingAsset: AssetResponse?
    @State private var editingAsset: AssetResponse?
    @State private var range: GrowthRange = .all
    @State private var errorMessage: String?
    @State private var lastLoadedAt: Date?

    private var baseCurrency: String { session.activeHousehold?.baseCurrency ?? "USD" }

    /// Sub-portfolios visible under the current view mode (private/household/blended).
    private var visibleSubPortfolios: [SubPortfolioResponse] {
        subPortfolios.filter { viewModeStore.isVisible(ownerUserId: $0.ownerUserId, currentUserId: session.user?.id) }
    }

    private var visibleSubPortfolioIds: Set<String> {
        Set(visibleSubPortfolios.map(\.id))
    }

    /// Snapshots belonging to a sub-portfolio that's visible in the current view mode.
    private var visibleSnapshots: [PortfolioSnapshotResponse] {
        snapshots.filter { visibleSubPortfolioIds.contains($0.subPortfolioId) }
    }

    /// Holdings on the most recent snapshot date only.
    private var latestHoldings: [PortfolioSnapshotResponse] {
        guard let latest = visibleSnapshots.map(\.date).max() else { return [] }
        return visibleSnapshots.filter { $0.date == latest && $0.quantity > 0 }
    }

    private var totalValue: Double {
        latestHoldings.reduce(0) { $0 + $1.currentValueHomeCurrency }
    }

    /// Timeseries points belonging to a sub-portfolio that's visible in the current view mode.
    private var visibleTimeseries: [PortfolioTimeseriesPoint] {
        timeseries.filter { visibleSubPortfolioIds.contains($0.subPortfolioId) }
    }

    /// Total equity value over time across every visible sub-portfolio.
    private var curve: [GoalHistoryPoint] {
        equityCurve(snapshots: visibleTimeseries, range: range)
    }

    /// One group per sub-portfolio that either holds something or is a goal with a
    /// target. Each sub-portfolio is a "goal", so its target/progress renders here.
    private var holdingsBySubPortfolio: [(subPortfolio: SubPortfolioResponse, holdings: [PortfolioSnapshotResponse])] {
        visibleSubPortfolios.compactMap { sp in
            let holdings = latestHoldings
                .filter { $0.subPortfolioId == sp.id }
                .sorted { $0.currentValueHomeCurrency > $1.currentValueHomeCurrency }
            guard !holdings.isEmpty || sp.targetAmount != nil else { return nil }
            return (sp, holdings)
        }
    }

    private func currentValue(of holdings: [PortfolioSnapshotResponse]) -> Double {
        holdings.reduce(0) { $0 + $1.currentValueHomeCurrency }
    }

    // MARK: Allocation

    private var assetsById: [String: AssetResponse] {
        Dictionary(uniqueKeysWithValues: assets.map { ($0.id, $0) })
    }

    private var slices: [AllocationSlice] {
        allocationSlices(holdings: latestHoldings, assetsById: assetsById)
    }

    private var fx: [FXSlice] {
        fxExposure(holdings: latestHoldings, assetsById: assetsById, fallbackCurrency: baseCurrency)
    }

    // MARK: Performance grid

    /// Cost basis of the current holdings, in home currency.
    private var costBasisTotal: Double {
        latestHoldings.reduce(0) { $0 + $1.averageCostBasisHomeCurrency * $1.quantity }
    }

    var body: some View {
        NavigationStack {
            List {
                QuickAddPullSensor()
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Portfolio Value")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Text(totalValue.currency(baseCurrency))
                            .font(.system(.largeTitle, design: .rounded, weight: .bold))
                    }
                    .padding(.vertical, 4)

                    if !timeseries.isEmpty {
                        if curve.count > 1 {
                            GrowthChart(curve: curve, accent: session.theme.primary.accent, baseCurrency: baseCurrency)
                                .padding(.vertical, 4)
                        } else {
                            Text("Not enough history in this range.")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity, alignment: .center)
                                .padding(.vertical, 24)
                        }
                        // Stays visible even when the window is too sparse to draw —
                        // hiding it with the chart strands you on the empty range.
                        GrowthRangePicker(range: $range)
                    }

                }

                if !latestHoldings.isEmpty {
                    Section {
                        PerformanceTileGrid(
                            metrics: metrics?.overallMetrics,
                            unrealizedPL: totalValue - costBasisTotal,
                            costBasis: costBasisTotal,
                            baseCurrency: baseCurrency
                        )
                        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                        .listRowBackground(Color.clear)
                    } header: {
                        Text("Performance")
                    }
                }

                if !slices.isEmpty {
                    Section {
                        AllocationCard(
                            slices: slices,
                            holdingsCount: latestHoldings.count,
                            fxExposure: fx
                        )
                        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                    } header: {
                        Text("Allocation")
                    }
                }

                ForEach(holdingsBySubPortfolio, id: \.subPortfolio.id) { group in
                    Section {
                        // Drills into the per-sub-portfolio Growth / Holdings / Dividends
                        // tabs — the native counterpart of the web Portfolio tab bar.
                        NavigationLink {
                            SubPortfolioDetailView(subPortfolio: group.subPortfolio) { await load() }
                        } label: {
                            if group.subPortfolio.targetAmount != nil {
                                GoalProgressRow(
                                    currentValue: currentValue(of: group.holdings),
                                    targetAmount: group.subPortfolio.targetAmount,
                                    targetDate: group.subPortfolio.targetDate,
                                    accent: session.theme.primary.accent,
                                    baseCurrency: baseCurrency
                                )
                            } else {
                                Label("Growth, holdings & dividends", systemImage: "chart.xyaxis.line")
                            }
                        }

                        ForEach(group.holdings) { holding in
                            let asset = assetsById[holding.assetId]
                            let row = HoldingRow(holding: holding, asset: asset, baseCurrency: baseCurrency)
                            Group {
                                // Manually-priced assets (SSB, unlisted bonds) get a tap-to-record-price affordance.
                                if let asset, asset.isManualPriced {
                                    Button { pricingAsset = asset } label: { row }
                                        .buttonStyle(.plain)
                                } else {
                                    row
                                }
                            }
                            // Swipe to fix a ticker or currency entered wrong at
                            // creation. Cash and earmarked-account rows are derived
                            // from elsewhere, so they get no edit affordance.
                            .swipeActions(edge: .trailing) {
                                if let asset, !asset.isPseudoAsset {
                                    Button { editingAsset = asset } label: {
                                        Label("Edit", systemImage: "pencil")
                                    }
                                    .tint(.blue)
                                }
                            }
                        }
                    } header: {
                        HStack {
                            Text(group.subPortfolio.name)
                            if group.subPortfolio.ownerUserId != nil {
                                Image(systemName: "lock.fill").font(.caption2)
                            }
                            Spacer()
                            Text(currentValue(of: group.holdings).compactCurrency(baseCurrency))
                        }
                    }
                }

                Section {
                    NavigationLink {
                        TradesListView()
                    } label: {
                        Label("Trades", systemImage: "arrow.left.arrow.right")
                    }
                    NavigationLink {
                        DividendsView()
                    } label: {
                        Label("Dividends", systemImage: "dollarsign.circle")
                    }
                }
            }
            .navigationTitle("Portfolio")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { VaultLockButton() }
                ToolbarItem(placement: .topBarLeading) { ViewModeSwitcher() }
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button {
                            showingAddTrade = true
                        } label: {
                            Label("Log Trade", systemImage: "arrow.left.arrow.right")
                        }
                        .disabled(subPortfolios.isEmpty)
                        Button {
                            showingMoveCash = true
                        } label: {
                            Label("Move Cash", systemImage: "banknote")
                        }
                        .disabled(subPortfolios.isEmpty)
                        Divider()
                        Button {
                            showingNewGoal = true
                        } label: {
                            Label("New Goal / Sub-Portfolio", systemImage: "target")
                        }
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $showingAddTrade) {
                if let household = session.activeHousehold {
                    TradeFormView(
                        householdId: household.id,
                        subPortfolios: subPortfolios,
                        assets: assets,
                        accounts: accounts
                    ) {
                        await load()
                    }
                }
            }
            .sheet(isPresented: $showingMoveCash) {
                if let household = session.activeHousehold {
                    CashMoveFormView(
                        householdId: household.id,
                        subPortfolios: subPortfolios,
                        accounts: accounts
                    ) {
                        await load()
                    }
                }
            }
            .sheet(isPresented: $showingNewGoal) {
                if let household = session.activeHousehold {
                    GoalFormView(householdId: household.id) {
                        await load()
                    }
                }
            }
            .sheet(item: $editingAsset) { asset in
                AssetEditView(asset: asset) { await load() }
            }
            .sheet(item: $pricingAsset) { asset in
                if let household = session.activeHousehold {
                    RecordPriceView(asset: asset, householdId: household.id) {
                        await load()
                    }
                }
            }
            .overlay {
                if isLoading && snapshots.isEmpty {
                    LoadingSkeleton(showsHeader: true)
                } else if !isLoading && latestHoldings.isEmpty {
                    ContentUnavailableView(
                        "No Holdings",
                        systemImage: "chart.pie",
                        description: Text("Log trades on the web app and holdings will appear after the next snapshot.")
                    )
                }
            }
            .quickAddPull(quickAdd, onReload: load)
            .task { await loadIfNeeded() }
        }
    }

    /// Mirrors Dashboard's staleness guard: skip refetching on every tab
    /// reselect when the data was loaded moments ago. `onReload` (Quick Add)
    /// bypasses this and always forces a real reload after an edit.
    private static let stalenessWindow: TimeInterval = 30

    private func loadIfNeeded() async {
        if let lastLoadedAt, Date().timeIntervalSince(lastLoadedAt) < Self.stalenessWindow {
            return
        }
        await load()
    }

    private func load() async {
        guard let household = session.activeHousehold else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            async let snapshotsReq: [PortfolioSnapshotResponse] = APIClient.shared.get("/portfolio/snapshots/household/\(household.id)?latest_only=true")
            async let timeseriesReq: [PortfolioTimeseriesPoint] = APIClient.shared.get("/portfolio/snapshots/household/\(household.id)/timeseries")
            async let assetsReq: [AssetResponse] = APIClient.shared.get("/portfolio/assets")
            async let subPortfoliosReq: [SubPortfolioResponse] = APIClient.shared.get("/portfolio/subportfolios/household/\(household.id)")
            async let accountsReq: [AccountResponse] = APIClient.shared.get("/accounts/household/\(household.id)")
            async let metricsReq: PortfolioMetricsResponse = APIClient.shared.get("/portfolio/household/\(household.id)/metrics")
            (snapshots, timeseries, assets, subPortfolios, accounts, metrics) = try await (snapshotsReq, timeseriesReq, assetsReq, subPortfoliosReq, accountsReq, metricsReq)
            lastLoadedAt = Date()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// A compact stat card for the portfolio performance grid (and dashboard header).
struct StatTile: View {
    let title: String
    let value: String
    var subtitle: String? = nil
    var tint: Color = .primary

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Text(value)
                .font(.title3.monospacedDigit().weight(.semibold))
                .foregroundStyle(tint)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            if let subtitle {
                Text(subtitle)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color(.secondarySystemGroupedBackground)))
    }

    /// "1.23" for a risk ratio, or "N/A" when the backend has no value (no benchmark data).
    static func ratioString(_ value: Double?) -> String {
        value.map { String(format: "%.2f", $0) } ?? "N/A"
    }

    /// A signed percentage from a fraction, or "N/A" when absent.
    static func percentString(_ value: Double?) -> String {
        value.map(\.signedPercent) ?? "N/A"
    }

    /// Label for the basis a return is quoted on. The backend only annualizes
    /// TWR and MWR once the window spans at least a year; shorter windows carry
    /// the plain period return, and calling that "Ann." is how a 2% week ended
    /// up displayed as +180% (issue #256).
    static func returnBasis(_ annualized: Bool?) -> String {
        (annualized ?? false) ? "Ann." : "Period"
    }

    /// Green for gains, red for losses, primary for zero/absent.
    static func returnTint(_ value: Double?) -> Color {
        guard let value, value != 0 else { return .primary }
        return value > 0 ? .green : .red
    }
}

/// The portfolio performance stat grid — used household-wide on `PortfolioView` and
/// per-sub-portfolio on the `SubPortfolioDetailView` Growth tab, so the two always show
/// the same figures from the same `PerformanceMetrics`.
struct PerformanceTileGrid: View {
    let metrics: PerformanceMetrics?
    let unrealizedPL: Double
    let costBasis: Double
    let baseCurrency: String

    /// Adaptive rather than a fixed pair: 2 tiles wide on iPhone, 4+ on an iPad canvas.
    private let columns = [GridItem(.adaptive(minimum: 150), spacing: 10)]

    /// Prefer the backend's simple return; fall back to unrealized/cost basis (mirrors web).
    private var unrealizedPercent: Double {
        let simple = metrics?.simpleReturn ?? 0
        if simple != 0 { return simple }
        return costBasis > 0 ? unrealizedPL / costBasis : 0
    }

    private var divYieldString: String {
        guard let yield = metrics?.dividendYield else { return "—" }
        return yield.formatted(.percent.precision(.fractionLength(1)))
    }

    var body: some View {
        LazyVGrid(columns: columns, spacing: 10) {
            StatTile(
                title: "Unrealized P&L",
                value: unrealizedPL.currency(baseCurrency),
                subtitle: unrealizedPercent.signedPercent,
                tint: unrealizedPL >= 0 ? .green : .red
            )
            StatTile(title: "Div Yield", value: divYieldString)
            StatTile(title: "TWR (\(StatTile.returnBasis(metrics?.annualized)))", value: StatTile.percentString(metrics?.timeWeightedReturn), tint: StatTile.returnTint(metrics?.timeWeightedReturn))
            StatTile(title: "IRR / MWR (\(StatTile.returnBasis(metrics?.annualized)))", value: StatTile.percentString(metrics?.moneyWeightedReturn), tint: StatTile.returnTint(metrics?.moneyWeightedReturn))
            StatTile(title: "Sharpe", value: StatTile.ratioString(metrics?.sharpeRatio))
            StatTile(title: "Sortino", value: StatTile.ratioString(metrics?.sortinoRatio))
            StatTile(title: "Treynor", value: StatTile.ratioString(metrics?.treynorRatio), subtitle: "Beta \(StatTile.ratioString(metrics?.beta))")
            StatTile(title: "Jensen's α", value: StatTile.percentString(metrics?.alpha), subtitle: "vs SPY", tint: StatTile.returnTint(metrics?.alpha))
        }
    }
}

/// The shared equity curve: a wash under a 2pt line, y-axis in compact currency.
/// One series, so it keeps the household's accent — there is no second category for
/// it to be confused with. See `ChartStyle`.
struct GrowthChart: View {
    let curve: [GoalHistoryPoint]
    let accent: Color
    let baseCurrency: String
    var compactHeight: CGFloat = 160
    var regularHeight: CGFloat = 280

    private var span: TimeInterval? {
        guard let first = curve.first?.date, let last = curve.last?.date else { return nil }
        return last.timeIntervalSince(first)
    }

    var body: some View {
        Chart(curve) { point in
            AreaMark(x: .value("Date", point.date), y: .value("Value", point.value))
                .foregroundStyle(ChartStyle.accentFill(accent))
                .interpolationMethod(.monotone)
            LineMark(x: .value("Date", point.date), y: .value("Value", point.value))
                .foregroundStyle(accent)
                .lineStyle(StrokeStyle(lineWidth: ChartStyle.lineWidth, lineCap: .round, lineJoin: .round))
                .interpolationMethod(.monotone)
        }
        .financeChartAxes(currency: baseCurrency, dateSpan: span)
        .adaptiveChartHeight(compact: compactHeight, regular: regularHeight)
    }
}

/// 1M / 6M / 1Y / ALL window selector for a growth chart.
struct GrowthRangePicker: View {
    @Binding var range: GrowthRange

    var body: some View {
        Picker("Range", selection: $range) {
            ForEach(GrowthRange.allCases) { option in
                Text(option.rawValue).tag(option)
            }
        }
        .pickerStyle(.segmented)
        .listRowBackground(Color.clear)
    }
}

/// Allocation-by-asset-type donut + legend + FX-exposure chips. Native counterpart of the
/// web Portfolio "Allocation" card. Colours match the web's ALLOCATION_COLORS so the two
/// clients read the same. Uses Swift Charts `SectorMark` (a donut via inner radius).
struct AllocationCard: View {
    let slices: [AllocationSlice]
    let holdingsCount: Int
    let fxExposure: [FXSlice]

    /// Web ALLOCATION_COLORS, in order, so a given type gets the same hue on both clients.
    static let palette: [Color] = [
        Color(red: 0.220, green: 0.741, blue: 0.973), // #38bdf8
        Color(red: 0.290, green: 0.871, blue: 0.502), // #4ade80
        Color(red: 0.984, green: 0.749, blue: 0.141), // #fbbf24
        Color(red: 0.910, green: 0.475, blue: 0.976), // #e879f9
        Color(red: 0.957, green: 0.447, blue: 0.714), // #f472b6
        Color(red: 0.655, green: 0.545, blue: 0.980), // #a78bfa
        Color(red: 0.984, green: 0.573, blue: 0.235), // #fb923c
        Color(red: 0.176, green: 0.831, blue: 0.749), // #2dd4bf
    ]

    private func color(_ index: Int) -> Color { Self.palette[index % Self.palette.count] }

    var body: some View {
        VStack(spacing: 16) {
            Chart(Array(slices.enumerated()), id: \.element.id) { index, slice in
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
            .overlay {
                VStack(spacing: 0) {
                    Text("\(holdingsCount)")
                        .font(.title3.monospacedDigit().weight(.bold))
                    Text(holdingsCount == 1 ? "holding" : "holdings")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }

            VStack(spacing: 8) {
                ForEach(Array(slices.enumerated()), id: \.element.id) { index, slice in
                    HStack(spacing: 8) {
                        RoundedRectangle(cornerRadius: 3, style: .continuous)
                            .fill(color(index))
                            .frame(width: 11, height: 11)
                        Text(slice.label)
                            .font(.caption)
                        Spacer()
                        Text("\(Int(slice.pct.rounded()))%")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }
            }

            if !fxExposure.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("FX EXPOSURE")
                        .font(.caption2.weight(.semibold))
                        .tracking(1.2)
                        .foregroundStyle(.secondary)
                    HStack(spacing: 8) {
                        ForEach(fxExposure.prefix(4)) { fx in
                            Text("\(fx.currency) \(Int(fx.pct.rounded()))%")
                                .font(.caption.monospacedDigit().weight(.semibold))
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 6)
                                .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        }
                    }
                }
                .padding(.top, 4)
            }
        }
        .padding(.vertical, 4)
    }
}

struct HoldingRow: View {
    let holding: PortfolioSnapshotResponse
    let asset: AssetResponse?
    let baseCurrency: String

    private var costBasis: Double { holding.averageCostBasisHomeCurrency * holding.quantity }
    private var gain: Double { holding.currentValueHomeCurrency - costBasis }
    private var gainPercent: Double { costBasis > 0 ? gain / costBasis : 0 }

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(asset?.ticker ?? "—")
                    .font(.body.bold())
                Text(asset?.isCash == true
                     ? "Cash"
                     : "\(holding.quantity.formatted(.number.precision(.fractionLength(0...4)))) shares")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(holding.currentValueHomeCurrency.currency(baseCurrency))
                    .font(.body.monospacedDigit())
                if asset?.isCash != true {
                    Text(gainPercent.signedPercent)
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(gain >= 0 ? .green : .red)
                }
            }
        }
    }
}
