import SwiftUI

/// Recurring transactions — salary, rent, subscriptions. Native counterpart of
/// the web /recurring page, reached from the More tab.
///
/// Rules post themselves overnight (the backend daily job), so this screen is
/// about seeing what's committed and correcting it, not about data entry.
struct RecurringView: View {
    @Environment(SessionStore.self) private var session
    @Environment(ViewModeStore.self) private var viewModeStore

    @State private var rules: [RecurringTransactionResponse] = []
    @State private var upcoming: [UpcomingOccurrence] = []
    @State private var accounts: [AccountResponse] = []
    @State private var categories: [CategoryResponse] = []
    @State private var isLoading = true
    @State private var isPosting = false
    @State private var postedMessage: String?
    @State private var showingAddRule = false
    @State private var errorMessage: String?

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

    private var commitment: (income: Double, expense: Double, net: Double) {
        BudgetPresentation.monthlyCommitment(rules: visibleRules, categoryTypes: categoryTypes)
    }

    /// Rules whose next occurrence is already due — the nightly job hasn't run yet.
    private var dueCount: Int {
        let today = Date()
        return visibleRules.filter { $0.isActive && $0.nextDueDate <= today }.count
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

            Section("Rules") {
                ForEach(visibleRules) { rule in
                    RecurringRuleRow(
                        rule: rule,
                        category: categories.first { $0.id == rule.categoryId },
                        accountName: accounts.first { $0.id == rule.accountId }?.name,
                        currency: currency
                    )
                    .swipeActions(edge: .leading) {
                        Button {
                            Task { await setActive(rule, isActive: !rule.isActive) }
                        } label: {
                            Label(rule.isActive ? "Pause" : "Resume",
                                  systemImage: rule.isActive ? "pause" : "play")
                        }
                        .tint(.orange)
                    }
                    .swipeActions {
                        Button(role: .destructive) {
                            Task { await delete(rule) }
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                }
                if visibleRules.isEmpty && !isLoading {
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
                .disabled(accounts.isEmpty || categories.isEmpty)
            }
        }
        .sheet(isPresented: $showingAddRule) {
            RecurringFormView(accounts: accounts, categories: categories) { await load() }
        }
        .overlay {
            if isLoading && rules.isEmpty { LoadingSkeleton() }
        }
        .refreshable { await load() }
        .task { await load() }
        .alert("Error", isPresented: .init(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage ?? "")
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

    private func delete(_ rule: RecurringTransactionResponse) async {
        do {
            try await APIClient.shared.delete("/cashflow/recurring/\(rule.id)")
            await load()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// POST bodies that carry no payload still need something Encodable.
struct EmptyBody: Encodable {}

struct RecurringRuleRow: View {
    let rule: RecurringTransactionResponse
    let category: CategoryResponse?
    let accountName: String?
    let currency: String

    private var isIncome: Bool { category?.type == .income }

    var body: some View {
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
                    if !rule.isActive {
                        Text("PAUSED")
                            .font(.caption2.bold())
                            .foregroundStyle(.secondary)
                    }
                }
                Text("\(rule.frequency.label) · \(category?.name ?? "—") · \(accountName ?? "—")")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text((isIncome ? "+" : "−") + rule.amount.currencyWhole(rule.currency ?? currency))
                    .font(.body.monospacedDigit())
                    .foregroundStyle(isIncome ? .green : .primary)
                Text(rule.isActive ? "next \(rule.nextDueDate.shortDay)" : "paused")
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
        }
        .opacity(rule.isActive ? 1 : 0.55)
    }
}

/// Create a recurring rule.
struct RecurringFormView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(SessionStore.self) private var session

    let accounts: [AccountResponse]
    let categories: [CategoryResponse]
    let onSaved: () async -> Void

    @State private var description = ""
    @State private var categoryId = ""
    @State private var accountId = ""
    @State private var amountText = ""
    @State private var frequency: RecurrenceFrequency = .monthly
    @State private var startDate = Date()
    @State private var hasEndDate = false
    @State private var endDate = Date()
    @State private var isPrivate = false
    @State private var didSeedPrivacy = false
    @State private var isSaving = false
    @State private var errorMessage: String?

    private var amount: Double? {
        let cleaned = amountText.replacingOccurrences(of: ",", with: "").trimmingCharacters(in: .whitespaces)
        guard let value = Double(cleaned), value > 0 else { return nil }
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
                        ForEach(accounts) { Text($0.name).tag($0.id) }
                    }
                } footer: {
                    Text("An income category adds to the account; an expense category subtracts.")
                }

                Section {
                    TextField("Amount", text: $amountText)
                        .keyboardType(.decimalPad)
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

                Section {
                    Toggle("Private to me", isOn: $isPrivate)
                }

                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("New Recurring")
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
                // SessionStore isn't reachable from init, same as AccountFormView.
                if !didSeedPrivacy {
                    isPrivate = session.user?.defaultsNewItemsPrivate ?? false
                    didSeedPrivacy = true
                }
            }
        }
    }

    private func save() {
        guard let amount, let household = session.activeHousehold else { return }
        isSaving = true
        errorMessage = nil
        let trimmedDescription = description.trimmingCharacters(in: .whitespaces)
        Task {
            defer { isSaving = false }
            do {
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
                await onSaved()
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}
