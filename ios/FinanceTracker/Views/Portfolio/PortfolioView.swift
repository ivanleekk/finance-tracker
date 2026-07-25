import SwiftUI
import Charts

struct PortfolioView: View {
    @Environment(SessionStore.self) private var session
    @Environment(QuickAddStore.self) private var quickAdd
    @Environment(ViewModeStore.self) private var viewModeStore

    @State private var snapshots: [PortfolioSnapshotResponse] = []
    @State private var assets: [AssetResponse] = []
    @State private var subPortfolios: [SubPortfolioResponse] = []
    @State private var accounts: [AccountResponse] = []
    @State private var metrics: PortfolioMetricsResponse?
    @State private var isLoading = true
    @State private var showingAddTrade = false
    @State private var showingMoveCash = false
    @State private var showingNewGoal = false
    @State private var pricingAsset: AssetResponse?
    @State private var errorMessage: String?

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

    /// Total equity value over time, from snapshot history.
    private var equityCurve: [(date: Date, value: Double)] {
        Dictionary(grouping: visibleSnapshots, by: \.date)
            .map { (date: $0.key, value: $0.value.reduce(0) { $0 + $1.currentValueHomeCurrency }) }
            .sorted { $0.date < $1.date }
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

    /// Current holdings sliced by asset type (stock/etf/cash/…), largest first, weighted by
    /// home-currency value so cross-currency holdings compare fairly (the web weights by
    /// native value; home currency is the more correct basis for a single pie). Mirrors the
    /// web Portfolio "Allocation" card.
    private var allocationSlices: [AllocationSlice] {
        var byType: [String: Double] = [:]
        var total = 0.0
        for h in latestHoldings {
            let value = h.currentValueHomeCurrency
            total += value
            let type = assetsById[h.assetId]?.type ?? "other"
            byType[type, default: 0] += value
        }
        guard total > 0 else { return [] }
        return byType
            .map { AllocationSlice(type: $0.key, value: $0.value, pct: $0.value / total * 100) }
            .sorted { $0.value > $1.value }
    }

    /// Currency exposure of current holdings, by each asset's own currency, as % of value.
    private var fxExposure: [(currency: String, pct: Double)] {
        var byCurrency: [String: Double] = [:]
        var total = 0.0
        for h in latestHoldings {
            let value = h.currentValueHomeCurrency
            total += value
            let currency = assetsById[h.assetId]?.currency ?? baseCurrency
            byCurrency[currency, default: 0] += value
        }
        guard total > 0 else { return [] }
        return byCurrency
            .map { (currency: $0.key, pct: $0.value / total * 100) }
            .sorted { $0.pct > $1.pct }
    }

    // MARK: Performance grid

    /// Adaptive rather than a fixed pair: 2 tiles wide on iPhone, 4+ on an iPad canvas.
    private let statColumns = [GridItem(.adaptive(minimum: 150), spacing: 10)]

    /// Cost basis of the current holdings, in home currency.
    private var costBasisTotal: Double {
        latestHoldings.reduce(0) { $0 + $1.averageCostBasisHomeCurrency * $1.quantity }
    }

    private var unrealizedPL: Double { totalValue - costBasisTotal }

    /// Prefer the backend's simple return; fall back to unrealized/cost basis (mirrors web).
    private var unrealizedPercent: Double {
        let simple = metrics?.overallMetrics.simpleReturn ?? 0
        if simple != 0 { return simple }
        return costBasisTotal > 0 ? unrealizedPL / costBasisTotal : 0
    }

    private var divYieldString: String {
        guard let yield = metrics?.overallMetrics.dividendYield else { return "—" }
        return yield.formatted(.percent.precision(.fractionLength(1)))
    }

    @ViewBuilder private var performanceTiles: some View {
        let m = metrics?.overallMetrics
        StatTile(
            title: "Unrealized P&L",
            value: unrealizedPL.currency(baseCurrency),
            subtitle: unrealizedPercent.signedPercent,
            tint: unrealizedPL >= 0 ? .green : .red
        )
        StatTile(title: "Div Yield", value: divYieldString)
        StatTile(title: "TWR (Ann.)", value: StatTile.percentString(m?.timeWeightedReturn), tint: StatTile.returnTint(m?.timeWeightedReturn))
        StatTile(title: "IRR / MWR", value: StatTile.percentString(m?.moneyWeightedReturn), tint: StatTile.returnTint(m?.moneyWeightedReturn))
        StatTile(title: "Sharpe", value: StatTile.ratioString(m?.sharpeRatio))
        StatTile(title: "Sortino", value: StatTile.ratioString(m?.sortinoRatio))
        StatTile(title: "Treynor", value: StatTile.ratioString(m?.treynorRatio), subtitle: "Beta \(StatTile.ratioString(m?.beta))")
        StatTile(title: "Jensen's α", value: StatTile.percentString(m?.alpha), subtitle: "vs SPY", tint: StatTile.returnTint(m?.alpha))
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

                    if equityCurve.count > 1 {
                        Chart(equityCurve, id: \.date) { point in
                            LineMark(x: .value("Date", point.date), y: .value("Value", point.value))
                                .foregroundStyle(session.theme.primary.accent)
                                .interpolationMethod(.monotone)
                        }
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
                        .adaptiveChartHeight(compact: 160, regular: 280)
                        .padding(.vertical, 4)
                    }

                }

                if !latestHoldings.isEmpty {
                    Section {
                        LazyVGrid(columns: statColumns, spacing: 10) {
                            performanceTiles
                        }
                        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                        .listRowBackground(Color.clear)
                    } header: {
                        Text("Performance")
                    }
                }

                if !allocationSlices.isEmpty {
                    Section {
                        AllocationCard(
                            slices: allocationSlices,
                            holdingsCount: latestHoldings.count,
                            fxExposure: fxExposure
                        )
                        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                    } header: {
                        Text("Allocation")
                    }
                }

                ForEach(holdingsBySubPortfolio, id: \.subPortfolio.id) { group in
                    Section {
                        // Goal target/progress for this sub-portfolio; tap for the full goal page.
                        NavigationLink {
                            GoalDetailView(goal: group.subPortfolio) { await load() }
                        } label: {
                            GoalProgressRow(
                                currentValue: currentValue(of: group.holdings),
                                targetAmount: group.subPortfolio.targetAmount,
                                targetDate: group.subPortfolio.targetDate,
                                accent: session.theme.primary.accent,
                                baseCurrency: baseCurrency
                            )
                        }

                        ForEach(group.holdings) { holding in
                            let asset = assets.first { $0.id == holding.assetId }
                            let row = HoldingRow(holding: holding, asset: asset, baseCurrency: baseCurrency)
                            // Manually-priced assets (SSB, unlisted bonds) get a tap-to-record-price affordance.
                            if let asset, asset.isManualPriced {
                                Button { pricingAsset = asset } label: { row }
                                    .buttonStyle(.plain)
                            } else {
                                row
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
            .task { await load() }
        }
    }

    private func load() async {
        guard let household = session.activeHousehold else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            async let snapshotsReq: [PortfolioSnapshotResponse] = APIClient.shared.get("/portfolio/snapshots/household/\(household.id)")
            async let assetsReq: [AssetResponse] = APIClient.shared.get("/portfolio/assets")
            async let subPortfoliosReq: [SubPortfolioResponse] = APIClient.shared.get("/portfolio/subportfolios/household/\(household.id)")
            async let accountsReq: [AccountResponse] = APIClient.shared.get("/accounts/household/\(household.id)")
            async let metricsReq: PortfolioMetricsResponse = APIClient.shared.get("/portfolio/household/\(household.id)/metrics")
            (snapshots, assets, subPortfolios, accounts, metrics) = try await (snapshotsReq, assetsReq, subPortfoliosReq, accountsReq, metricsReq)
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

    /// Green for gains, red for losses, primary for zero/absent.
    static func returnTint(_ value: Double?) -> Color {
        guard let value, value != 0 else { return .primary }
        return value > 0 ? .green : .red
    }
}

/// One wedge of the allocation donut: an asset type, its home-currency value, and share.
struct AllocationSlice: Identifiable {
    let type: String
    let value: Double
    let pct: Double
    var id: String { type }

    /// "time_locked" → "Time Locked" for the legend.
    var label: String {
        type.replacingOccurrences(of: "_", with: " ")
            .split(separator: " ")
            .map { $0.prefix(1).uppercased() + $0.dropFirst() }
            .joined(separator: " ")
    }
}

/// Allocation-by-asset-type donut + legend + FX-exposure chips. Native counterpart of the
/// web Portfolio "Allocation" card. Colours match the web's ALLOCATION_COLORS so the two
/// clients read the same. Uses Swift Charts `SectorMark` (a donut via inner radius).
struct AllocationCard: View {
    let slices: [AllocationSlice]
    let holdingsCount: Int
    let fxExposure: [(currency: String, pct: Double)]

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
                        ForEach(fxExposure.prefix(4), id: \.currency) { fx in
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
