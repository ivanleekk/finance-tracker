import SwiftUI

// The New/Edit Transaction sheet and the Internal Transfer sheet, lifted out of
// TransactionsView.swift. They are self-contained sheets rather than part of the
// list, and the file that owns the list is easier to read without ~400 lines of
// form in the middle of it.

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
