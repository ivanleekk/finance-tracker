import SwiftUI
import Charts

struct PortfolioView: View {
    @Environment(SessionStore.self) private var session

    @State private var snapshots: [PortfolioSnapshotResponse] = []
    @State private var assets: [AssetResponse] = []
    @State private var subPortfolios: [SubPortfolioResponse] = []
    @State private var accounts: [AccountResponse] = []
    @State private var metrics: PortfolioMetricsResponse?
    @State private var isLoading = true
    @State private var showingAddTrade = false
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

    private var holdingsBySubPortfolio: [(subPortfolio: SubPortfolioResponse, holdings: [PortfolioSnapshotResponse])] {
        subPortfolios.compactMap { sp in
            let holdings = latestHoldings
                .filter { $0.subPortfolioId == sp.id }
                .sorted { $0.currentValueHomeCurrency > $1.currentValueHomeCurrency }
            return holdings.isEmpty ? nil : (sp, holdings)
        }
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
                        ForEach(group.holdings) { holding in
                            HoldingRow(
                                holding: holding,
                                asset: assets.first { $0.id == holding.assetId },
                                baseCurrency: baseCurrency
                            )
                        }
                    } header: {
                        HStack {
                            Text(group.subPortfolio.name)
                            if group.subPortfolio.ownerUserId != nil {
                                Image(systemName: "lock.fill").font(.caption2)
                            }
                            Spacer()
                            Text(group.holdings.reduce(0) { $0 + $1.currentValueHomeCurrency }
                                .compactCurrency(baseCurrency))
                        }
                    }
                }
            }
            .navigationTitle("Portfolio")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showingAddTrade = true
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel("Log Trade")
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
            .refreshable { await load() }
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

private struct HoldingRow: View {
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
