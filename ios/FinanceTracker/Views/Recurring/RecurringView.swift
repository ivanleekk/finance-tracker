import SwiftUI

/// Recurring transactions — salary, rent, subscriptions. Native counterpart of
/// the web /recurring page, reached from the More tab.
///
/// Rules post themselves overnight (the backend daily job), so this screen is
/// about seeing what's committed and correcting it, not about data entry.
struct RecurringView: View {
    @Environment(SessionStore.self) private var session
    @Environment(QuickAddStore.self) private var quickAdd
    @Environment(ViewModeStore.self) private var viewModeStore

    @State private var rules: [RecurringTransactionResponse] = []
    @State private var upcoming: [UpcomingOccurrence] = []
    @State private var accounts: [AccountResponse] = []
    @State private var categories: [CategoryResponse] = []
    @State private var isLoading = true
    @State private var isPosting = false
    @State private var postedMessage: String?
    @State private var showingAddRule = false
    @State private var editingRule: RecurringTransactionResponse?
    @State private var errorMessage: String?

    // Delete confirmation + per-row state lives here, not on the row itself —
    // a `.confirmationDialog` presented from a view inside a swipe-actions
    // row can get torn down along with the row's own dismiss animation
    // before the user ever sees it, silently skipping the confirmation.
    @State private var pendingDelete: RecurringTransactionResponse?
    @State private var deletingRuleId: String?
    @State private var rowErrors: [String: String] = [:]

    private var currency: String { session.activeHousehold?.baseCurrency ?? "USD" }

    private var visibleRules: [RecurringTransactionResponse] {
        rules.filter { viewModeStore.isVisible(ownerUserId: $0.ownerUserId, currentUserId: session.user?.id) }
    }

    private var visibleUpcoming: [UpcomingOccurrence] {
        let ids = Set(visibleRules.map(\.id))
        return upcoming.filter { ids.contains($0.recurringTransactionId) }
    }

    private var categoryTypes: [String: TransactionType] {
        Dictionary(uniqueKeysWithValues: categories.map { ($0.id, $0.type) })
    }

    /// System categories (Transfer, Balance Adjustment, ...) are bookkeeping the
    /// app files for itself, not something a rule should post under — filing
    /// rent under "Balance Adjustment" would misclassify it and fight the
    /// reconciliation logic that owns that category.
    private var selectableCategories: [CategoryResponse] {
        categories.filter { !$0.isSystem }
    }

    private var commitment: (income: Double, expense: Double, net: Double) {
        BudgetPresentation.monthlyCommitment(rules: visibleRules, categoryTypes: categoryTypes)
    }

    /// Rules whose next occurrence is already due — the nightly job hasn't run yet.
    private var dueCount: Int {
        CashFlowSummary.dueNow(rules: visibleRules).count
    }

    private var categoryNames: [String: String] {
        Dictionary(uniqueKeysWithValues: categories.map { ($0.id, $0.name) })
    }

    /// Where the monthly commitment actually goes. The totals above say how
    /// much; this says on what, which is the half that changes behaviour.
    private var commitmentSlices: [BudgetPresentation.CommitmentSlice] {
        BudgetPresentation.commitmentByCategory(
            rules: visibleRules,
            categoryTypes: categoryTypes,
            categoryNames: categoryNames
        )
    }

    /// Rules bucketed by what they are actually doing.
    ///
    /// A flat list gave a rule that will never post again the same weight as
    /// one due tomorrow. Empty buckets are dropped, so a household whose rules
    /// are all fine sees one plain "Rules" section and no scaffolding.
    private var ruleGroups: [(id: String, label: String, rules: [RecurringTransactionResponse])] {
        var attention: [RecurringTransactionResponse] = []
        var active: [RecurringTransactionResponse] = []
        var paused: [RecurringTransactionResponse] = []
        for rule in visibleRules {
            switch BudgetPresentation.health(of: rule) {
            case .overdue, .ended: attention.append(rule)
            case .healthy: active.append(rule)
            case .paused: paused.append(rule)
            }
        }
        // "Rules" rather than "Active" when nothing else is on screen: a lone
        // bucket doesn't need a name distinguishing it from buckets that
        // aren't there.
        let activeLabel = attention.isEmpty && paused.isEmpty ? "Rules" : "Active"
        return [
            (id: "attention", label: "Needs attention", rules: attention),
            (id: "active", label: activeLabel, rules: active),
            (id: "paused", label: "Paused", rules: paused),
        ].filter { !$0.rules.isEmpty }
    }

    var body: some View {
        List {
            Section {
                LabeledContent("Committed / month") {
                    Text(commitment.expense.currencyWhole(currency)).monospacedDigit()
                }
                LabeledContent("Expected / month") {
                    Text(commitment.income.currencyWhole(currency))
                        .monospacedDigit()
                        .foregroundStyle(.green)
                }
                LabeledContent("Net / month") {
                    Text(commitment.net.currencyWhole(currency))
                        .monospacedDigit()
                        .foregroundStyle(commitment.net >= 0 ? Color.primary : Color.red)
                }
            } footer: {
                Text(commitment.net >= 0
                    ? "Your recurring income covers your recurring commitments."
                    : "Your recurring commitments exceed your recurring income.")
            }

            if !commitmentSlices.isEmpty {
                Section {
                    ForEach(commitmentSlices) { slice in
                        CommitmentSliceRow(
                            slice: slice,
                            share: commitment.expense > 0 ? slice.monthly / commitment.expense : 0,
                            currency: currency
                        )
                    }
                } header: {
                    Text("Where it goes")
                } footer: {
                    // Without this the biggest number on the screen looks wrong
                    // to anyone whose commitments aren't all monthly.
                    Text("Every cadence normalised to a month, so a yearly premium and a weekly cleaner compare directly.")
                }
            }

            if dueCount > 0 {
                Section {
                    Button {
                        Task { await postDue() }
                    } label: {
                        HStack {
                            Label(
                                "Post \(dueCount) due now",
                                systemImage: "arrow.down.circle"
                            )
                            Spacer()
                            if isPosting { ProgressView() }
                        }
                    }
                    .disabled(isPosting)
                } footer: {
                    Text("These post automatically overnight — this just doesn't wait.")
                }
            }

            if let postedMessage {
                Section {
                    Label(postedMessage, systemImage: "checkmark.circle")
                        .foregroundStyle(.green)
                }
            }

            ForEach(ruleGroups, id: \.id) { group in
                Section(group.label) {
                    ForEach(group.rules) { rule in
                        RecurringRuleRow(
                            rule: rule,
                            category: categories.first { $0.id == rule.categoryId },
                            accountName: accounts.first { $0.id == rule.accountId }?.name,
                            currency: currency,
                            isDeleting: deletingRuleId == rule.id,
                            rowError: rowErrors[rule.id],
                            accounts: accounts,
                            categories: categories,
                            onToggle: { await setActive(rule, isActive: !rule.isActive) },
                            onRequestDelete: { pendingDelete = rule },
                            onEdit: { editingRule = rule },
                            onChanged: load
                        )
                    }
                }
            }

            if visibleRules.isEmpty && !isLoading {
                Section("Rules") {
                    Text("Nothing recurring yet. Add your salary and rent first — they make the rest of the picture accurate.")
                        .foregroundStyle(.secondary)
                }
            }

            ForEach(BudgetPresentation.groupedByMonth(visibleUpcoming), id: \.id) { group in
                Section(group.label) {
                    ForEach(group.items) { item in
                        HStack {
                            Text(item.date.shortDay)
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.secondary)
                                .frame(width: 52, alignment: .leading)
                            Text(item.description ?? item.categoryName)
                                .lineLimit(1)
                            Spacer()
                            Text(signedAmount(item))
                                .font(.subheadline.monospacedDigit())
                                .foregroundStyle(item.transactionType == .income ? .green : .primary)
                        }
                    }
                }
            }
        }
        .navigationTitle("Recurring")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showingAddRule = true
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("New Recurring Transaction")
                .disabled(accounts.isEmpty || selectableCategories.isEmpty)
            }
        }
        .sheet(isPresented: $showingAddRule) {
            RecurringFormView(accounts: accounts, categories: selectableCategories) { await load() }
        }
        .sheet(item: $editingRule) { rule in
            RecurringFormView(accounts: accounts, categories: selectableCategories, existing: rule) { await load() }
        }
        .overlay {
            if isLoading && rules.isEmpty { LoadingSkeleton() }
        }
        .quickAddPull(quickAdd, onReload: load)
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
        .confirmationDialog(
            "Delete this recurring transaction?",
            isPresented: .init(
                get: { pendingDelete != nil },
                set: { if !$0 { pendingDelete = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let rule = pendingDelete {
                    Task { await confirmDelete(rule) }
                }
            }
        } message: {
            Text("Transactions it already posted stay in your history — only future occurrences stop.")
        }
    }

    private func signedAmount(_ item: UpcomingOccurrence) -> String {
        let sign = item.transactionType == .income ? "+" : "−"
        return sign + item.amount.currencyWhole(item.currency ?? currency)
    }

    private func load() async {
        guard let household = session.activeHousehold else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            async let rulesReq: [RecurringTransactionResponse] =
                APIClient.shared.get("/cashflow/recurring/household/\(household.id)")
            async let upcomingReq: [UpcomingOccurrence] =
                APIClient.shared.get("/cashflow/recurring/household/\(household.id)/upcoming?days=90")
            async let accountsReq: [AccountResponse] =
                APIClient.shared.get("/accounts/household/\(household.id)")
            async let categoriesReq: [CategoryResponse] =
                APIClient.shared.get("/cashflow/categories/household/\(household.id)")
            (rules, upcoming, accounts, categories) =
                try await (rulesReq, upcomingReq, accountsReq, categoriesReq)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func postDue() async {
        guard let household = session.activeHousehold else { return }
        isPosting = true
        defer { isPosting = false }
        do {
            let result: RecurringRunResponse = try await APIClient.shared.post(
                "/cashflow/recurring/household/\(household.id)/run",
                body: EmptyBody()
            )
            postedMessage = "Posted \(result.posted) transaction\(result.posted == 1 ? "" : "s")."
            await load()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func setActive(_ rule: RecurringTransactionResponse, isActive: Bool) async {
        do {
            let _: RecurringTransactionResponse = try await APIClient.shared.put(
                "/cashflow/recurring/\(rule.id)",
                body: RecurringTransactionUpdate(isActive: isActive)
            )
            await load()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Keyed by rule id, not a screen-wide alert — a failure here shouldn't
    /// block the rest of the list, and the row it happened on is the one
    /// place the user is already looking.
    private func confirmDelete(_ rule: RecurringTransactionResponse) async {
        pendingDelete = nil
        deletingRuleId = rule.id
        rowErrors[rule.id] = nil
        do {
            try await APIClient.shared.delete("/cashflow/recurring/\(rule.id)")
            await load()
        } catch {
            rowErrors[rule.id] = error.localizedDescription
        }
        deletingRuleId = nil
    }
}

/// POST bodies that carry no payload still need something Encodable.
struct EmptyBody: Encodable {}

struct RecurringRuleRow: View {
    let rule: RecurringTransactionResponse
    let category: CategoryResponse?
    let accountName: String?
    let currency: String
    /// Driven from `RecurringView`, not local `@State` — a `.confirmationDialog`
    /// presented from a view living inside a swipe-actions row can get torn
    /// down along with the row's own collapse animation before it's ever
    /// seen, which silently skips the confirmation. Keeping the pending/error
    /// state at the screen level (mirrors the Android port) sidesteps that.
    let isDeleting: Bool
    let rowError: String?
    let accounts: [AccountResponse]
    let categories: [CategoryResponse]
    let onToggle: () async -> Void
    let onRequestDelete: () -> Void
    let onEdit: () -> Void
    let onChanged: () async -> Void

    private var isIncome: Bool { category?.type == .income }

    private var health: BudgetPresentation.RuleHealth {
        BudgetPresentation.health(of: rule)
    }

    var body: some View {
        // The row pushes the rule's own screen rather than opening the edit
        // form. "How do I change this" was the only question the form answered;
        // "is this still doing what I set it up to do" is the one a rule raises,
        // and that needs the history. Edit is still one tap from there, and on
        // the swipe and the context menu here.
        NavigationLink {
            RecurringDetailView(
                rule: rule,
                category: category,
                accountName: accountName,
                accounts: accounts,
                categories: categories,
                onChanged: onChanged
            )
        } label: {
            rowContent
        }
            .opacity(rule.isActive ? 1 : 0.55)
            .swipeActions(edge: .leading) {
                Button {
                    Task { await onToggle() }
                } label: {
                    Label(rule.isActive ? "Pause" : "Resume",
                          systemImage: rule.isActive ? "pause" : "play")
                }
                .tint(.orange)
            }
            // `allowsFullSwipe: false` so a fast full swipe reveals the button
            // rather than deleting outright — the confirmation dialog (shown
            // from the parent once `onRequestDelete` fires) is the only path to
            // an actual delete.
            .swipeActions(allowsFullSwipe: false) {
                Button(role: .destructive, action: onRequestDelete) {
                    Label("Delete", systemImage: "trash")
                }
                .disabled(isDeleting)
            }
            // Both swipes again on a long press: a swipe is invisible until you try it and
            // unreachable from Voice Control / Switch Control. The leading Pause/Resume is
            // especially easy to miss — nothing on the row says a left edge exists.
            .contextMenu {
                Button(action: onEdit) {
                    Label("Edit", systemImage: "pencil")
                }
                Button {
                    Task { await onToggle() }
                } label: {
                    Label(rule.isActive ? "Pause" : "Resume",
                          systemImage: rule.isActive ? "pause" : "play")
                }
                Button(role: .destructive, action: onRequestDelete) {
                    Label("Delete", systemImage: "trash")
                }
                .disabled(isDeleting)
            }
    }

    private var rowContent: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Image(systemName: isIncome ? "arrow.down.circle.fill" : "arrow.up.circle.fill")
                    .foregroundStyle(isIncome ? .green : .secondary)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(rule.description ?? category?.name ?? "Recurring")
                        if rule.ownerUserId != nil {
                            Image(systemName: "lock.fill")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        if health == .paused {
                            RuleStateChip(text: "PAUSED", tint: .secondary)
                        } else if health == .ended {
                            RuleStateChip(text: "ENDED", tint: .secondary)
                        } else if health == .overdue {
                            RuleStateChip(text: "DUE", tint: .orange)
                        }
                    }
                    Text("\(rule.frequency.label) · \(category?.name ?? "—") · \(accountName ?? "—")")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    // What it has actually done. Absent for a rule that has
                    // never posted — "0 times" reads like a broken counter,
                    // and a brand-new rule isn't broken.
                    if let posted = BudgetPresentation.postingLabel(for: rule) {
                        Text(posted)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text((isIncome ? "+" : "−") + rule.amount.currencyWhole(rule.currency ?? currency))
                        .font(.body.monospacedDigit())
                        .foregroundStyle(isIncome ? .green : .primary)
                    Text(BudgetPresentation.scheduleLabel(for: rule))
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(health == .overdue ? .orange : .secondary)
                }
            }
            if let rowError {
                Text(rowError)
                    .font(.caption2)
                    .foregroundStyle(.red)
            }
        }
    }
}

/// Create a recurring rule, or edit an existing one's schedule/targets.
struct RecurringFormView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(SessionStore.self) private var session

    let accounts: [AccountResponse]
    let categories: [CategoryResponse]
    /// Non-nil in edit mode. Ownership can't be changed here — the backend's
    /// `RecurringTransactionUpdate` has no `owner_user_id` field — so the
    /// Private toggle only appears when creating.
    let existing: RecurringTransactionResponse?
    let onSaved: () async -> Void

    @State private var description: String
    @State private var categoryId: String
    @State private var accountId: String
    @State private var amountText: String
    @State private var frequency: RecurrenceFrequency
    @State private var startDate: Date
    @State private var hasEndDate: Bool
    @State private var endDate: Date
    @State private var isPrivate = false
    @State private var didSeedPrivacy: Bool
    @State private var isSaving = false
    @State private var errorMessage: String?

    init(
        accounts: [AccountResponse],
        categories: [CategoryResponse],
        existing: RecurringTransactionResponse? = nil,
        onSaved: @escaping () async -> Void
    ) {
        self.accounts = accounts
        self.categories = categories
        self.existing = existing
        self.onSaved = onSaved
        _description = State(initialValue: existing?.description ?? "")
        _categoryId = State(initialValue: existing?.categoryId ?? "")
        _accountId = State(initialValue: existing?.accountId ?? "")
        _amountText = State(initialValue: existing.map { String($0.amount) } ?? "")
        _frequency = State(initialValue: existing?.frequency ?? .monthly)
        _startDate = State(initialValue: existing?.startDate ?? Date())
        _hasEndDate = State(initialValue: existing?.endDate != nil)
        _endDate = State(initialValue: existing?.endDate ?? Date())
        // Edit mode has nothing left to seed after init, so it's settled
        // immediately; create mode waits for the `onAppear` privacy seed below.
        _didSeedPrivacy = State(initialValue: existing != nil)
    }

    private var amount: Double? {
        guard let value = CalculatorInput.evaluateArithmeticExpression(amountText), value > 0 else { return nil }
        return value
    }

    private var canSave: Bool {
        amount != nil && !categoryId.isEmpty && !accountId.isEmpty && !isSaving
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Description (e.g. Rent)", text: $description)
                    Picker("Category", selection: $categoryId) {
                        Text("Choose…").tag("")
                        ForEach(categories) { Text("\($0.name) (\($0.type.rawValue))").tag($0.id) }
                    }
                    Picker("Account", selection: $accountId) {
                        Text("Choose…").tag("")
                        ForEach(selectableAccounts(accounts)) { Text($0.name).tag($0.id) }
                    }
                } footer: {
                    Text("An income category adds to the account; an expense category subtracts.")
                }

                Section {
                    CalculatorField(placeholder: "Amount", text: $amountText)
                    Picker("Frequency", selection: $frequency) {
                        ForEach(RecurrenceFrequency.allCases) { Text($0.label).tag($0) }
                    }
                    DatePicker("First occurrence", selection: $startDate, displayedComponents: .date)
                    Toggle("Set an end date", isOn: $hasEndDate.animation())
                    if hasEndDate {
                        DatePicker("Ends", selection: $endDate, displayedComponents: .date)
                    }
                } footer: {
                    Text("Back-date the first occurrence and we'll catch up everything you've already paid.")
                }

                if existing == nil {
                    Section {
                        Toggle("Private to me", isOn: $isPrivate)
                    }
                }

                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle(existing == nil ? "New Recurring" : "Edit Recurring")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .disabled(!canSave)
                }
            }
            .discardGuard(
                fields: [description, categoryId, accountId, amountText, frequency, startDate, hasEndDate, endDate, isPrivate],
                // `onAppear` below fills in the private-by-default toggle;
                // that isn't an edit the user made.
                settled: didSeedPrivacy
            )
            .onAppear {
                // SessionStore isn't reachable from init, same as AccountFormView.
                if !didSeedPrivacy {
                    isPrivate = session.user?.defaultsNewItemsPrivate ?? false
                    didSeedPrivacy = true
                }
            }
        }
    }

    private func save() {
        guard let amount else { return }
        isSaving = true
        errorMessage = nil
        let trimmedDescription = description.trimmingCharacters(in: .whitespaces)
        Task {
            defer { isSaving = false }
            do {
                if let existing {
                    let _: RecurringTransactionResponse = try await APIClient.shared.put(
                        "/cashflow/recurring/\(existing.id)",
                        body: RecurringTransactionEdit(
                            accountId: accountId,
                            categoryId: categoryId,
                            amount: amount,
                            description: trimmedDescription.isEmpty ? nil : trimmedDescription,
                            frequency: frequency,
                            startDate: startDate.apiDateOnly,
                            endDate: hasEndDate ? endDate.apiDateOnly : nil
                        )
                    )
                } else {
                    guard let household = session.activeHousehold else { return }
                    let _: RecurringTransactionResponse = try await APIClient.shared.post(
                        "/cashflow/recurring",
                        body: RecurringTransactionCreate(
                            householdId: household.id,
                            accountId: accountId,
                            categoryId: categoryId,
                            amount: amount,
                            description: trimmedDescription.isEmpty ? nil : trimmedDescription,
                            frequency: frequency,
                            startDate: startDate.apiDateOnly,
                            endDate: hasEndDate ? endDate.apiDateOnly : nil,
                            ownerUserId: isPrivate ? session.user?.id : nil
                        )
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

/// A small state chip on a rule row: PAUSED / ENDED / DUE.
///
/// Three states the row used to compress into one — a rule past its end date
/// printed a "next" date it will never post on, and one the nightly job had
/// missed looked exactly like one due tomorrow.
struct RuleStateChip: View {
    let text: String
    let tint: Color

    var body: some View {
        Text(text)
            .font(.caption2.bold())
            .foregroundStyle(tint)
    }
}

/// One category's share of the monthly commitment, with a bar for its weight.
///
/// Deliberately not a donut: this is a ranked list where the top two or three
/// are the answer, and a bar per row reads at a glance without a legend.
struct CommitmentSliceRow: View {
    let slice: BudgetPresentation.CommitmentSlice
    /// 0...1 of the total monthly expense commitment.
    let share: Double
    let currency: String

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(slice.name)
                    .lineLimit(1)
                if slice.ruleCount > 1 {
                    Text("\(slice.ruleCount)")
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(Capsule().fill(.quaternary))
                }
                Spacer()
                Text(slice.monthly.currencyWhole(currency) + "/mo")
                    .font(.subheadline.monospacedDigit())
            }
            ProgressView(value: min(max(share, 0), 1))
                .tint(.secondary)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            "\(slice.name), \(slice.monthly.currencyWhole(currency)) per month"
            + (slice.ruleCount > 1 ? ", \(slice.ruleCount) rules" : "")
        )
    }
}
