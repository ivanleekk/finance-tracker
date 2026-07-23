import SwiftUI
import Charts

struct PortfolioView: View {
    @Environment(SessionStore.self) private var session
    @Environment(QuickAddStore.self) private var quickAdd

    @State private var snapshots: [PortfolioSnapshotResponse] = []
    @State private var assets: [AssetResponse] = []
    @State private var subPortfolios: [SubPortfolioResponse] = []
    @State private var accounts: [AccountResponse] = []
    @State private var metrics: PortfolioMetricsResponse?
    @State private var isLoading = true
    @State private var showingAddTrade = false
    @State private var showingMoveCash = false
    @State private var pricingAsset: AssetResponse?
    @State private var editingGoal: SubPortfolioResponse?
    @State private var errorMessage: String?

    private var baseCurrency: String { session.activeHousehold?.baseCurrency ?? "USD" }

    /// Holdings on the most recent snapshot date only.
    private var latestHoldings: [PortfolioSnapshotResponse] {
        guard let latest = snapshots.map(\.date).max() else { return [] }
        return snapshots.filter { $0.date == latest && $0.quantity > 0 }
    }

    private var totalValue: Double {
        latestHoldings.reduce(0) { $0 + $1.currentValueHomeCurrency }
    }

    /// Total equity value over time, from snapshot history.
    private var equityCurve: [(date: Date, value: Double)] {
        Dictionary(grouping: snapshots, by: \.date)
            .map { (date: $0.key, value: $0.value.reduce(0) { $0 + $1.currentValueHomeCurrency }) }
            .sorted { $0.date < $1.date }
    }

    /// One group per sub-portfolio that either holds something or is a goal with a
    /// target. Each sub-portfolio is a "goal", so its target/progress renders here.
    private var holdingsBySubPortfolio: [(subPortfolio: SubPortfolioResponse, holdings: [PortfolioSnapshotResponse])] {
        subPortfolios.compactMap { sp in
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

    var body: some View {
        NavigationStack {
            List {
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
                        .frame(height: 160)
                        .padding(.vertical, 4)
                    }

                    if let overall = metrics?.overallMetrics {
                        HStack {
                            MetricCell(title: "Simple", value: overall.simpleReturn)
                            Divider()
                            MetricCell(title: "TWR", value: overall.timeWeightedReturn)
                            Divider()
                            MetricCell(title: "MWR", value: overall.moneyWeightedReturn)
                        }
                    }
                }

                ForEach(holdingsBySubPortfolio, id: \.subPortfolio.id) { group in
                    Section {
                        // Goal target/progress for this sub-portfolio; tap to set or edit.
                        Button {
                            editingGoal = group.subPortfolio
                        } label: {
                            GoalProgressRow(
                                currentValue: currentValue(of: group.holdings),
                                targetAmount: group.subPortfolio.targetAmount,
                                targetDate: group.subPortfolio.targetDate,
                                accent: session.theme.primary.accent,
                                baseCurrency: baseCurrency
                            )
                        }
                        .buttonStyle(.plain)

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
                        DividendsView()
                    } label: {
                        Label("Dividends", systemImage: "dollarsign.circle")
                    }
                }
            }
            .navigationTitle("Portfolio")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button {
                            showingAddTrade = true
                        } label: {
                            Label("Log Trade", systemImage: "arrow.left.arrow.right")
                        }
                        Button {
                            showingMoveCash = true
                        } label: {
                            Label("Move Cash", systemImage: "banknote")
                        }
                    } label: {
                        Image(systemName: "plus")
                    }
                    .disabled(subPortfolios.isEmpty)
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
            .sheet(item: $pricingAsset) { asset in
                if let household = session.activeHousehold {
                    RecordPriceView(asset: asset, householdId: household.id) {
                        await load()
                    }
                }
            }
            .sheet(item: $editingGoal) { goal in
                GoalTargetEditView(subPortfolio: goal) { await load() }
            }
            .overlay {
                if isLoading && snapshots.isEmpty {
                    ProgressView()
                } else if !isLoading && latestHoldings.isEmpty {
                    ContentUnavailableView(
                        "No Holdings",
                        systemImage: "chart.pie",
                        description: Text("Log trades on the web app and holdings will appear after the next snapshot.")
                    )
                }
            }
            .pullDownToQuickAdd(quickAdd, onReload: load)
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

private struct MetricCell: View {
    let title: String
    let value: Double

    var body: some View {
        VStack(spacing: 2) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value.signedPercent)
                .font(.subheadline.monospacedDigit().bold())
                .foregroundStyle(value >= 0 ? .green : .red)
        }
        .frame(maxWidth: .infinity)
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
