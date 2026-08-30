import SwiftUI

// The New/Edit Transaction sheet and the Internal Transfer sheet, lifted out of
// TransactionsView.swift. They are self-contained sheets rather than part of the
// list, and the file that owns the list is easier to read without ~400 lines of
// form in the middle of it.

/// One row of the split editor: a picked person and their (still-typed) share.
/// A stable `id`, minted once when the row is created, is what lets `ForEach`
/// track a row across edits without depending on the (possibly still-blank)
/// counterparty pick.
private struct SplitRow: Identifiable, Hashable {
    let id = UUID()
    var counterpartyId: String?
    var amountText: String = ""
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
    /// Part of this bill is one or more other people's. The amount above stays
    /// the full sum that leaves the account — this only records whose it was.
    @State private var isSplitting: Bool
    @State private var splitRows: [SplitRow]
    @State private var counterparties: [Counterparty]
    /// Inline "+ New Person" affordance, same shape as "+ New Category" below:
    /// adding a person appends them as a new split row rather than filling one
    /// in, since there's no single row to target until at least one exists.
    @State private var isCreatingCounterparty = false
    @State private var newCounterpartyName = ""
    @State private var isSavingCounterparty = false
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
        Double(amountText.replacingOccurrences(of: ",", with: ""))
    }

    /// Rows with a person picked, read as split entries. A row with no person
    /// selected yet is left out rather than counted as incomplete — matching
    /// the web's `splitHint`, which filters to `r => r.counterpartyId` first.
    private var splitEntries: [SplitEntry] {
        splitRows.compactMap { row in
            guard let counterpartyId = row.counterpartyId else { return nil }
            return SplitEntry(counterpartyId: counterpartyId, amount: Reimbursements.parseMoney(row.amountText))
        }
    }

    private var splitAssessment: SplitAssessment {
        Reimbursements.assessSplit(amount: amount, entries: splitEntries)
    }

    /// The sentence under the split fields. It restates the split as the two
    /// numbers the user actually cares about, because "they owe 180 combined"
    /// on a 300 bill is only meaningful once you can see that leaves you 120.
    private var splitHint: String {
        switch splitAssessment {
        case .incomplete:
            return "The full amount still leaves your account — only your share counts towards budgets."
        case let .invalid(reason):
            return reason
        case let .valid(yourShare, owed):
            let currency = session.activeHousehold?.baseCurrency ?? "USD"
            let who = splitEntries.count > 1 ? "They owe you (combined)" : "They owe you"
            return "Your share: \(yourShare.currency(currency)). \(who) \(owed.currency(currency))."
        }
    }

    /// A split that is switched on but not yet complete blocks saving, rather
    /// than being silently dropped — the user asked for it and would not notice
    /// it going missing.
    private var splitIsUsable: Bool {
        guard isSplitting else { return true }
        guard case .valid = splitAssessment else { return false }
        return true
    }

    private var canSave: Bool {
        amount ?? 0 > 0 && accountId != nil && categoryId != nil && !isSaving && splitIsUsable
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

                // Splitting a bill. The amount above is untouched: the whole sum
                // really did leave the account. This only records how much of it
                // was somebody else's, so the budget charges you for your share
                // and the rest becomes a debt they owe you.
                if type == .expense {
                    Section {
                        Toggle("Someone owes me for part of this", isOn: $isSplitting.animation())
                        if isSplitting {
                            ForEach($splitRows) { $row in
                                HStack(spacing: 8) {
                                    Picker("Who", selection: $row.counterpartyId) {
                                        Text("Select person").tag(String?.none)
                                        ForEach(pickableCounterparties(for: row.id)) { cp in
                                            Text(cp.name).tag(String?.some(cp.id))
                                        }
                                    }
                                    .labelsHidden()
                                    TextField("0.00", text: $row.amountText)
                                        .keyboardType(.decimalPad)
                                        .multilineTextAlignment(.trailing)
                                        .frame(width: 70)
                                    Button {
                                        splitRows.removeAll { $0.id == row.id }
                                    } label: {
                                        Image(systemName: "minus.circle.fill")
                                            .foregroundStyle(.red)
                                    }
                                    .buttonStyle(.borderless)
                                }
                            }

                            Button {
                                splitRows.append(SplitRow())
                            } label: {
                                Label("Add Person", systemImage: "person.badge.plus")
                            }

                            Button {
                                isCreatingCounterparty.toggle()
                            } label: {
                                Label(
                                    isCreatingCounterparty ? "Cancel New Person" : "New Person",
                                    systemImage: "plus.circle"
                                )
                            }

                            if isCreatingCounterparty {
                                HStack {
                                    TextField("e.g. Alice", text: $newCounterpartyName)
                                        .textInputAutocapitalization(.words)
                                    Button {
                                        Task { await createCounterparty() }
                                    } label: {
                                        if isSavingCounterparty {
                                            ProgressView()
                                        } else {
                                            Text("Add")
                                        }
                                    }
                                    .disabled(
                                        newCounterpartyName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                            || isSavingCounterparty
                                    )
                                }
                            }

                            if splitRows.count > 1 {
                                Button("Split Remainder Evenly") {
                                    splitRemainderEvenly()
                                }
                            }
                        }
                    } footer: {
                        if isSplitting {
                            Text(splitHint)
                                .foregroundStyle(splitAssessment.isInvalid ? .red : .secondary)
                        }
                    }
                }

                // Only when the selected account is actually a card. The headroom
                // sits in the row because this is the one moment the number can
                // still change the decision — a meter you have to go and look at
                // will not stop anyone overspending.
                if let card {
                    Section {
                        Picker("Card category", selection: $cardCategoryId) {
                            Text("Card's default").tag("")
                            ForEach(card.categories) { category in
                                Text(cardCategoryLabel(category)).tag(category.id)
                            }
                        }
                    } footer: {
                        Text("Which of this card's own categories the spend counts towards.")
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

    /// The completed split rows, ready for the wire — only valid once
    /// `splitAssessment` says so, which guarantees every entry has both a
    /// counterparty and a positive amount.
    private func splitInputs() -> [TransactionSplitInput] {
        splitRows.compactMap { row in
            guard let counterpartyId = row.counterpartyId,
                  let amount = Reimbursements.parseMoney(row.amountText)
            else { return nil }
            return TransactionSplitInput(counterpartyId: counterpartyId, amount: amount)
        }
    }

    /// What a new transaction should send: nil when there's no split at all.
    private var splitsForCreate: [TransactionSplitInput]? {
        guard isSplitting, case .valid = splitAssessment else { return nil }
        return splitInputs()
    }

    /// What this edit should do to the split already recorded.
    ///
    /// Switching the toggle off means *remove* it, which is a different request
    /// from leaving it alone — so a form that opened with no split and still has
    /// none sends nothing (an omitted key, `nil`) rather than an explicit `[]`.
    private var splitsForUpdate: [TransactionSplitInput]? {
        if isSplitting, case .valid = splitAssessment {
            return splitInputs()
        }
        let hadSplit = !(existing?.splits.isEmpty ?? true)
        return hadSplit ? [] : nil
    }

    /// Adds a new reusable person and appends them as a new, blank split row —
    /// there's no single row to fill in until at least one exists.
    private func createCounterparty() async {
        let name = newCounterpartyName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, let household = session.activeHousehold else { return }
        isSavingCounterparty = true
        defer { isSavingCounterparty = false }
        do {
            let created: Counterparty = try await APIClient.shared.post(
                "/cashflow/counterparties",
                body: CounterpartyCreate(householdId: household.id, name: name)
            )
            counterparties.append(created)
            counterparties.sort { $0.name < $1.name }
            splitRows.append(SplitRow(counterpartyId: created.id))
            newCounterpartyName = ""
            isCreatingCounterparty = false
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Fills every blank-amount row by dividing what's left of the bill evenly
    /// across them, after subtracting whatever the other rows already specify.
    private func splitRemainderEvenly() {
        let blankIndices = splitRows.indices.filter {
            splitRows[$0].amountText.trimmingCharacters(in: .whitespaces).isEmpty
        }
        guard !blankIndices.isEmpty else { return }
        let specified = splitRows
            .filter { !$0.amountText.trimmingCharacters(in: .whitespaces).isEmpty }
            .compactMap { Reimbursements.parseMoney($0.amountText) }
        guard let share = Reimbursements.evenSplitRemainder(
            amount: amount ?? 0, specified: specified, remainingCount: blankIndices.count
        ) else { return }
        for index in blankIndices {
            splitRows[index].amountText = String(format: "%.2f", share)
        }
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

    /// "Dining · $240 left" when the category is metered, otherwise just its name.
    private func cardCategoryLabel(_ category: CardCategoryResponse) -> String {
        guard let row = cardHeadroom[category.id] else { return category.name }
        let currency = card?.currency ?? session.activeHousehold?.baseCurrency ?? "USD"
        let headroom = Cards.headroomLabel(for: row) { $0.currencyWhole(currency) }
        return "\(category.name) · \(headroom)"
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
