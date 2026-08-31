import SwiftUI

/// Setting a card up, and managing its limits and categories.
///
/// Split from `CardsView` because these are three separate forms with their own
/// state, and inlining them into the list view is how a screen file grows past
/// the point anyone wants to open it.

struct CardSetUpView: View {
    let accounts: [AccountResponse]
    let onSaved: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var accountId: String?
    @State private var cycleBasis: CycleBasis = .statement
    @State private var statementDay = 1
    @State private var isSaving = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Account", selection: $accountId) {
                        Text("Select").tag(String?.none)
                        ForEach(selectableAccounts(accounts)) { account in
                            Text(account.name).tag(String?.some(account.id))
                        }
                    }
                } footer: {
                    Text("Pick the liability account this card already uses.")
                }

                Section {
                    Picker("Limits reset on", selection: $cycleBasis) {
                        Text("The statement cycle").tag(CycleBasis.statement)
                        Text("The calendar month").tag(CycleBasis.calendar)
                    }
                    if cycleBasis == .statement {
                        Stepper("Closes on day \(statementDay)", value: $statementDay, in: 1...31)
                    }
                } footer: {
                    Text(
                        cycleBasis == .statement
                            ? "Clamped in shorter months, so 31 still closes in February."
                            : "Some issuers reset bonus caps on the calendar month whatever day the statement closes. It isn't derivable from the statement date, so it has to be stated."
                    )
                }

                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Set up a card")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .disabled(accountId == nil || isSaving)
                }
            }
            .discardGuard(fields: [accountId, cycleBasis, statementDay])
        }
    }

    private func save() {
        guard let accountId else { return }
        isSaving = true
        errorMessage = nil
        Task {
            defer { isSaving = false }
            do {
                let _: CardResponse = try await APIClient.shared.post(
                    "/cards",
                    body: CardCreate(
                        financialAccountId: accountId,
                        cycleBasis: cycleBasis.rawValue,
                        statementDay: statementDay
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

struct CardManageView: View {
    let card: CardResponse
    let onChanged: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var limits: [CardLimitResponse]
    @State private var categories: [CardCategoryResponse]
    @State private var errorMessage: String?

    @State private var limitName = ""
    @State private var limitAmount = ""
    @State private var limitDirection: LimitDirection = .ceiling
    @State private var limitReset: LimitResetBasis = .cycle
    @State private var categoryName = ""
    @State private var categoryLimitId: String?

    init(card: CardResponse, onChanged: @escaping () async -> Void) {
        self.card = card
        self.onChanged = onChanged
        _limits = State(initialValue: card.limits)
        _categories = State(initialValue: card.categories)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Limits") {
                    ForEach(limits) { limit in
                        LabeledContent(limit.name) {
                            Text("\(limit.direction == .floor ? "min" : "cap") \(limit.amount.currencyWhole(card.currency ?? "USD"))")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .onDelete { offsets in
                        Task { await deleteLimits(at: offsets) }
                    }
                    if limits.isEmpty {
                        Text("None yet.").foregroundStyle(.secondary)
                    }
                }

                Section {
                    TextField("e.g. Dining cap", text: $limitName)
                    CalculatorField(placeholder: "Amount", text: $limitAmount)
                    Picker("Direction", selection: $limitDirection) {
                        Text("Cap — stay under").tag(LimitDirection.ceiling)
                        Text("Minimum — reach it").tag(LimitDirection.floor)
                    }
                    Picker("Resets", selection: $limitReset) {
                        Text("Each statement cycle").tag(LimitResetBasis.cycle)
                        Text("Each calendar month").tag(LimitResetBasis.calendarMonth)
                        Text("Each quarter").tag(LimitResetBasis.quarter)
                        Text("Each year").tag(LimitResetBasis.year)
                    }
                    Button("Add limit") { Task { await addLimit() } }
                        .disabled(limitName.isEmpty || CalculatorInput.evaluateArithmeticExpression(limitAmount) == nil)
                } header: {
                    Text("Add a limit")
                } footer: {
                    Text(
                        limitDirection == .floor
                            ? "The spend you need to reach — a fee waiver or a bonus qualifier."
                            : "Enter caps as a spend figure. A cap the issuer states in rewards (\"max $60 cashback\") has to be converted — at 10%, that is $600 of spend."
                    )
                }

                Section {
                    ForEach(categories) { category in
                        LabeledContent(category.name) {
                            Text(categoryDetail(category))
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        .swipeActions(edge: .leading, allowsFullSwipe: false) {
                            if !category.isDefault {
                                Button {
                                    Task { await makeDefault(category) }
                                } label: {
                                    Label("Default", systemImage: "star")
                                }
                                .tint(.orange)
                            }
                        }
                        .contextMenu {
                            if !category.isDefault {
                                Button {
                                    Task { await makeDefault(category) }
                                } label: {
                                    Label("Make default", systemImage: "star")
                                }
                            }
                        }
                    }
                    .onDelete { offsets in
                        Task { await deleteCategories(at: offsets) }
                    }
                } header: {
                    Text("Categories")
                } footer: {
                    Text("This card's own slicing of spend — free to cut across your budget categories. Untagged spending lands in the default.")
                }

                Section("Add a category") {
                    TextField("e.g. Online", text: $categoryName)
                    Picker("Limit", selection: $categoryLimitId) {
                        Text("No limit — just track it").tag(String?.none)
                        ForEach(limits) { limit in
                            Text(limit.name).tag(String?.some(limit.id))
                        }
                    }
                    Button("Add category") { Task { await addCategory() } }
                        .disabled(categoryName.isEmpty)
                }

                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle(card.accountName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            // Limits and categories are already saved the moment "Add limit"/"Add category"
            // is tapped — what this guards is the half-typed draft in either inline form,
            // which swiping away used to lose silently.
            .discardGuard(fields: [limitName, limitAmount, limitDirection, limitReset, categoryName, categoryLimitId])
        }
    }

    private func categoryDetail(_ category: CardCategoryResponse) -> String {
        var parts: [String] = []
        if category.isDefault { parts.append("default") }
        if category.limitId == nil { parts.append("unmetered") }
        return parts.joined(separator: " · ")
    }

    private func addLimit() async {
        guard let amount = CalculatorInput.evaluateArithmeticExpression(limitAmount) else { return }
        do {
            let created: CardLimitResponse = try await APIClient.shared.post(
                "/cards/\(card.id)/limits",
                body: CardLimitCreate(
                    name: limitName,
                    amount: amount,
                    direction: limitDirection.rawValue,
                    resetBasis: limitReset.rawValue
                )
            )
            limits.append(created)
            limitName = ""
            limitAmount = ""
            limitDirection = .ceiling
            limitReset = .cycle
            errorMessage = nil
            await onChanged()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func addCategory() async {
        do {
            let created: CardCategoryResponse = try await APIClient.shared.post(
                "/cards/\(card.id)/categories",
                body: CardCategoryCreate(name: categoryName, limitId: categoryLimitId)
            )
            categories.append(created)
            categoryName = ""
            categoryLimitId = nil
            errorMessage = nil
            await onChanged()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func deleteLimits(at offsets: IndexSet) async {
        for index in offsets {
            let limit = limits[index]
            do {
                try await APIClient.shared.delete("/cards/limits/\(limit.id)")
                limits.removeAll { $0.id == limit.id }
                // Its categories are not deleted — they become unmetered.
                categories = categories.map { category in
                    guard category.limitId == limit.id else { return category }
                    return CardCategoryResponse(
                        id: category.id,
                        cardId: category.cardId,
                        name: category.name,
                        isDefault: category.isDefault,
                        sortOrder: category.sortOrder,
                        limitId: nil
                    )
                }
                await onChanged()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func makeDefault(_ category: CardCategoryResponse) async {
        do {
            let updated: CardCategoryResponse = try await APIClient.shared.put(
                "/cards/categories/\(category.id)",
                body: CardCategoryDefaultUpdate()
            )
            categories = categories.map { $0.id == updated.id ? updated : CardCategoryResponse(
                id: $0.id,
                cardId: $0.cardId,
                name: $0.name,
                isDefault: false,
                sortOrder: $0.sortOrder,
                limitId: $0.limitId
            ) }
            errorMessage = nil
            await onChanged()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func deleteCategories(at offsets: IndexSet) async {
        for index in offsets {
            let category = categories[index]
            do {
                try await APIClient.shared.delete("/cards/categories/\(category.id)")
                categories.removeAll { $0.id == category.id }
                await onChanged()
            } catch {
                // A category still tagged on transactions comes back as a 409
                // with an explanation rather than a crash — show it.
                errorMessage = error.localizedDescription
            }
        }
    }
}
