import Charts
import SwiftUI

struct TransactionsView: View {
    @Environment(SessionStore.self) private var session
    @Environment(QuickAddStore.self) private var quickAdd
    @Environment(ViewModeStore.self) private var viewModeStore

    @State private var transactions: [TransactionResponse] = []
    @State private var accounts: [AccountResponse] = []
    @State private var categories: [CategoryResponse] = []
    @State private var searchText = ""
    @State private var isLoading = true
    @State private var showingAddSheet = false
    @State private var showingTransferSheet = false
    @State private var editingTransaction: TransactionResponse?
    @State private var errorMessage: String?
    @State private var lastLoadedAt: Date?
    @State private var hiddenCategoryIds: Set<String> = []
    @State private var showCategoryFilter = false
    /// How the list is bucketed; remembered between launches, like the web page does per household.
    @AppStorage("transactionsGranularity") private var granularity: HistoryGranularity = .month

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
    private var expenseTransactions: [TransactionResponse] {
        transactions.filter { $0.transactionType == .expense && visibleAccountIds.contains($0.accountId) }
    }

    /// Every expense category that's actually shown up, used to populate the filter chips
    /// (independent of `hiddenCategoryIds`, so a hidden chip stays visible to re-enable).
    private var expenseCategoryOptions: [CategoryOption] {
        var seen: [String: String] = [:]
        for txn in expenseTransactions where seen[txn.categoryId] == nil {
            seen[txn.categoryId] = categoriesById[txn.categoryId]?.name ?? "Uncategorized"
        }
        return seen.map { CategoryOption(id: $0.key, name: $0.value) }.sorted { $0.name < $1.name }
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

    private func toggleHiddenCategory(_ id: String) {
        if hiddenCategoryIds.contains(id) { hiddenCategoryIds.remove(id) } else { hiddenCategoryIds.insert(id) }
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
                if !expenseTransactions.isEmpty {
                    Section {
                        CategoryBreakdownCard(
                            breakdown: categoryBreakdown,
                            pieSlices: pieSlices,
                            categoryOptions: expenseCategoryOptions,
                            hiddenCategoryIds: hiddenCategoryIds,
                            showFilter: $showCategoryFilter,
                            baseCurrency: baseCurrency,
                            onToggle: toggleHiddenCategory
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
                    .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                    .listRowBackground(Color.clear)
                }
                ForEach(groups) { group in
                    Section {
                        ForEach(group.items) { txn in
                            let row = TransactionRow(
                                transaction: txn,
                                categoryName: categoriesById[txn.categoryId]?.name,
                                accountName: accountsById[txn.accountId]?.name,
                                baseCurrency: baseCurrency
                            )
                            // Transfers are two linked legs; edit them where they're created, not here.
                            if txn.transferId == nil {
                                Button { editingTransaction = txn } label: { row }
                                    .buttonStyle(.plain)
                            } else {
                                row
                            }
                        }
                        .onDelete { offsets in
                            delete(group.items, at: offsets)
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
            .task { await loadIfNeeded() }
            .alert("Error", isPresented: .init(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(errorMessage ?? "")
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
            (transactions, accounts, categories) = try await (txnsReq, accountsReq, categoriesReq)
            lastLoadedAt = Date()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// Add or edit a transaction. `existing == nil` creates; otherwise edits in place.
struct TransactionFormView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(SessionStore.self) private var session

    let accounts: [AccountResponse]
    let householdId: String
    let existing: TransactionResponse?
    let onSaved: () async -> Void

    @State private var categories: [CategoryResponse]
    @State private var type: TransactionType
    @State private var amountText: String
    @State private var date: Date
    @State private var description: String
    @State private var accountId: String?
    @State private var categoryId: String?
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var showingNewCategory = false

    init(
        accounts: [AccountResponse],
        categories: [CategoryResponse],
        householdId: String,
        existing: TransactionResponse? = nil,
        onSaved: @escaping () async -> Void
    ) {
        self.accounts = accounts
        self.householdId = householdId
        self.existing = existing
        self.onSaved = onSaved
        _categories = State(initialValue: categories)
        _type = State(initialValue: existing?.transactionType ?? .expense)
        _amountText = State(initialValue: existing.map { Self.amountString($0.amount) } ?? "")
        _date = State(initialValue: existing?.date ?? Date())
        _description = State(initialValue: existing?.description ?? "")
        _accountId = State(initialValue: existing?.accountId)
        _categoryId = State(initialValue: existing?.categoryId)
    }

    /// Editable string for a stored amount: drop the trailing ".0" on whole numbers.
    private static func amountString(_ value: Double) -> String {
        value == value.rounded() ? String(Int(value)) : String(value)
    }

    private var filteredCategories: [CategoryResponse] {
        categories.filter { $0.type == type }
    }

    private var amount: Double? {
        Double(amountText.replacingOccurrences(of: ",", with: ""))
    }

    private var canSave: Bool {
        amount ?? 0 > 0 && accountId != nil && categoryId != nil && !isSaving
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Type", selection: $type) {
                        Text("Expense").tag(TransactionType.expense)
                        Text("Income").tag(TransactionType.income)
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .onChange(of: type) {
                        categoryId = filteredCategories.first?.id
                    }
                }

                Section {
                    HStack {
                        Text("Amount")
                        TextField("0.00", text: $amountText)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                    }
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                    TextField("Description (optional)", text: $description)
                }

                Section {
                    Picker("Account", selection: $accountId) {
                        Text("Select").tag(String?.none)
                        ForEach(accounts) { account in
                            Text(account.name).tag(String?.some(account.id))
                        }
                    }
                    Picker("Category", selection: $categoryId) {
                        Text("Select").tag(String?.none)
                        ForEach(filteredCategories) { category in
                            Text(category.name).tag(String?.some(category.id))
                        }
                    }
                    Button {
                        showingNewCategory = true
                    } label: {
                        Label("New Category", systemImage: "plus.circle")
                    }
                }

                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle(existing == nil ? "New Transaction" : "Edit Transaction")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .disabled(!canSave)
                }
            }
            .onAppear {
                if accountId == nil {
                    let defaultAccount = accounts.first { $0.id == session.user?.defaultAccountId }
                    accountId = (defaultAccount ?? accounts.first)?.id
                }
                if categoryId == nil { categoryId = filteredCategories.first?.id }
            }
            .sheet(isPresented: $showingNewCategory) {
                CategoryEditView(category: nil, householdId: householdId, lockedType: type) { created in
                    categories.append(created)
                    categoryId = created.id
                }
            }
        }
    }

    private func save() {
        guard let amount, let accountId, let categoryId else { return }
        isSaving = true
        errorMessage = nil
        Task {
            defer { isSaving = false }
            do {
                if let existing {
                    let body = TransactionUpdate(
                        date: date,
                        amount: amount,
                        description: description,
                        accountId: accountId,
                        categoryId: categoryId
                    )
                    let _: TransactionResponse = try await APIClient.shared.put(
                        "/cashflow/transactions/\(existing.id)", body: body
                    )
                } else {
                    let body = TransactionCreate(
                        date: date,
                        amount: amount,
                        description: description.isEmpty ? nil : description,
                        accountId: accountId,
                        categoryId: categoryId
                    )
                    let _: TransactionResponse = try await APIClient.shared.post(
                        "/cashflow/transactions", body: body
                    )
                }
                await onSaved()
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

/// Move money between two accounts of the same household (backend creates the
/// linked withdrawal/deposit pair and a "Transfer" category).
struct TransferFormView: View {
    @Environment(\.dismiss) private var dismiss

    let accounts: [AccountResponse]
    let onSaved: () async -> Void

    @State private var fromAccountId: String?
    @State private var toAccountId: String?
    @State private var amountText = ""
    @State private var date = Date()
    @State private var description = ""
    @State private var isSaving = false
    @State private var errorMessage: String?

    private var amount: Double? {
        Double(amountText.replacingOccurrences(of: ",", with: ""))
    }

    private var canSave: Bool {
        amount ?? 0 > 0
            && fromAccountId != nil
            && toAccountId != nil
            && fromAccountId != toAccountId
            && !isSaving
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("From", selection: $fromAccountId) {
                        Text("Select").tag(String?.none)
                        ForEach(accounts) { account in
                            Text(account.name).tag(String?.some(account.id))
                        }
                    }
                    Picker("To", selection: $toAccountId) {
                        Text("Select").tag(String?.none)
                        ForEach(accounts) { account in
                            Text(account.name).tag(String?.some(account.id))
                        }
                    }
                } footer: {
                    if fromAccountId != nil && fromAccountId == toAccountId {
                        Text("Pick two different accounts.")
                            .foregroundStyle(.red)
                    }
                }

                Section {
                    HStack {
                        Text("Amount")
                        TextField("0.00", text: $amountText)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                    }
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                    TextField("Description (optional)", text: $description)
                }

                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("New Transfer")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .disabled(!canSave)
                }
            }
            .onAppear {
                if fromAccountId == nil { fromAccountId = accounts.first?.id }
                if toAccountId == nil { toAccountId = accounts.dropFirst().first?.id }
            }
        }
    }

    private func save() {
        guard let amount, let fromAccountId, let toAccountId else { return }
        isSaving = true
        errorMessage = nil
        Task {
            defer { isSaving = false }
            do {
                let body = TransferCreate(
                    fromAccountId: fromAccountId,
                    toAccountId: toAccountId,
                    amount: amount,
                    date: date,
                    description: description.isEmpty ? nil : description
                )
                let _: [TransactionResponse] = try await APIClient.shared.post(
                    "/cashflow/transfers", body: body
                )
                await onSaved()
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

/// Section header for one day/month/year bucket: its label, plus the money that moved
/// inside it. Mirrors the web Transactions group header.
struct HistorySectionHeader: View {
    let label: String
    let summary: HistoryGroupSummary
    let baseCurrency: String

    var body: some View {
        HStack(spacing: 8) {
            Text(label)
            Spacer(minLength: 8)
            if summary.inflow > 0 {
                Text("+" + summary.inflow.currency(baseCurrency))
                    .foregroundStyle(.green)
            }
            if summary.outflow > 0 {
                Text("−" + summary.outflow.currency(baseCurrency))
                    .foregroundStyle(.red)
            }
            if summary.showsNet {
                Text("net " + (summary.net < 0 ? "−" : "+") + abs(summary.net).currency(baseCurrency))
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
        .textCase(nil)
    }
}

struct CategoryOption: Identifiable, Hashable {
    let id: String
    let name: String
}

struct CategorySpend: Identifiable {
    let id: String
    let name: String
    let amount: Double
}

/// Spending-by-category donut + filterable chip list + top-4 bars. Native counterpart of the
/// web Transactions "Top categories" card, including its category filter and pie chart.
struct CategoryBreakdownCard: View {
    let breakdown: (all: [CategorySpend], top: [CategorySpend], total: Double)
    let pieSlices: [CategorySpend]
    let categoryOptions: [CategoryOption]
    let hiddenCategoryIds: Set<String>
    @Binding var showFilter: Bool
    let baseCurrency: String
    let onToggle: (String) -> Void

    /// Reuses the Net Worth Split donut's palette (the web's `--chart-cat-1..5`) so a category
    /// wedge here and an asset wedge on the Dashboard read from the same colour language.
    private func color(_ index: Int) -> Color { NetWorthSplitChart.palette[index % NetWorthSplitChart.palette.count] }

    private var topMax: Double { max(breakdown.top.map(\.amount).max() ?? 1, 1) }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Spacer()
                Button {
                    showFilter.toggle()
                } label: {
                    Label(
                        hiddenCategoryIds.isEmpty ? "Filter" : "Filter (\(hiddenCategoryIds.count) hidden)",
                        systemImage: "line.3.horizontal.decrease.circle"
                    )
                    .font(.caption.weight(.semibold))
                }
            }

            if showFilter {
                CategoryFilterChips(options: categoryOptions, hiddenCategoryIds: hiddenCategoryIds, onToggle: onToggle)
            }

            if breakdown.all.isEmpty {
                Text(hiddenCategoryIds.isEmpty ? "No expenses yet." : "All categories are hidden.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            } else {
                Chart(Array(pieSlices.enumerated()), id: \.element.id) { index, slice in
                    SectorMark(
                        angle: .value("Amount", slice.amount),
                        innerRadius: .ratio(0.55),
                        angularInset: 1.5
                    )
                    .cornerRadius(3)
                    .foregroundStyle(color(index))
                }
                .chartLegend(.hidden)
                .frame(height: 140)

                VStack(spacing: 10) {
                    ForEach(breakdown.top) { cat in
                        let pct = breakdown.total > 0 ? cat.amount / breakdown.total * 100 : 0
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(cat.name).font(.caption)
                                Spacer()
                                Text(cat.amount.currencyWhole(baseCurrency))
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(.secondary)
                                Text("· \(Int(pct.rounded()))%")
                                    .font(.caption2.monospacedDigit())
                                    .foregroundStyle(.secondary)
                            }
                            GeometryReader { geo in
                                ZStack(alignment: .leading) {
                                    Capsule().fill(.quaternary)
                                    Capsule()
                                        .fill(Color.accentColor)
                                        .frame(width: geo.size.width * (cat.amount / topMax))
                                }
                            }
                            .frame(height: 6)
                        }
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }
}

/// Toggleable capsule chips — tapping one adds/removes that category from `hiddenCategoryIds`.
private struct CategoryFilterChips: View {
    let options: [CategoryOption]
    let hiddenCategoryIds: Set<String>
    let onToggle: (String) -> Void

    private let columns = [GridItem(.adaptive(minimum: 80), spacing: 8)]

    var body: some View {
        if options.isEmpty {
            Text("No expense categories yet.")
                .font(.caption)
                .foregroundStyle(.secondary)
        } else {
            LazyVGrid(columns: columns, alignment: .leading, spacing: 8) {
                ForEach(options) { option in
                    let hidden = hiddenCategoryIds.contains(option.id)
                    Button {
                        onToggle(option.id)
                    } label: {
                        Text(option.name)
                            .font(.caption.weight(.medium))
                            .lineLimit(1)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(hidden ? Color(.tertiarySystemGroupedBackground) : Color.accentColor.opacity(0.16))
                            .foregroundStyle(hidden ? .secondary : Color.accentColor)
                            .strikethrough(hidden)
                            .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}
