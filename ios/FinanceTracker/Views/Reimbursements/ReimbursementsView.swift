import SwiftUI

/// Who owes you, and who you owe. Native counterpart of the web /reimbursements page.
///
/// The two directions are kept as two sections rather than netted into one
/// figure: someone can owe you for last night and be owed for last week, and
/// collapsing that loses the fact that there are two things to settle.
struct ReimbursementsView: View {
    @Environment(SessionStore.self) private var session
    @Environment(QuickAddStore.self) private var quickAdd

    @State private var balances: [CounterpartyBalanceResponse] = []
    @State private var accounts: [AccountResponse] = []
    @State private var categories: [CategoryResponse] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var settling: CounterpartyBalanceResponse?
    @State private var showingOnBehalf = false

    private var currency: String {
        session.activeHousehold?.baseCurrency ?? "USD"
    }

    private var owedToYou: [CounterpartyBalanceResponse] {
        balances.filter { $0.direction == .owedToYou }
    }

    private var youOwe: [CounterpartyBalanceResponse] {
        balances.filter { $0.direction == .youOwe }
    }

    var body: some View {
        List {
            if !balances.isEmpty {
                Section {
                    let totals = Reimbursements.totals(balances)
                    LabeledContent("Owed to you") {
                        Text(totals.owedToYou.currency(currency))
                            .monospacedDigit()
                            .foregroundStyle(totals.owedToYou > 0 ? Color.green : .primary)
                    }
                    LabeledContent("You owe") {
                        Text(totals.youOwe.currency(currency))
                            .monospacedDigit()
                            .foregroundStyle(totals.youOwe > 0 ? Color.red : .primary)
                    }
                }
            }

            Section("Owes you") {
                if owedToYou.isEmpty {
                    Text("Nobody owes you anything. When you pay for someone, turn on “Someone owes me for part of this” as you log the transaction.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(owedToYou) { row in
                        CounterpartyRow(row: row, currency: currency) { settling = row }
                    }
                }
            }

            Section {
                if youOwe.isEmpty {
                    Text("You don't owe anyone.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(youOwe) { row in
                        CounterpartyRow(row: row, currency: currency) { settling = row }
                    }
                }
            } header: {
                Text("You owe")
            } footer: {
                if !youOwe.isEmpty {
                    Text("Already counted in your budgets — it was spending of yours, whoever paid.")
                }
            }
        }
        .navigationTitle("Shared Spending")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showingOnBehalf = true
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("Someone paid for me")
                .disabled(categories.filter { $0.type == .expense }.isEmpty)
            }
        }
        .sheet(item: $settling) { row in
            SettlementFormView(balance: row, accounts: accounts, currency: currency) {
                await load()
            }
        }
        .sheet(isPresented: $showingOnBehalf) {
            SpendOnYourBehalfFormView(categories: categories.filter { $0.type == .expense }) {
                await load()
            }
        }
        .overlay {
            if isLoading && balances.isEmpty { LoadingSkeleton() }
        }
        .quickAddPull(quickAdd, onReload: load)
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

    private func load() async {
        guard let household = session.activeHousehold else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            async let balancesReq: [CounterpartyBalanceResponse] =
                APIClient.shared.get("/cashflow/reimbursements/household/\(household.id)")
            async let accountsReq: [AccountResponse] =
                APIClient.shared.get("/accounts/household/\(household.id)")
            async let categoriesReq: [CategoryResponse] =
                APIClient.shared.get("/cashflow/categories/household/\(household.id)")
            (balances, accounts, categories) = try await (balancesReq, accountsReq, categoriesReq)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct CounterpartyRow: View {
    let row: CounterpartyBalanceResponse
    let currency: String
    let onSettle: () -> Void

    var body: some View {
        HStack {
            Text(row.counterpartyName)
            Spacer()
            Text(row.amount.currency(currency))
                .monospacedDigit()
                .foregroundStyle(row.direction == .owedToYou ? Color.green : Color.red)
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: onSettle)
        .swipeActions(edge: .trailing) {
            Button("Settle", action: onSettle).tint(.blue)
        }
    }
}

/// Recording money that actually changed hands to clear a debt.
///
/// The amount is prefilled with the whole balance because settling in full is
/// the common case, but it stays editable — partial repayments are normal, and
/// the ledger handles them by simply leaving the rest outstanding.
struct SettlementFormView: View {
    @Environment(\.dismiss) private var dismiss

    let balance: CounterpartyBalanceResponse
    let accounts: [AccountResponse]
    let currency: String
    let onSaved: () async -> Void

    @State private var accountId: String?
    @State private var amountText: String
    @State private var date = Date()
    @State private var isSaving = false
    @State private var errorMessage: String?

    init(
        balance: CounterpartyBalanceResponse,
        accounts: [AccountResponse],
        currency: String,
        onSaved: @escaping () async -> Void
    ) {
        self.balance = balance
        self.accounts = accounts
        self.currency = currency
        self.onSaved = onSaved
        _amountText = State(initialValue: String(format: "%.2f", balance.amount))
    }

    private var receiving: Bool { balance.direction == .owedToYou }

    private var amount: Double? { Reimbursements.parseMoney(amountText) }

    private var canSave: Bool { (amount ?? 0) > 0 && accountId != nil && !isSaving }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent(receiving ? "Owed by" : "Owed to") {
                        Text(balance.counterpartyName)
                    }
                    LabeledContent("Outstanding") {
                        Text(balance.amount.currency(currency)).monospacedDigit()
                    }
                }

                Section {
                    Picker(receiving ? "Into account" : "From account", selection: $accountId) {
                        Text("Select").tag(String?.none)
                        ForEach(selectableAccounts(accounts)) { account in
                            Text(account.name).tag(String?.some(account.id))
                        }
                    }
                    HStack {
                        Text("Amount")
                        TextField("0.00", text: $amountText)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                    }
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                } footer: {
                    Text("Moves the account balance but charges no category — the spending was already recorded when the bill was paid.")
                }

                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle(receiving ? "Record Repayment" : "Pay Back")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }.disabled(!canSave)
                }
            }
            .onAppear {
                if accountId == nil { accountId = accounts.first?.id }
            }
        }
    }

    private func save() {
        guard let amount, let accountId else { return }
        isSaving = true
        errorMessage = nil
        Task {
            defer { isSaving = false }
            do {
                let body = SettlementCreate(
                    accountId: accountId,
                    counterpartyName: balance.counterpartyName,
                    direction: balance.direction,
                    amount: amount,
                    date: date,
                    description: nil
                )
                let _: TransactionResponse = try await APIClient.shared.post(
                    "/cashflow/reimbursements/settle", body: body
                )
                await onSaved()
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

/// Somebody else paid for something of yours.
///
/// There is no account to pick because no account of yours moved — which is
/// exactly why this could not be logged before the ledger. The cost still counts
/// towards your budget, and you owe them until you settle up.
struct SpendOnYourBehalfFormView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(SessionStore.self) private var session

    let categories: [CategoryResponse]
    let onSaved: () async -> Void

    @State private var counterpartyName = ""
    @State private var categoryId: String?
    @State private var amountText = ""
    @State private var date = Date()
    @State private var description = ""
    @State private var isSaving = false
    @State private var errorMessage: String?

    private var amount: Double? { Reimbursements.parseMoney(amountText) }

    private var trimmedName: String {
        counterpartyName.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var canSave: Bool {
        (amount ?? 0) > 0 && categoryId != nil && !trimmedName.isEmpty && !isSaving
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Who paid (e.g. Bob)", text: $counterpartyName)
                        .textInputAutocapitalization(.words)
                    Picker("Category", selection: $categoryId) {
                        Text("Select").tag(String?.none)
                        ForEach(categories) { category in
                            Text(category.name).tag(String?.some(category.id))
                        }
                    }
                    HStack {
                        Text("Amount")
                        TextField("0.00", text: $amountText)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                    }
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                    TextField("Description (optional)", text: $description)
                } footer: {
                    Text("No account of yours moved, so there's nothing to log against one. It still counts towards your budget, and you'll owe them until you settle up.")
                }

                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Someone Paid For Me")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }.disabled(!canSave)
                }
            }
            .onAppear {
                if categoryId == nil { categoryId = categories.first?.id }
            }
        }
    }

    private func save() {
        guard let amount, let categoryId, let household = session.activeHousehold else { return }
        isSaving = true
        errorMessage = nil
        Task {
            defer { isSaving = false }
            do {
                let body = SpendOnYourBehalfCreate(
                    householdId: household.id,
                    categoryId: categoryId,
                    counterpartyName: trimmedName,
                    amount: amount,
                    date: date,
                    description: description.isEmpty ? nil : description
                )
                let _: CounterpartyBalanceResponse = try await APIClient.shared.post(
                    "/cashflow/reimbursements/on-behalf", body: body
                )
                await onSaved()
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}
