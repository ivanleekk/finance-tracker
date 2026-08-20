import SwiftUI
import Charts

/// One sub-portfolio, scoped to Growth / Holdings / Dividends.
///
/// This is the native counterpart of the web Portfolio page's sub-portfolio tab bar. The
/// web puts every sub-portfolio behind a row of tabs on one page and re-scopes the whole
/// page — equity curve, metrics, allocation, holdings table and dividend table — to
/// whichever is selected. A tab strip that grows with the number of sub-portfolios doesn't
/// survive a phone width, so the same scoping happens here as a drill-in from the Portfolio
/// list, with a three-way segmented control standing in for the web's stacked cards.
///
/// "Overall" isn't a tab here: `PortfolioView` itself *is* the overall view.
struct SubPortfolioDetailView: View {
    @Environment(SessionStore.self) private var session
    @Environment(QuickAddStore.self) private var quickAdd

    enum DetailSection: String, CaseIterable, Identifiable {
        case growth = "Growth"
        case holdings = "Holdings"
        case dividends = "Dividends"
        var id: String { rawValue }
    }

    let subPortfolio: SubPortfolioResponse
    /// Lets the Portfolio tab refresh after a trade, cash move or edit made in here.
    var onChanged: () async -> Void = {}

    @State private var sp: SubPortfolioResponse
    @State private var section: DetailSection = .growth
    @State private var range: GrowthRange = .all
    /// Latest-date-only, per-asset rows (fetched with latest_only=true) — feeds the
    /// holdings list, which never needs history.
    @State private var snapshots: [PortfolioSnapshotResponse] = []
    /// Pre-aggregated (date, sub-portfolio) totals across full history — feeds the
    /// equity curve, which never needs per-asset detail.
    @State private var timeseries: [PortfolioTimeseriesPoint] = []
    @State private var assets: [AssetResponse] = []
    @State private var dividends: [DividendResponse] = []
    @State private var accounts: [AccountResponse] = []
    @State private var metrics: PerformanceMetrics?
    @State private var isLoading = true
    @State private var showingAddTrade = false
    @State private var showingMoveCash = false
    @State private var showingEdit = false
    @State private var pricingAsset: AssetResponse?
    @State private var editingAsset: AssetResponse?
    @State private var errorMessage: String?

    init(subPortfolio: SubPortfolioResponse, onChanged: @escaping () async -> Void = {}) {
        self.subPortfolio = subPortfolio
        self.onChanged = onChanged
        _sp = State(initialValue: subPortfolio)
    }

    private var baseCurrency: String { session.activeHousehold?.baseCurrency ?? "USD" }
    private var accent: Color { session.theme.primary.accent }

    private var assetsById: [String: AssetResponse] {
        Dictionary(uniqueKeysWithValues: assets.map { ($0.id, $0) })
    }

    /// Snapshots for this sub-portfolio only — everything on this screen is scoped by it.
    private var ownSnapshots: [PortfolioSnapshotResponse] {
        snapshots.filter { $0.subPortfolioId == sp.id }
    }

    /// Positions as of the most recent snapshot date, largest first.
    private var latestHoldings: [PortfolioSnapshotResponse] {
        guard let latest = ownSnapshots.map(\.date).max() else { return [] }
        return ownSnapshots
            .filter { $0.date == latest && $0.quantity > 0 }
            .sorted { $0.currentValueHomeCurrency > $1.currentValueHomeCurrency }
    }

    private var totalValue: Double {
        latestHoldings.reduce(0) { $0 + $1.currentValueHomeCurrency }
    }

    private var costBasisTotal: Double {
        latestHoldings.reduce(0) { $0 + $1.averageCostBasisHomeCurrency * $1.quantity }
    }

    /// Uninvested cash sitting in this sub-portfolio (the `CASH.<CUR>` pseudo-asset).
    private var cashValue: Double {
        latestHoldings
            .filter { assetsById[$0.assetId]?.isCash == true }
            .reduce(0) { $0 + $1.currentValueHomeCurrency }
    }

    private var curve: [GoalHistoryPoint] {
        equityCurve(snapshots: timeseries, subPortfolioId: sp.id, range: range)
    }

    private var ownDividends: [DividendResponse] {
        dividends.filter { $0.subPortfolioId == sp.id }.sorted { $0.date > $1.date }
    }

    private var dividendTotal: Double {
        ownDividends.reduce(0) { $0 + ($1.amountHomeCurrency ?? $1.amount) }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                headerCard
                Picker("Section", selection: $section) {
                    ForEach(DetailSection.allCases) { option in
                        Text(option.rawValue).tag(option)
                    }
                }
                .pickerStyle(.segmented)

                switch section {
                case .growth: growthSection
                case .holdings: holdingsSection
                case .dividends: dividendsSection
                }
            }
            .padding(16)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(sp.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button { showingAddTrade = true } label: { Label("Log Trade", systemImage: "arrow.left.arrow.right") }
                    Button { showingMoveCash = true } label: { Label("Move Cash", systemImage: "banknote") }
                    Divider()
                    Button { showingEdit = true } label: { Label("Edit", systemImage: "pencil") }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .sheet(isPresented: $showingAddTrade) {
            if let household = session.activeHousehold {
                // Pin the sub-portfolio picker to this one so the trade lands here.
                TradeFormView(householdId: household.id, subPortfolios: [sp], assets: assets, accounts: accounts) {
                    await reloadAll()
                }
            }
        }
        .sheet(isPresented: $showingMoveCash) {
            if let household = session.activeHousehold {
                CashMoveFormView(householdId: household.id, subPortfolios: [sp], accounts: accounts) {
                    await reloadAll()
                }
            }
        }
        .sheet(isPresented: $showingEdit) {
            GoalFormView(existing: sp) { await reloadAll() }
        }
        .sheet(item: $pricingAsset) { asset in
            if let household = session.activeHousehold {
                RecordPriceView(asset: asset, householdId: household.id) { await reloadAll() }
            }
        }
        .sheet(item: $editingAsset) { asset in
            AssetFormView(existing: asset, defaultCurrency: baseCurrency) { _ in
                Task { await reloadAll() }
            }
        }
        .overlay {
            if isLoading && snapshots.isEmpty {
                LoadingSkeleton(showsHeader: true)
            }
        }
        .quickAddPull(quickAdd, onReload: reload)
        .task { await reload() }
        .alert("Error", isPresented: .init(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage ?? "")
        }
    }

    // MARK: - Header

    private var headerCard: some View {
        DetailCard {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Text("Value")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    if sp.ownerUserId != nil {
                        Image(systemName: "lock.fill").font(.caption2).foregroundStyle(.secondary)
                    }
                    Spacer()
                    if let risk = sp.riskProfile {
                        Text(risk.uppercased())
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(Capsule().fill(Color(.tertiarySystemGroupedBackground)))
                    }
                }
                Text(totalValue.currency(baseCurrency))
                    .font(.system(.largeTitle, design: .rounded, weight: .bold))
                HStack(spacing: 10) {
                    if let change = periodChange(for: curve) {
                        let percent = change.fraction.map { " (\($0.signedPercent))" } ?? ""
                        Text("\(change.delta >= 0 ? "+" : "")\(change.delta.currency(baseCurrency))\(percent)")
                            .font(.subheadline.monospacedDigit())
                            .foregroundStyle(change.delta >= 0 ? .green : .red)
                        Text("· \(range.rawValue)")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    if cashValue > 0 {
                        Spacer()
                        Text("\(cashValue.compactCurrency(baseCurrency)) cash")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: - Growth

    @ViewBuilder private var growthSection: some View {
        DetailCard(title: "Growth") {
            if curve.count > 1 {
                GrowthChart(curve: curve, accent: accent, baseCurrency: baseCurrency, compactHeight: 200, regularHeight: 300)
                GrowthRangePicker(range: $range)
            } else {
                emptyNote("Not enough snapshot history to chart yet. Snapshots are recorded daily.")
            }
        }

        if !latestHoldings.isEmpty {
            DetailCard(title: "Performance") {
                PerformanceTileGrid(
                    metrics: metrics,
                    unrealizedPL: totalValue - costBasisTotal,
                    costBasis: costBasisTotal,
                    baseCurrency: baseCurrency
                )
            }
        }

        // Every sub-portfolio can be a goal; show progress and a way through to the full
        // projection page only when a target has actually been set.
        if sp.targetAmount != nil {
            DetailCard(title: "Goal") {
                GoalProgressRow(
                    currentValue: totalValue,
                    targetAmount: sp.targetAmount,
                    targetDate: sp.targetDate,
                    accent: session.theme.secondary.accent,
                    baseCurrency: baseCurrency
                )
                NavigationLink {
                    GoalDetailView(goal: sp) { await reloadAll() }
                } label: {
                    HStack {
                        Text("Projection & funding").font(.subheadline)
                        Spacer()
                        Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
                    }
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: - Holdings

    @ViewBuilder private var holdingsSection: some View {
        let slices = allocationSlices(holdings: latestHoldings, assetsById: assetsById)
        if !slices.isEmpty {
            DetailCard(title: "Allocation") {
                AllocationCard(
                    slices: slices,
                    holdingsCount: latestHoldings.count,
                    fxExposure: fxExposure(holdings: latestHoldings, assetsById: assetsById, fallbackCurrency: baseCurrency)
                )
            }
        }

        DetailCard(title: "Holdings") {
            if latestHoldings.isEmpty {
                emptyNote("No active holdings. Log a trade to build this sub-portfolio.")
            } else {
                ForEach(Array(latestHoldings.enumerated()), id: \.element.id) { index, holding in
                    if index > 0 { Divider() }
                    DetailedHoldingRow(
                        holding: holding,
                        asset: assetsById[holding.assetId],
                        baseCurrency: baseCurrency,
                        onTrade: { showingAddTrade = true },
                        onRecordPrice: { pricingAsset = assetsById[holding.assetId] },
                        onEditAsset: { editingAsset = assetsById[holding.assetId] },
                        onManageCash: { showingMoveCash = true }
                    )
                }
            }
        }
    }

    // MARK: - Dividends

    @ViewBuilder private var dividendsSection: some View {
        DetailCard(title: "Dividend income") {
            HStack(alignment: .top, spacing: 12) {
                GoalStat(title: "Total received", value: dividendTotal.currency(baseCurrency), tint: .green)
                GoalStat(
                    title: "Trailing yield",
                    value: metrics?.dividendYield.map { $0.formatted(.percent.precision(.fractionLength(2))) } ?? "—"
                )
                GoalStat(title: "Payouts", value: "\(ownDividends.count)")
            }

            if ownDividends.isEmpty {
                emptyNote("No dividends recorded yet. Auto-tracked payouts credit this sub-portfolio's cash.")
            } else {
                Divider()
                ForEach(ownDividends) { dividend in
                    DividendDetailRow(
                        dividend: dividend,
                        ticker: assetsById[dividend.assetId]?.ticker ?? "—",
                        baseCurrency: baseCurrency
                    )
                }
            }
        }
    }

    private func emptyNote(_ text: String) -> some View {
        Text(text)
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
    }

    // MARK: - Data

    /// After a mutation made on this screen (trade, cash move, edit, price): refresh here
    /// *and* tell the Portfolio list, whose totals just changed. Plain `reload()` stays
    /// parent-free so simply opening this screen doesn't re-fetch the whole tab behind it.
    private func reloadAll() async {
        await reload()
        await onChanged()
    }

    private func reload() async {
        guard let household = session.activeHousehold else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            async let spReq: SubPortfolioResponse = APIClient.shared.get("/portfolio/subportfolios/\(sp.id)")
            async let snapshotsReq: [PortfolioSnapshotResponse] = APIClient.shared.get("/portfolio/snapshots/household/\(household.id)?latest_only=true")
            async let timeseriesReq: [PortfolioTimeseriesPoint] = APIClient.shared.get("/portfolio/snapshots/household/\(household.id)/timeseries")
            async let assetsReq: [AssetResponse] = APIClient.shared.get("/portfolio/assets")
            async let dividendsReq: [DividendResponse] = APIClient.shared.get("/portfolio/dividends/household/\(household.id)")
            async let accountsReq: [AccountResponse] = APIClient.shared.get("/accounts/household/\(household.id)")
            async let metricsReq: PortfolioMetricsResponse = APIClient.shared.get("/portfolio/household/\(household.id)/metrics")

            let all: PortfolioMetricsResponse
            (sp, snapshots, timeseries, assets, dividends, accounts, all) =
                try await (spReq, snapshotsReq, timeseriesReq, assetsReq, dividendsReq, accountsReq, metricsReq)
            metrics = all.subPortfolioMetrics.first { $0.subPortfolioId == sp.id }?.metrics
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// A holding with the detail the web's holdings table shows: shares, average cost and
/// price in both the asset's own currency and the household's, plus the total return.
/// Actions (trade / record price / manage cash) hang off a trailing menu because this
/// renders in a card stack rather than a swipeable `List`.
struct DetailedHoldingRow: View {
    let holding: PortfolioSnapshotResponse
    let asset: AssetResponse?
    let baseCurrency: String
    var onTrade: () -> Void
    var onRecordPrice: () -> Void
    var onEditAsset: () -> Void
    var onManageCash: () -> Void

    private var isCash: Bool { asset?.isCash == true }
    private var currency: String { asset?.currency ?? baseCurrency }
    private var isForeign: Bool { currency != baseCurrency }
    private var costBasis: Double { holding.averageCostBasisHomeCurrency * holding.quantity }
    private var gain: Double { holding.currentValueHomeCurrency - costBasis }
    private var gainPercent: Double { costBasis > 0 ? gain / costBasis : 0 }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(asset?.ticker ?? "—").font(.body.bold())
                if isForeign {
                    Text(currency)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(Capsule().fill(Color(.tertiarySystemGroupedBackground)))
                }
                Spacer()
                Text(holding.currentValueHomeCurrency.currency(baseCurrency))
                    .font(.body.monospacedDigit().weight(.semibold))
            }

            if let name = asset?.name, !name.isEmpty, name != asset?.ticker {
                Text(name).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }

            if isCash {
                HStack {
                    Text("Uninvested cash").font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button("Manage", action: onManageCash).font(.caption)
                }
            } else {
                HStack(alignment: .top, spacing: 12) {
                    holdingFigure("Shares", holding.quantity.formatted(.number.precision(.fractionLength(0...4))))
                    holdingFigure("Avg cost", holding.averageCostBasis.currency(currency), sub: isForeign ? "≈ \(holding.averageCostBasisHomeCurrency.currency(baseCurrency))" : nil)
                    holdingFigure("Price", holding.price.currency(currency), sub: isForeign ? "≈ \((holding.price * holding.exchangeRateUsed).currency(baseCurrency))" : nil)
                }
                HStack {
                    Text("\(gain >= 0 ? "+" : "")\(gain.currency(baseCurrency)) (\(gainPercent.signedPercent))")
                        .font(.caption.monospacedDigit().weight(.medium))
                        .foregroundStyle(gain >= 0 ? .green : .red)
                    Spacer()
                    Menu {
                        Button { onTrade() } label: { Label("Log Trade", systemImage: "arrow.left.arrow.right") }
                        if asset?.isManualPriced == true {
                            Button { onRecordPrice() } label: { Label("Record Price", systemImage: "tag") }
                        }
                        // Fixes a mistyped ticker after the fact — the correction follows
                        // through to every trade and dividend filed against this asset.
                        Button { onEditAsset() } label: { Label("Edit Asset", systemImage: "pencil") }
                    } label: {
                        Image(systemName: "ellipsis.circle").foregroundStyle(.secondary)
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func holdingFigure(_ title: String, _ value: String, sub: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(title.uppercased())
                .font(.caption2.weight(.medium))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.caption.monospacedDigit())
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            if let sub {
                Text(sub)
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One dividend payout, matching the columns of the web's dividend table.
struct DividendDetailRow: View {
    let dividend: DividendResponse
    let ticker: String
    let baseCurrency: String

    var body: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 5) {
                    Text(ticker).font(.subheadline.weight(.semibold))
                    if dividend.isManual == true {
                        Text("MANUAL")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1)
                            .background(Capsule().fill(Color(.tertiarySystemGroupedBackground)))
                    }
                }
                Text(detailLine)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Text("+" + (dividend.amountHomeCurrency ?? dividend.amount).currency(baseCurrency))
                .font(.subheadline.monospacedDigit().weight(.medium))
                .foregroundStyle(.green)
        }
        .padding(.vertical, 3)
    }

    /// "12 Mar 2026 · 1.42/share × 150" — the per-share and share-count columns fold into
    /// the date line, since five columns don't fit a phone.
    private var detailLine: String {
        var parts = [dividend.date.formatted(date: .abbreviated, time: .omitted)]
        if let perShare = dividend.perShareAmount, let quantity = dividend.quantity {
            parts.append("\(perShare.formatted(.number.precision(.fractionLength(0...4))))/share × \(quantity.formatted(.number.precision(.fractionLength(0...4))))")
        }
        return parts.joined(separator: " · ")
    }
}
