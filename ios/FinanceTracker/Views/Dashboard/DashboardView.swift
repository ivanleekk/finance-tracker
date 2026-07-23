import SwiftUI
import Charts

struct DashboardView: View {
    @Environment(SessionStore.self) private var session
    @Environment(QuickAddStore.self) private var quickAdd

    /// Switches the tab bar to the Portfolio tab (wired from MainTabView).
    var onSeePortfolio: () -> Void = {}
    /// Switches the tab bar to the Accounts tab (wired from MainTabView).
    var onSeeAccounts: () -> Void = {}

    @State private var accounts: [AccountResponse] = []
    @State private var balances: [BalanceResponse] = []
    @State private var transactions: [TransactionResponse] = []
    @State private var categories: [CategoryResponse] = []
    @State private var snapshots: [PortfolioSnapshotResponse] = []
    @State private var assets: [AssetResponse] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    private var baseCurrency: String { session.activeHousehold?.baseCurrency ?? "USD" }

    /// Liability accounts (loans, mortgages) hold their outstanding balance as a
    /// positive number; they count *against* net worth (mirrors web Dashboard).
    private var liabilityIds: Set<String> {
        Set(accounts.filter { $0.kind == "liability" }.map(\.id))
    }

    /// Latest known balance per account, netting out liabilities. This is the
    /// "cash" side of net worth — money held in real accounts.
    private var currentCash: Double {
        Dictionary(grouping: balances, by: \.accountId).reduce(0.0) { sum, entry in
            let (accountId, history) = entry
            guard let bal = history.max(by: { $0.date < $1.date })?.homeValue else { return sum }
            return sum + (liabilityIds.contains(accountId) ? -bal : bal)
        }
    }

    /// Holdings on the most recent snapshot date only (mirrors PortfolioView).
    private var latestHoldings: [PortfolioSnapshotResponse] {
        guard let latest = snapshots.map(\.date).max() else { return [] }
        return snapshots.filter { $0.date == latest && $0.quantity > 0 }
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

    /// One stacked-area band per (date, series). Cash is forward-filled from
    /// account balances; investments are forward-filled from snapshot totals.
    /// Together the two bands sum to net worth on every date.
    private var netWorthSeries: [NetWorthPoint] {
        let cal = Calendar.current
        let dates = Set(
            balances.map { cal.startOfDay(for: $0.date) } +
            snapshots.map { cal.startOfDay(for: $0.date) }
        ).sorted()
        guard !dates.isEmpty else { return [] }

        let byAccount = Dictionary(grouping: balances, by: \.accountId)
            .mapValues { $0.sorted { $0.date < $1.date } }
        let portfolioByDate = Dictionary(
            grouping: snapshots, by: { cal.startOfDay(for: $0.date) }
        ).mapValues { $0.reduce(0.0) { $0 + $1.currentValueHomeCurrency } }
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

    private var chartDateCount: Int { Set(netWorthSeries.map(\.date)).count }

    private var recentTransactions: [TransactionResponse] {
        Array(transactions.sorted { $0.date > $1.date }.prefix(5))
    }

    var body: some View {
        NavigationStack {
            List {
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

                    if chartDateCount > 1 {
                        Chart(netWorthSeries) { point in
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
                        .frame(height: 180)
                        .padding(.vertical, 4)
                    }

                    if !snapshots.isEmpty {
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
                                asset: assets.first { $0.id == holding.assetId },
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
                    if accounts.isEmpty && !isLoading {
                        ContentUnavailableView(
                            "No Accounts",
                            systemImage: "building.columns",
                            description: Text("Tap “See All” to add your first account.")
                        )
                    }
                    ForEach(accounts.prefix(4)) { account in
                        NavigationLink {
                            AccountDetailView(account: account, onChanged: load)
                        } label: {
                            AccountRow(account: account, latestBalance: latestBalance(for: account))
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
                            categoryName: categories.first { $0.id == txn.categoryId }?.name,
                            accountName: accounts.first { $0.id == txn.accountId }?.name,
                            baseCurrency: baseCurrency
                        )
                    }
                }
            }
            .navigationTitle(session.activeHousehold?.name ?? "Dashboard")
            .overlay {
                if isLoading && balances.isEmpty { ProgressView() }
            }
            .pullDownToQuickAdd(quickAdd, onReload: load)
            .task { await load() }
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

    private func latestBalance(for account: AccountResponse) -> BalanceResponse? {
        balances.filter { $0.accountId == account.id }.max { $0.date < $1.date }
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
            async let snapshotsReq: [PortfolioSnapshotResponse] = APIClient.shared.get("/portfolio/snapshots/household/\(household.id)")
            async let assetsReq: [AssetResponse] = APIClient.shared.get("/portfolio/assets")
            (accounts, balances, transactions, categories, snapshots, assets) =
                try await (accountsReq, balancesReq, txnsReq, categoriesReq, snapshotsReq, assetsReq)
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
