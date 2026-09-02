import SwiftUI

// The New/Edit Transaction sheet and the Internal Transfer sheet, lifted out of
// TransactionsView.swift. They are self-contained sheets rather than part of the
// list, and the file that owns the list is easier to read without ~400 lines of
// form in the middle of it.

/// One row of the split editor: a picked person and their (still-typed) share.
/// A stable `id`, minted once when the row is created, is what lets `ForEach`
/// track a row across edits without depending on the (possibly still-blank)
/// counterparty pick.
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
    /// Part of this bill is one or more other people's. The amount above stays
    /// the full sum that leaves the account — this only records whose it was.
    @State private var isSplitting: Bool
    @State private var splitRows: [SplitRow]
    @State private var counterparties: [Counterparty]
    /// Inline "+ New Person" affordance, same shape as "+ New Category" below:
    /// adding a person appends them as a new split row rather than filling one
    /// in, since there's no single row to target until at least one exists.
    /// Empty means "not recorded", which is the normal case — most purchases have
    /// no code the user happens to know.
    @State private var mcc: String
    /// The card's own category, when the selected account is a card. Empty means
    /// the card's default, which is where untagged spend lands.
    @State private var cardCategoryId: String
    /// Loaded on demand when a card account is selected — most accounts are not
    /// cards, so this is not fetched with the form.
    @State private var card: CardResponse?
    @State private var cardHeadroom: [String: CardLimitStatusRow] = [:]

    init(
        accounts: [AccountResponse],
        categories: [CategoryResponse],
        counterparties: [Counterparty],
        householdId: String,
        existing: TransactionResponse? = nil,
        onSaved: @escaping () async -> Void
    ) {
        self.accounts = accounts
        self.householdId = householdId
        self.existing = existing
        self.onSaved = onSaved
        _categories = State(initialValue: categories)
        _counterparties = State(initialValue: counterparties)
        _type = State(initialValue: existing?.transactionType ?? .expense)
        _amountText = State(initialValue: existing.map { Self.amountString($0.amount) } ?? "")
        _date = State(initialValue: existing?.date ?? Date())
        _description = State(initialValue: existing?.description ?? "")
        _accountId = State(initialValue: existing?.accountId)
        _categoryId = State(initialValue: existing?.categoryId)
        let existingSplits = existing?.splits ?? []
        _isSplitting = State(initialValue: !existingSplits.isEmpty)
        _splitRows = State(initialValue: existingSplits.map {
            SplitRow(counterpartyId: $0.counterpartyId, amountText: Self.amountString($0.amount))
        })
        _mcc = State(initialValue: existing?.mcc ?? "")
        _cardCategoryId = State(initialValue: existing?.cardCategoryId ?? "")
    }

    /// Editable string for a stored amount: drop the trailing ".0" on whole numbers.
    private static func amountString(_ value: Double) -> String {
        value == value.rounded() ? String(Int(value)) : String(value)
    }

    private var filteredCategories: [CategoryResponse] {
        categories.filter { $0.type == type }
    }

    private var amount: Double? {
        CalculatorInput.evaluateArithmeticExpression(amountText)
    }

    private var canSave: Bool {
        amount ?? 0 > 0 && accountId != nil && categoryId != nil && !isSaving
            && TransactionSplits.isUsable(isSplitting: isSplitting, amount: amount, rows: splitRows)
    }

    /// Counterparties still pickable for a given row — everyone already chosen
    /// in another row is excluded, so the same person can't be picked twice.
    private func pickableCounterparties(for rowId: UUID) -> [Counterparty] {
        let pickedElsewhere = Set(splitRows.filter { $0.id != rowId }.compactMap(\.counterpartyId))
        return counterparties.filter { !pickedElsewhere.contains($0.id) }
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
                    .draggableSegments(options: [TransactionType.expense, .income], selection: $type)
                    .listRowBackground(Color.clear)
                    .onChange(of: type) {
                        categoryId = filteredCategories.first?.id
                    }
                }

                Section {
                    HStack {
                        Text("Amount")
                        CalculatorField(placeholder: "0.00", text: $amountText)
                            .multilineTextAlignment(.trailing)
                    }
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                    TextField("Description (optional)", text: $description)
                }

                Section {
                    Picker("Account", selection: $accountId) {
                        Text("Select").tag(String?.none)
                        ForEach(selectableAccounts(accounts)) { account in
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

                if type == .expense {
                    TransactionSplitSection(
                        amount: amount,
                        householdId: householdId,
                        isSplitting: $isSplitting,
                        splitRows: $splitRows,
                        counterparties: $counterparties
                    )
                }

                CardCategorySection(
                    card: card,
                    headroom: cardHeadroom,
                    currency: card?.currency ?? session.activeHousehold?.baseCurrency ?? "USD",
                    cardCategoryId: $cardCategoryId
                )

                MerchantCodeSection(mcc: $mcc)

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
            .discardGuard(fields: [
                type, amountText, date, description, accountId, categoryId, mcc, cardCategoryId,
                isSplitting, splitRows,
            ])
            .onAppear {
                if accountId == nil {
                    let defaultAccount = accounts.first { $0.id == session.user?.defaultAccountId }
                    accountId = (defaultAccount ?? accounts.first)?.id
                }
                if categoryId == nil { categoryId = filteredCategories.first?.id }
                Task { await loadCard(for: accountId) }
            }
            .onChange(of: accountId) { _, newValue in
                // A pick from the old card is meaningless on a new one, so it is
                // cleared here as well as server-side.
                cardCategoryId = ""
                Task { await loadCard(for: newValue) }
            }
            .sheet(isPresented: $showingNewCategory) {
                CategoryEditView(category: nil, householdId: householdId, lockedType: type) { created in
                    categories.append(created)
                    categoryId = created.id
                }
            }
        }
    }

    /// What a new transaction should send: nil when there's no split at all.
    private var splitsForCreate: [TransactionSplitInput]? {
        TransactionSplits.forCreate(isSplitting: isSplitting, amount: amount, rows: splitRows)
    }

    /// What this edit should do to the split already recorded.
    ///
    /// Not shared with `TransactionSplits`, because only this form knows what the
    /// row *opened* with. Switching the toggle off means *remove* it, which is a
    /// different request from leaving it alone — so a form that opened with no
    /// split and still has none sends nothing (an omitted key, `nil`) rather than
    /// an explicit `[]`.
    private var splitsForUpdate: [TransactionSplitInput]? {
        if let inputs = splitsForCreate { return inputs }
        let hadSplit = !(existing?.splits.isEmpty ?? true)
        return hadSplit ? [] : nil
    }

    /// The card behind an account, with this cycle's headroom — or nothing, which
    /// is the common answer rather than an error. Fetched on demand because most
    /// accounts are not cards and most households have none.
    private func loadCard(for accountId: String?) async {
        guard let householdId = session.activeHousehold?.id, let accountId else {
            card = nil
            cardHeadroom = [:]
            return
        }
        guard let loaded = await Cards.load(householdId: householdId, accountId: accountId) else {
            card = nil
            cardHeadroom = [:]
            return
        }
        card = loaded.card
        cardHeadroom = loaded.headroom
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
                        splits: splitsForUpdate,
                        mcc: mcc,
                        // Empty means "the card's default", which the API reads
                        // from an explicit null rather than an empty string.
                        cardCategoryId: cardCategoryId.isEmpty ? nil : cardCategoryId
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
                        splits: splitsForCreate,
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
        CalculatorInput.evaluateArithmeticExpression(amountText)
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
                        ForEach(selectableAccounts(accounts)) { account in
                            Text(account.name).tag(String?.some(account.id))
                        }
                    }
                    Picker("To", selection: $toAccountId) {
                        Text("Select").tag(String?.none)
                        ForEach(selectableAccounts(accounts)) { account in
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
                        CalculatorField(placeholder: "0.00", text: $amountText)
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
