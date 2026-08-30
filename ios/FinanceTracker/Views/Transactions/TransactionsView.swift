import Charts
import SwiftUI

struct TransactionsView: View {
    @Environment(SessionStore.self) private var session
    @Environment(QuickAddStore.self) private var quickAdd
    @Environment(ViewModeStore.self) private var viewModeStore

    @State private var transactions: [TransactionResponse] = []
    @State private var accounts: [AccountResponse] = []
    @State private var categories: [CategoryResponse] = []
    @State private var counterparties: [Counterparty] = []
    @State private var searchText = ""
    @State private var isLoading = true
    @State private var showingAddSheet = false
    @State private var showingTransferSheet = false
    @State private var editingTransaction: TransactionResponse?
    // Held on the screen rather than the row — a confirmation presented from inside
    // a swipe-actions row is torn down with the row's collapse animation before it shows.
    @State private var pendingDelete: TransactionResponse?
    @State private var errorMessage: String?
    @State private var lastLoadedAt: Date?
    @State private var hiddenCategoryIds: Set<String> = []
    @State private var showCategoryFilter = false
    /// How the list is bucketed; remembered between launches, like the web page does per household.
    @AppStorage("transactionsGranularity") private var granularity: HistoryGranularity = .month
    @State private var categoryPeriod: CategoryPeriod = .all
    @State private var categoryPeriodStart: Date?
    @State private var categoryPeriodEnd: Date?

    private var baseCurrency: String { session.activeHousehold?.baseCurrency ?? "USD" }

    /// Accounts (by id) visible under the current view mode; transactions inherit their
    /// account's visibility.
    private var visibleAccountIds: Set<String> {
        Set(accounts
            .filter { viewModeStore.isVisible(ownerUserId: $0.ownerUserId, currentUserId: session.user?.id) }
            .map(\.id))
    }

    /// O(1) lookups instead of `.first { $0.id == ... }` scans — `filtered` reruns
    /// per search keystroke and `byMonth`/row rendering reruns per row per render,
    /// so a linear scan here is redone constantly as transaction history grows.
    private var categoriesById: [String: CategoryResponse] {
        Dictionary(uniqueKeysWithValues: categories.map { ($0.id, $0) })
    }
    private var accountsById: [String: AccountResponse] {
        Dictionary(uniqueKeysWithValues: accounts.map { ($0.id, $0) })
    }

    /// Visible, non-transfer expense transactions — the source for the category breakdown below.
    /// Scoped to the selected period; the Activity list underneath is deliberately *not*, so the
    /// card can answer "what did I spend last month" without hiding the history.
    private var expenseTransactions: [TransactionResponse] {
        let range = categoryPeriod.range(customStart: categoryPeriodStart, customEnd: categoryPeriodEnd)
        return transactions.filter {
            $0.transactionType == .expense
                && visibleAccountIds.contains($0.accountId)
                && (range?.contains($0.date) ?? true)
                // Transfers and settlements are cash leaving an account without
                // being spending: you still have the money, or the bill was
                // already charged when it was paid.
                && Reimbursements.countsAsSpending(
                    categoriesById[$0.categoryId]?.name,
                    isTransfer: $0.transferId != nil
                )
        }
    }

    /// Every expense category that's shown up in the selected period, used to populate the filter
    /// chips (independent of `hiddenCategoryIds`, so a hidden chip stays visible to re-enable).
    private var expenseCategoryOptions: [CategoryOption] {
        var seen: [String: String] = [:]
        for txn in expenseTransactions where seen[txn.categoryId] == nil {
            seen[txn.categoryId] = categoriesById[txn.categoryId]?.name ?? "Uncategorized"
        }
        return seen.map { CategoryOption(id: $0.key, name: $0.value) }.sorted { $0.name < $1.name }
    }

    /// Stable category → colour map, derived from the household's full id-sorted expense-category
    /// list rather than from the filtered render index, so a category keeps its colour no matter
    /// which chips are hidden or which period is selected.
    private var categoryColors: [String: Color] {
        let expenseCats = categories.filter { $0.type == .expense }.sorted { $0.id < $1.id }
        let palette = ChartStyle.categorical
        return Dictionary(uniqueKeysWithValues: expenseCats.enumerated().map { index, cat in
            (cat.id, palette[index % palette.count])
        })
    }

    private var categoryBreakdown: (all: [CategorySpend], top: [CategorySpend], total: Double) {
        var totals: [String: Double] = [:]
        for txn in expenseTransactions where !hiddenCategoryIds.contains(txn.categoryId) {
            totals[txn.categoryId, default: 0] += abs(txn.amountHomeCurrency ?? txn.amount)
        }
        let all = totals
            .map { CategorySpend(id: $0.key, name: categoriesById[$0.key]?.name ?? "Uncategorized", amount: $0.value) }
            .sorted { $0.amount > $1.amount }
        let total = all.reduce(0) { $0 + $1.amount }
        return (all, Array(all.prefix(4)), total)
    }

    /// Caps the pie chart at 6 slices + "Other" so it stays legible once a household has a
    /// long tail of categories.
    private var pieSlices: [CategorySpend] {
        let items = categoryBreakdown.all
        guard items.count > 6 else { return items }
        let otherAmount = items.dropFirst(6).reduce(0) { $0 + $1.amount }
        return Array(items.prefix(6)) + [CategorySpend(id: "other", name: "Other", amount: otherAmount)]
    }

    /// Whether the card is shown at all. Deliberately ignores the period: gating on the *scoped*
    /// list would make the whole card vanish the moment a period had no spending, taking the period
    /// picker with it and stranding the user with no way back.
    private var hasAnyExpenses: Bool {
        transactions.contains { $0.transactionType == .expense && visibleAccountIds.contains($0.accountId) }
    }

    private func toggleHiddenCategory(_ id: String) {
        if hiddenCategoryIds.contains(id) { hiddenCategoryIds.remove(id) } else { hiddenCategoryIds.insert(id) }
    }

    private func loadCategoryFilterPrefs() {
        guard let householdId = session.activeHousehold?.id else { return }
        let prefs = TopCategoryFilterStore.load(householdId: householdId)
        hiddenCategoryIds = prefs.hiddenCategoryIds
        categoryPeriod = prefs.period
        categoryPeriodStart = prefs.customStart
        categoryPeriodEnd = prefs.customEnd
    }

    private func saveCategoryFilterPrefs() {
        guard let householdId = session.activeHousehold?.id else { return }
        TopCategoryFilterStore.save(
            TopCategoryFilterPrefs(
                hiddenCategoryIds: hiddenCategoryIds,
                period: categoryPeriod,
                customStart: categoryPeriodStart,
                customEnd: categoryPeriodEnd
            ),
            householdId: householdId
        )
    }

    private var filtered: [TransactionResponse] {
        let visible = transactions.filter { visibleAccountIds.contains($0.accountId) }
        let sorted = visible.sorted { $0.date > $1.date }
        guard !searchText.isEmpty else { return sorted }
        let categoriesById = categoriesById
        let accountsById = accountsById
        return sorted.filter { txn in
            let category = categoriesById[txn.categoryId]?.name ?? ""
            let account = accountsById[txn.accountId]?.name ?? ""
            return (txn.description ?? "").localizedCaseInsensitiveContains(searchText)
                || category.localizedCaseInsensitiveContains(searchText)
                || account.localizedCaseInsensitiveContains(searchText)
        }
    }

    /// Grouped into day/month/year sections, each carrying what moved inside it.
    /// `filtered` is already newest-first, so the sections come out in that order too.
    private var groups: [HistoryGroup<TransactionResponse>] {
        let accountsById = accountsById
        return groupHistory(filtered, by: granularity) { txn in
            HistoryEntry(
                date: txn.date,
                isTransfer: txn.transferId != nil,
                isInflow: txn.transactionType == .income,
                homeAmount: homeValue(
                    stored: txn.amountHomeCurrency,
                    nativeAmount: txn.amount,
                    nativeCurrency: txn.currency ?? accountsById[txn.accountId]?.currency,
                    baseCurrency: baseCurrency
                )
            )
        }
    }

    var body: some View {
        NavigationStack {
            List {
                QuickAddPullSensor()
                if hasAnyExpenses {
                    Section {
                        CategoryBreakdownCard(
                            breakdown: categoryBreakdown,
                            pieSlices: pieSlices,
                            categoryOptions: expenseCategoryOptions,
                            hiddenCategoryIds: hiddenCategoryIds,
                            showFilter: $showCategoryFilter,
                            period: $categoryPeriod,
                            customStart: $categoryPeriodStart,
                            customEnd: $categoryPeriodEnd,
                            baseCurrency: baseCurrency,
                            colorForCategory: { categoryColors[$0] },
                            onToggle: toggleHiddenCategory,
                            onReset: { hiddenCategoryIds = [] }
                        )
                        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                        .listRowBackground(Color.clear)
                    } header: {
                        Text("Top Categories")
                    }
                }
                Section {
                    Picker("Group by", selection: $granularity) {
                        ForEach(HistoryGranularity.allCases) { option in
                            Text(option.label).tag(option)
                        }
                    }
                    .pickerStyle(.segmented)
                    .draggableSegments(options: HistoryGranularity.allCases, selection: $granularity)
                    .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                    .listRowBackground(Color.clear)
                }
                ForEach(groups) { group in
                    Section {
                        ForEach(group.items) { txn in
                            transactionRow(txn)
                        }
                    } header: {
                        HistorySectionHeader(
                            label: group.label,
                            summary: group.summary,
                            baseCurrency: baseCurrency
                        )
                    }
                }
            }
            .navigationTitle("Transactions")
            .searchable(text: $searchText, prompt: "Search description, category, account")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { VaultLockButton() }
                ToolbarItem(placement: .topBarLeading) { ViewModeSwitcher() }
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button {
                            showingAddSheet = true
                        } label: {
                            Label("New Transaction", systemImage: "arrow.up.arrow.down")
                        }
                        Button {
                            showingTransferSheet = true
                        } label: {
                            Label("New Transfer", systemImage: "arrow.left.arrow.right")
                        }
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $showingAddSheet) {
                if let household = session.activeHousehold {
                    TransactionFormView(
                        accounts: accounts,
                        categories: categories,
                        counterparties: counterparties,
                        householdId: household.id
                    ) {
                        await load()
                    }
                }
            }
            .sheet(isPresented: $showingTransferSheet) {
                TransferFormView(accounts: accounts) {
                    await load()
                }
            }
            .sheet(item: $editingTransaction) { txn in
                if let household = session.activeHousehold {
                    TransactionFormView(
                        accounts: accounts,
                        categories: categories,
                        counterparties: counterparties,
                        householdId: household.id,
                        existing: txn
                    ) {
                        await load()
                    }
                }
            }
            .overlay {
                if isLoading && transactions.isEmpty {
                    LoadingSkeleton()
                } else if !isLoading && transactions.isEmpty {
                    ContentUnavailableView(
                        "No Transactions",
                        systemImage: "list.bullet.rectangle",
                        description: Text("Tap + to log your first transaction.")
                    )
                }
            }
            .quickAddPull(quickAdd, onReload: load)
            .confirmationDialog(
                "Delete this transaction?",
                isPresented: .init(
                    get: { pendingDelete != nil },
                    set: { if !$0 { pendingDelete = nil } }
                ),
                titleVisibility: .visible
            ) {
                Button("Delete", role: .destructive) {
                    if let txn = pendingDelete {
                        delete([txn], at: IndexSet(integer: 0))
                    }
                }
            } message: {
                Text("The account balance it moved is recalculated. This can't be undone.")
            }
            .task { await loadIfNeeded() }
            // Restore the saved Top-Categories filter/period on appear and whenever the active
            // household changes, so the user doesn't re-hide the same categories every visit.
            .onAppear { loadCategoryFilterPrefs() }
            .onChange(of: session.activeHousehold?.id) { loadCategoryFilterPrefs() }
            .onChange(of: hiddenCategoryIds) { saveCategoryFilterPrefs() }
            // Seed an anchor when switching to "Specific month" — without one the range is
            // unbounded, so the card would silently show all time under a label that says
            // otherwise. The current month is the obvious starting point.
            .onChange(of: categoryPeriod) {
                if categoryPeriod.usesCustomStart && categoryPeriodStart == nil {
                    categoryPeriodStart = Date()
                }
                saveCategoryFilterPrefs()
            }
            .onChange(of: categoryPeriodStart) { saveCategoryFilterPrefs() }
            .onChange(of: categoryPeriodEnd) { saveCategoryFilterPrefs() }
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
    }

    /// One activity row. Extracted from `body` so the list stays inside the
    /// type-checker's budget, not for reuse.
    @ViewBuilder
    private func transactionRow(_ txn: TransactionResponse) -> some View {
        let row = TransactionRow(
            transaction: txn,
            categoryName: categoriesById[txn.categoryId]?.name,
            accountName: accountsById[txn.accountId]?.name,
            baseCurrency: baseCurrency
        )
        // Transfers are two linked legs; edit them where they're created, not here.
        Group {
            if txn.transferId == nil {
                Button { editingTransaction = txn } label: { row }
                    .buttonStyle(.plain)
            } else {
                row
            }
        }
        // `allowsFullSwipe: false` + a confirmation instead of the plain `.onDelete`:
        // deleting a transaction rewrites account balances server-side and there is no
        // undo, so a fast swipe must reveal the button, not commit the delete.
        .swipeActions(allowsFullSwipe: false) {
            Button(role: .destructive) {
                pendingDelete = txn
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
        // The same actions on a long press. A swipe is invisible until you try it and
        // is out of reach of Voice Control and Switch Control; the menu is the
        // discoverable, nameable half of the same pair.
        .contextMenu {
            if txn.transferId == nil {
                Button { editingTransaction = txn } label: {
                    Label("Edit", systemImage: "pencil")
                }
            }
            Button(role: .destructive) { pendingDelete = txn } label: {
                Label("Delete", systemImage: "trash")
            }
        }
    }

    private func delete(_ group: [TransactionResponse], at offsets: IndexSet) {
        let toDelete = offsets.map { group[$0] }
        Task {
            do {
                for txn in toDelete {
                    try await APIClient.shared.delete("/cashflow/transactions/\(txn.id)")
                }
                await load()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    /// Mirrors Dashboard's staleness guard: skip refetching on every tab
    /// reselect when the list was loaded moments ago. `onReload` (Quick Add)
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
            async let txnsReq: [TransactionResponse] = APIClient.shared.get("/cashflow/transactions/household/\(household.id)")
            async let accountsReq: [AccountResponse] = APIClient.shared.get("/accounts/household/\(household.id)")
            async let categoriesReq: [CategoryResponse] = APIClient.shared.get("/cashflow/categories/household/\(household.id)")
            async let counterpartiesReq: [Counterparty] = APIClient.shared.get("/cashflow/counterparties/household/\(household.id)")
            (transactions, accounts, categories, counterparties) = try await (txnsReq, accountsReq, categoriesReq, counterpartiesReq)
            lastLoadedAt = Date()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// Section header for one day/month/year bucket: its label, plus the money that moved
/// inside it. Mirrors the web Transactions group header.
struct HistorySectionHeader: View {
    let label: String
    let summary: HistoryGroupSummary
    let baseCurrency: String

    /// A month can hold a bigger number than a phone-width header has room for, and up to
    /// three of them sit here at once. Left to wrap, "+$1,346,700.00" broke after the "+" —
    /// or worse, mid-number — which for a moment reads as a different figure entirely. Past
    /// six figures they switch to the compact form the chart axes already use ("+$1.3M"),
    /// which is the right amount of precision for a header anyway; the exact figures are in
    /// the rows underneath it.
    private func money(_ value: Double) -> String {
        abs(value) >= 100_000 ? value.compactCurrency(baseCurrency) : value.currency(baseCurrency)
    }

    var body: some View {
        HStack(spacing: 8) {
            Text(label)
                .layoutPriority(1)
            Spacer(minLength: 8)
            if summary.inflow > 0 {
                Text("+" + money(summary.inflow))
                    .foregroundStyle(.green)
            }
            if summary.outflow > 0 {
                Text("−" + money(summary.outflow))
                    .foregroundStyle(.red)
            }
            if summary.showsNet {
                Text("net " + (summary.net < 0 ? "−" : "+") + money(abs(summary.net)))
                    .foregroundStyle(summary.net < 0 ? .red : .green)
            }
            if summary.unconverted > 0 {
                // Say so rather than quietly reporting a total that's missing rows.
                Text("partial")
                    .foregroundStyle(.secondary)
                    .accessibilityLabel(
                        "\(summary.unconverted) \(summary.unconverted == 1 ? "entry has" : "entries have") no \(baseCurrency) value and are not included"
                    )
            }
        }
        .font(.caption.monospacedDigit())
        // Belt and braces with the compact form above: a long label plus three figures can
        // still overflow at the largest Dynamic Type sizes, and a scaled-down header beats a
        // currency figure broken across two lines.
        .lineLimit(1)
        .minimumScaleFactor(0.8)
        .textCase(nil)
    }
}
