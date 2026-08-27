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
    /// Part of this bill is somebody else's. The amount above stays the full sum
    /// that leaves the account — this only records whose it was.
    @State private var isSplitting: Bool
    @State private var owedByText: String
    @State private var owedAmountText: String
    /// Empty means "not recorded", which is the normal case — most purchases have
    /// no code the user happens to know.
    @State private var mcc: String

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
        let existingOwed = existing?.owedAmount
        _isSplitting = State(initialValue: existing?.owedBy != nil && existingOwed != nil)
        _owedByText = State(initialValue: existing?.owedBy ?? "")
        _owedAmountText = State(initialValue: existingOwed.map(Self.amountString) ?? "")
        _mcc = State(initialValue: existing?.mcc ?? "")
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

    private var owedAmount: Double? {
        Reimbursements.parseMoney(owedAmountText)
    }

    private var splitAssessment: SplitAssessment {
        Reimbursements.assessSplit(amount: amount, owed: owedAmount)
    }

    /// The sentence under the split fields. It restates the split as the two
    /// numbers the user actually cares about, because "they owe 80" on a 120
    /// bill means nothing until you can see what it leaves you.
    private var splitHint: String {
        switch splitAssessment {
        case .incomplete:
            return "The full amount still leaves your account — only your share counts towards budgets."
        case let .invalid(reason):
            return reason
        case let .valid(yourShare, owed):
            let currency = session.activeHousehold?.baseCurrency ?? "USD"
            return "Your share: \(yourShare.currency(currency)). They owe you \(owed.currency(currency))."
        }
    }

    private var trimmedOwedBy: String {
        owedByText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// A split that is switched on but not yet complete blocks saving, rather
    /// than being silently dropped — the user asked for it and would not notice
    /// it going missing.
    private var splitIsUsable: Bool {
        guard isSplitting else { return true }
        guard case .valid = splitAssessment else { return false }
        return !trimmedOwedBy.isEmpty
    }

    private var canSave: Bool {
        amount ?? 0 > 0 && accountId != nil && categoryId != nil && !isSaving && splitIsUsable
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

                // Splitting a bill. The amount above is untouched: the whole sum
                // really did leave the account. This only records how much of it
                // was somebody else's, so the budget charges you for your share
                // and the rest becomes a debt they owe you.
                if type == .expense {
                    Section {
                        Toggle("Someone owes me for part of this", isOn: $isSplitting.animation())
                        if isSplitting {
                            TextField("Who (e.g. Alice)", text: $owedByText)
                                .textInputAutocapitalization(.words)
                            HStack {
                                Text("They owe")
                                TextField("0.00", text: $owedAmountText)
                                    .keyboardType(.decimalPad)
                                    .multilineTextAlignment(.trailing)
                            }
                        }
                    } footer: {
                        if isSplitting {
                            Text(splitHint)
                                .foregroundStyle(splitAssessment.isInvalid ? .red : .secondary)
                        }
                    }
                }

                // Only for users who asked for it in Settings — a four-digit code
                // field on every form would tax everyone for a minority feature.
                if session.user?.recordsMerchantCodes == true {
                    Section {
                        NavigationLink {
                            ReferencePicker(
                                title: "Merchant Code",
                                path: "/reference/mccs",
                                selection: $mcc,
                                id: \ReferenceMcc.code,
                                label: { "\($0.code) — \($0.name)" },
                                searchText: { "\($0.code) \($0.name) \($0.group)" }
                            )
                        } label: {
                            LabeledContent("Merchant code", value: mcc.isEmpty ? "Not recorded" : mcc)
                        }
                    } footer: {
                        Text("Optional. Recorded only — nothing is calculated from it.")
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
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .disabled(!canSave)
                }
            }
            .discardGuard(fields: [type, amountText, date, description, accountId, categoryId, mcc])
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

    /// What this edit should do to the split already recorded.
    ///
    /// Switching the toggle off means *remove* it, which is a different request
    /// from leaving it alone — so a form that opened with no split and still has
    /// none sends nothing rather than an explicit clear.
    private var splitChange: SplitChange {
        if isSplitting, let owedAmount, !trimmedOwedBy.isEmpty {
            return .set(owedBy: trimmedOwedBy, owedAmount: owedAmount)
        }
        let hadSplit = existing?.owedBy != nil && existing?.owedAmount != nil
        return hadSplit ? .clear : .unchanged
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
                        categoryId: categoryId,
                        split: splitChange,
                        mcc: mcc
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
                        categoryId: categoryId,
                        owedBy: isSplitting ? trimmedOwedBy : nil,
                        owedAmount: isSplitting ? owedAmount : nil,
                        mcc: mcc
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
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .disabled(!canSave)
                }
            }
            .discardGuard(fields: [fromAccountId, toAccountId, amountText, date, description])
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
    @Binding var period: CategoryPeriod
    @Binding var customStart: Date?
    @Binding var customEnd: Date?
    let baseCurrency: String
    /// Stable per-category colour from the parent; nil for buckets that aren't a real category
    /// (the "Other" rollup slice, "Uncategorized").
    let colorForCategory: (String) -> Color?
    let onToggle: (String) -> Void
    let onReset: () -> Void

    /// Neutral fallback matching the web's `OTHER_SLICE_COLOR`.
    private static let otherSliceColor = Color.secondary.opacity(0.4)

    private func color(_ id: String) -> Color { colorForCategory(id) ?? Self.otherSliceColor }

    private var topMax: Double { max(breakdown.top.map(\.amount).max() ?? 1, 1) }

    /// Cumulative angle the touch landed on; resolved to a slice by `ChartStyle.sliceIndex`.
    ///
    /// Two states, not one: Swift Charts clears its own binding the instant the finger
    /// lifts, so `live` is what it writes and `picked` is what the view reads.
    @State private var liveAngle: Double?
    @State private var pickedAngle: Double?

    private var selected: Int? {
        ChartStyle.sliceIndex(atAngleValue: pickedAngle, in: pieSlices.map(\.amount))
    }

    /// Bound non-optional dates for the two DatePickers; picking a date is what turns the
    /// corresponding open-ended bound into a real one.
    private var startBinding: Binding<Date> {
        Binding(get: { customStart ?? Date() }, set: { customStart = $0 })
    }
    private var endBinding: Binding<Date> {
        Binding(get: { customEnd ?? Date() }, set: { customEnd = $0 })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Picker("Period", selection: $period) {
                    ForEach(CategoryPeriod.allCases) { option in
                        Text(option.label).tag(option)
                    }
                }
                .pickerStyle(.menu)
                .font(.caption)
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

            if period == .specificMonth {
                MonthYearPicker(anchor: $customStart)
            }

            if period == .custom {
                VStack(spacing: 4) {
                    DatePicker("From", selection: startBinding, displayedComponents: .date)
                    DatePicker("To", selection: endBinding, displayedComponents: .date)
                }
                .font(.caption)
            }

            if showFilter {
                CategoryFilterChips(
                    options: categoryOptions,
                    hiddenCategoryIds: hiddenCategoryIds,
                    colorForCategory: colorForCategory,
                    onToggle: onToggle,
                    onReset: onReset
                )
            }

            if breakdown.all.isEmpty {
                Text(hiddenCategoryIds.isEmpty ? "No expenses in this period." : "All categories are hidden.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            } else {
                Chart(Array(pieSlices.enumerated()), id: \.element.id) { index, slice in
                    SectorMark(
                        angle: .value("Amount", slice.amount),
                        // The picked wedge grows outward, so the shape says which one is
                        // being read before the label in the middle is looked at.
                        innerRadius: .ratio(0.55),
                        outerRadius: .ratio(selected == index ? 1.0 : 0.92),
                        angularInset: 1.5
                    )
                    .cornerRadius(3)
                    .foregroundStyle(color(slice.id))
                    .opacity(selected == nil || selected == index ? 1 : 0.3)
                }
                .chartAngleSelection(value: $liveAngle)
                .onChange(of: liveAngle) { _, new in
                    if let new { pickedAngle = new }
                }
                .chartLegend(.hidden)
                .frame(height: 140)
                .overlay {
                    VStack(spacing: 1) {
                        if let selected, pieSlices.indices.contains(selected) {
                            let slice = pieSlices[selected]
                            Text(slice.name)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                            Text(slice.amount.compactCurrency(baseCurrency))
                                .font(.headline.monospacedDigit())
                        } else {
                            Text("Spent")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                            Text(breakdown.total.compactCurrency(baseCurrency))
                                .font(.headline.monospacedDigit())
                        }
                    }
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .padding(.horizontal, 24)
                    .allowsHitTesting(false)
                }
                .animation(.snappy(duration: 0.22), value: selected)
                .sensoryFeedback(.selection, trigger: selected)

                VStack(spacing: 10) {
                    ForEach(breakdown.top) { cat in
                        let pct = breakdown.total > 0 ? cat.amount / breakdown.total * 100 : 0
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Circle().fill(color(cat.id)).frame(width: 8, height: 8)
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
                                        .fill(color(cat.id))
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

/// Month + year menus for the "Specific month" period.
///
/// SwiftUI has no month-granularity DatePicker, and a day picker would imply the day matters
/// (it doesn't — only year/month are read). Two menus keep the choice unambiguous and fit the
/// card's width on a phone.
private struct MonthYearPicker: View {
    @Binding var anchor: Date?

    private var calendar: Calendar { CategoryPeriod.utcCalendar }
    private var current: Date { anchor ?? Date() }

    /// A decade back plus the current year — spending history older than that is rare, and an
    /// unbounded year list makes the menu unusable.
    private var years: [Int] {
        let thisYear = calendar.component(.year, from: Date())
        return Array((thisYear - 10)...thisYear).reversed()
    }

    private static let monthNames: [String] = {
        let f = DateFormatter()
        f.locale = .current
        return f.standaloneMonthSymbols ?? f.monthSymbols
    }()

    private func set(month: Int? = nil, year: Int? = nil) {
        var components = DateComponents()
        components.year = year ?? calendar.component(.year, from: current)
        components.month = month ?? calendar.component(.month, from: current)
        components.day = 1
        anchor = calendar.date(from: components)
    }

    var body: some View {
        HStack(spacing: 8) {
            Picker("Month", selection: Binding(
                get: { calendar.component(.month, from: current) },
                set: { set(month: $0) }
            )) {
                ForEach(1...12, id: \.self) { month in
                    Text(Self.monthNames[month - 1]).tag(month)
                }
            }
            Picker("Year", selection: Binding(
                get: { calendar.component(.year, from: current) },
                set: { set(year: $0) }
            )) {
                ForEach(years, id: \.self) { year in
                    Text(String(year)).tag(year)
                }
            }
        }
        .pickerStyle(.menu)
        .font(.caption)
    }
}

/// Toggleable capsule chips — tapping one adds/removes that category from `hiddenCategoryIds`.
private struct CategoryFilterChips: View {
    let options: [CategoryOption]
    let hiddenCategoryIds: Set<String>
    let colorForCategory: (String) -> Color?
    let onToggle: (String) -> Void
    let onReset: () -> Void

    private let columns = [GridItem(.adaptive(minimum: 80), spacing: 8)]

    var body: some View {
        if options.isEmpty {
            Text("No expense categories in this period.")
                .font(.caption)
                .foregroundStyle(.secondary)
        } else {
            VStack(alignment: .leading, spacing: 8) {
                LazyVGrid(columns: columns, alignment: .leading, spacing: 8) {
                    ForEach(options) { option in
                        let hidden = hiddenCategoryIds.contains(option.id)
                        Button {
                            onToggle(option.id)
                        } label: {
                            HStack(spacing: 5) {
                                if !hidden, let dot = colorForCategory(option.id) {
                                    Circle().fill(dot).frame(width: 7, height: 7)
                                }
                                Text(option.name)
                                    .font(.caption.weight(.medium))
                                    .lineLimit(1)
                                    .strikethrough(hidden)
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(hidden ? Color(.tertiarySystemGroupedBackground) : Color.accentColor.opacity(0.16))
                            .foregroundStyle(hidden ? .secondary : Color.accentColor)
                            .clipShape(Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                }
                // Clears every hidden category at once — re-toggling a dozen chips by hand to get
                // back to the full picture is the tedium this exists to remove.
                if !hiddenCategoryIds.isEmpty {
                    Button {
                        onReset()
                    } label: {
                        Label("Reset", systemImage: "arrow.counterclockwise")
                            .font(.caption.weight(.medium))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Color.accentColor)
                }
            }
        }
    }
}
