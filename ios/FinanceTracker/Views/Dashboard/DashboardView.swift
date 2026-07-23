import SwiftUI
import Charts

struct DashboardView: View {
    @Environment(SessionStore.self) private var session

    @State private var accounts: [AccountResponse] = []
    @State private var balances: [BalanceResponse] = []
    @State private var transactions: [TransactionResponse] = []
    @State private var categories: [CategoryResponse] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    private var baseCurrency: String { session.activeHousehold?.baseCurrency ?? "USD" }

    /// Latest balance per account, in home currency.
    private var netWorth: Double {
        Dictionary(grouping: balances, by: \.accountId)
            .compactMap { $0.value.max(by: { $0.date < $1.date })?.homeValue }
            .reduce(0, +)
    }

    /// Net worth over time: for each date any balance was recorded,
    /// sum the latest-known balance of every account (forward-fill).
    private var netWorthSeries: [(date: Date, value: Double)] {
        let dates = Set(balances.map { Calendar.current.startOfDay(for: $0.date) }).sorted()
        guard !dates.isEmpty else { return [] }
        let byAccount = Dictionary(grouping: balances, by: \.accountId)
            .mapValues { $0.sorted { $0.date < $1.date } }
        return dates.map { date in
            let total = byAccount.values.reduce(0.0) { sum, series in
                sum + (series.last { $0.date <= date.addingTimeInterval(86_399) }?.homeValue ?? 0)
            }
            return (date, total)
        }
    }

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

                    if netWorthSeries.count > 1 {
                        Chart(netWorthSeries, id: \.date) { point in
                            AreaMark(x: .value("Date", point.date), y: .value("Net Worth", point.value))
                                .foregroundStyle(.linearGradient(
                                    colors: [session.theme.primary.accent.opacity(0.35), .clear],
                                    startPoint: .top, endPoint: .bottom
                                ))
                            LineMark(x: .value("Date", point.date), y: .value("Net Worth", point.value))
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
                        .frame(height: 180)
                        .padding(.vertical, 4)
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
                        NavigationLink("See All") { AccountsListView() }
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
            .refreshable { await load() }
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
            (accounts, balances, transactions, categories) = try await (accountsReq, balancesReq, txnsReq, categoriesReq)
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
