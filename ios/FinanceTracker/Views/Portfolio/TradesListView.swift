import SwiftUI

/// Individual buy/sell trades, newest first, grouped by month. Tap a trade to edit it
/// (PUT /portfolio/trades/{id}); swipe to delete (confirmed first). Reached from the Portfolio tab.
/// Cash deposit/withdraw legs (the CASH pseudo-asset) are hidden — this is real trades.
struct TradesListView: View {
    @Environment(SessionStore.self) private var session
    @Environment(QuickAddStore.self) private var quickAdd
    @Environment(ViewModeStore.self) private var viewModeStore

    @State private var trades: [TradeResponse] = []
    @State private var assets: [AssetResponse] = []
    @State private var subPortfolios: [SubPortfolioResponse] = []
    @State private var accounts: [AccountResponse] = []
    @State private var isLoading = true
    @State private var editingTrade: TradeResponse?
    @State private var errorMessage: String?
    // Confirmation state on the screen, not the row — a dialog presented from inside a
    // swipe-actions row is torn down with the row's collapse animation before it shows.
    @State private var pendingDelete: TradeResponse?

    private func asset(_ id: String?) -> AssetResponse? {
        id.flatMap { aid in assets.first { $0.id == aid } }
    }

    private func subPortfolioName(_ id: String?) -> String? {
        id.flatMap { sid in subPortfolios.first { $0.id == sid }?.name }
    }

    /// Sub-portfolios visible under the current view mode.
    private var visibleSubPortfolioIds: Set<String> {
        Set(subPortfolios
            .filter { viewModeStore.isVisible(ownerUserId: $0.ownerUserId, currentUserId: session.user?.id) }
            .map(\.id))
    }

    /// Real (non-cash) trades in a visible sub-portfolio.
    private var visibleTrades: [TradeResponse] {
        trades.filter { trade in
            asset(trade.assetId)?.isCash != true
                && (trade.subPortfolioId.map { visibleSubPortfolioIds.contains($0) } ?? true)
        }
    }

    private var byMonth: [(month: Date, trades: [TradeResponse])] {
        Dictionary(grouping: visibleTrades.sorted { $0.date > $1.date }) { trade in
            Calendar.current.dateInterval(of: .month, for: trade.date)?.start ?? trade.date
        }
        .map { (month: $0.key, trades: $0.value) }
        .sorted { $0.month > $1.month }
    }

    var body: some View {
        List {
            QuickAddPullSensor()
            ForEach(byMonth, id: \.month) { group in
                Section(group.month.monthYear) {
                    ForEach(group.trades) { trade in
                        Button { editingTrade = trade } label: {
                            TradeRow(
                                trade: trade,
                                asset: asset(trade.assetId),
                                subPortfolioName: subPortfolioName(trade.subPortfolioId)
                            )
                        }
                        .buttonStyle(.plain)
                        // Not `.onDelete`: deleting a trade replays every portfolio
                        // snapshot from its date forward, with no undo — too much to
                        // hang off an accidental full swipe.
                        .swipeActions(allowsFullSwipe: false) {
                            Button(role: .destructive) {
                                pendingDelete = trade
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                        // Same actions on a long press: a swipe is invisible until you
                        // try it, and unreachable from Voice Control / Switch Control.
                        .contextMenu {
                            Button { editingTrade = trade } label: {
                                Label("Edit", systemImage: "pencil")
                            }
                            Button(role: .destructive) { pendingDelete = trade } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Trades")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $editingTrade) { trade in
            if let household = session.activeHousehold {
                TradeFormView(
                    existing: trade,
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
            if isLoading && trades.isEmpty {
                LoadingSkeleton()
            } else if !isLoading && visibleTrades.isEmpty {
                ContentUnavailableView(
                    "No Trades",
                    systemImage: "arrow.left.arrow.right",
                    description: Text("Log a trade from the Portfolio tab's + menu.")
                )
            }
        }
        .quickAddPull(quickAdd, onReload: load)
        .confirmationDialog(
            "Delete this trade?",
            isPresented: .init(
                get: { pendingDelete != nil },
                set: { if !$0 { pendingDelete = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let trade = pendingDelete {
                    delete([trade], at: IndexSet(integer: 0))
                }
            }
        } message: {
            Text("Holdings and portfolio history are recalculated from this trade's date. This can't be undone.")
        }
        .task { await load() }
        .alert("Error", isPresented: .init(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("Retry") { Task { await load() } }
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private func delete(_ group: [TradeResponse], at offsets: IndexSet) {
        let targets = offsets.map { group[$0] }
        Task {
            do {
                for trade in targets {
                    try await APIClient.shared.delete("/portfolio/trades/\(trade.id)")
                }
                await load()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func load() async {
        guard let household = session.activeHousehold else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            async let tradesReq: [TradeResponse] = APIClient.shared.get("/portfolio/trades/household/\(household.id)")
            async let assetsReq: [AssetResponse] = APIClient.shared.get("/portfolio/assets")
            async let subPortfoliosReq: [SubPortfolioResponse] = APIClient.shared.get("/portfolio/subportfolios/household/\(household.id)")
            async let accountsReq: [AccountResponse] = APIClient.shared.get("/accounts/household/\(household.id)")
            (trades, assets, subPortfolios, accounts) = try await (tradesReq, assetsReq, subPortfoliosReq, accountsReq)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct TradeRow: View {
    let trade: TradeResponse
    let asset: AssetResponse?
    let subPortfolioName: String?

    private var isBuy: Bool { trade.type == .buy }
    private var currency: String { trade.currency ?? asset?.currency ?? "USD" }
    private var total: Double { trade.quantity * trade.price }

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(asset?.ticker ?? "—")
                        .font(.body.bold())
                    Text(trade.type.label.uppercased())
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(isBuy ? Color.green : Color.red)
                }
                Text([subPortfolioName, trade.date.formatted(date: .abbreviated, time: .omitted)]
                    .compactMap(\.self).joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text((isBuy ? "−" : "+") + total.currency(currency))
                    .font(.body.monospacedDigit())
                Text("\(trade.quantity.formatted(.number.precision(.fractionLength(0...4)))) @ \(trade.price.currency(currency))")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
        }
    }
}
