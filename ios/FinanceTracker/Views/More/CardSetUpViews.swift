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
    @State private var hasAnniversary = false
    @State private var anniversary = Date()
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

                Section {
                    Toggle("Card anniversary", isOn: $hasAnniversary)
                    if hasAnniversary {
                        DatePicker("Opened on", selection: $anniversary, displayedComponents: .date)
                            // The backend date means a calendar day, read back at UTC
                            // midnight; pick in UTC so it round-trips to the same day.
                            .environment(\.timeZone, .gmt)
                    }
                } footer: {
                    Text("Optional. Limits that reset each card year or card quarter count from it.")
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
            .discardGuard(fields: [accountId, cycleBasis, statementDay, hasAnniversary, anniversary])
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
                        statementDay: statementDay,
                        anniversaryDate: hasAnniversary ? anniversary.apiDateOnly : nil
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
    @State private var currentCard: CardResponse
    @State private var limits: [CardLimitResponse]
    @State private var categories: [CardCategoryResponse]
    @State private var errorMessage: String?

    @State private var limitName = ""
    @State private var limitAmount = ""
    @State private var limitDirection: LimitDirection = .ceiling
    @State private var limitReset: LimitResetBasis = .cycle
    @State private var limitCategoryIds: Set<String> = []
    @State private var categoryName = ""
    @State private var anniversaryDate: Date?
    @State private var editing = false

    init(card: CardResponse, onChanged: @escaping () async -> Void) {
        self.card = card
        self.onChanged = onChanged
        _currentCard = State(initialValue: card)
        _limits = State(initialValue: card.limits)
        _categories = State(initialValue: card.categories)
        _anniversaryDate = State(initialValue: card.anniversaryDate)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ForEach(limits) { limit in
                        NavigationLink {
                            LimitCategoriesEditView(limit: limit, categories: categories) { updated in
                                limits = limits.map { $0.id == updated.id ? updated : $0 }
                                await onChanged()
                            }
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                LabeledContent(limit.name) {
                                    Text("\(limit.direction == .floor ? "min" : "cap") \(limit.amount.currencyWhole(card.currency ?? "USD"))")
                                        .font(.footnote)
                                        .foregroundStyle(.secondary)
                                }
                                Text(categoryNames(limit.categoryIds) ?? "No categories — measuring nothing")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    .onDelete { offsets in
                        Task { await deleteLimits(at: offsets) }
                    }
                    if limits.isEmpty {
                        Text("None yet.").foregroundStyle(.secondary)
                    }
                } header: {
                    Text("Limits")
                } footer: {
                    if !limits.isEmpty {
                        Text("Tap a limit to choose which categories count towards it.")
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
                        ForEach(Cards.resetOptions(hasAnniversary: anniversaryDate != nil).filter(\.isAvailable), id: \.basis) { option in
                            Text(option.label).tag(option.basis)
                        }
                    }
                    NavigationLink {
                        LimitCategoryChecklist(categories: categories, selection: $limitCategoryIds)
                            .navigationTitle("Counts spending in")
                    } label: {
                        LabeledContent("Counts spending in") {
                            Text(categoryNames(orderedIds(limitCategoryIds)) ?? "None")
                                .lineLimit(1)
                        }
                    }
                    Button("Add limit") { Task { await addLimit() } }
                        .disabled(limitName.isEmpty || CalculatorInput.evaluateArithmeticExpression(limitAmount) == nil)
                } header: {
                    Text("Add a limit")
                } footer: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(
                            limitDirection == .floor
                                ? "The spend you need to reach — a fee waiver or a bonus qualifier."
                                : "Enter caps as a spend figure. A cap the issuer states in rewards (\"max $60 cashback\") has to be converted — at 10%, that is $600 of spend."
                        )
                        if anniversaryDate == nil {
                            Text(Cards.anniversaryHint)
                        }
                    }
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
                    Text("This card's own slicing of spend — free to cut across your budget categories. Untagged spending lands in the default. Which limits a category counts towards is chosen on the limit.")
                }

                Section("Add a category") {
                    TextField("e.g. Online", text: $categoryName)
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
                ToolbarItem(placement: .topBarLeading) {
                    Button("Edit card") { editing = true }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            // Limits and categories are already saved the moment "Add limit"/"Add category"
            // is tapped — what this guards is the half-typed draft in either inline form,
            // which swiping away used to lose silently.
            .discardGuard(fields: [limitName, limitAmount, limitDirection, limitReset, limitCategoryIds, categoryName])
            .sheet(isPresented: $editing) {
                CardEditView(card: currentCard) { updated in
                    currentCard = updated
                    anniversaryDate = updated.anniversaryDate
                    await onChanged()
                }
            }
            // Clearing the anniversary from Edit card can leave `limitReset` on
            // "Each card year"/"Each card quarter" after the Picker has already
            // stopped offering it. Clamp back to the default whenever the current
            // selection drops out of the available set, rather than hardcoding
            // which bases are anniversary-only.
            .onChange(of: anniversaryDate) {
                let available = Set(Cards.resetOptions(hasAnniversary: anniversaryDate != nil).filter(\.isAvailable).map(\.basis))
                if !available.contains(limitReset) {
                    limitReset = .cycle
                }
            }
        }
    }

    private func categoryDetail(_ category: CardCategoryResponse) -> String {
        var parts: [String] = []
        if category.isDefault { parts.append("default") }
        if !Cards.isMetered(categoryId: category.id, limits: limits) { parts.append("unmetered") }
        return parts.joined(separator: " · ")
    }

    /// Ids in the card's category order, so what is sent and shown doesn't
    /// depend on the order the checklist was tapped in.
    private func orderedIds(_ ids: Set<String>) -> [String] {
        categories.map(\.id).filter(ids.contains)
    }

    private func categoryNames(_ ids: [String]) -> String? {
        let names = categories.filter { ids.contains($0.id) }.map(\.name)
        return names.isEmpty ? nil : names.joined(separator: " · ")
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
                    resetBasis: limitReset.rawValue,
                    categoryIds: orderedIds(limitCategoryIds)
                )
            )
            limits.append(created)
            limitName = ""
            limitAmount = ""
            limitDirection = .ceiling
            limitReset = .cycle
            limitCategoryIds = []
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
                body: CardCategoryCreate(name: categoryName)
            )
            categories.append(created)
            categoryName = ""
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
                // Its categories are not deleted; any counting towards nothing
                // else simply read as unmetered, derived from `limits`.
                limits.removeAll { $0.id == limit.id }
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
                sortOrder: $0.sortOrder
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

/// A checklist of a card's categories, for choosing what counts towards a limit.
///
/// Rows are buttons with a checkmark rather than `Toggle`s: this is a pick from a
/// list, which is what the checkmark idiom says, and a category already counting
/// towards another limit is offered all the same — stacking a monthly minimum and
/// an annual cap on the same spend is the point.
struct LimitCategoryChecklist: View {
    let categories: [CardCategoryResponse]
    @Binding var selection: Set<String>

    var body: some View {
        List(categories) { category in
            Button {
                if selection.contains(category.id) {
                    selection.remove(category.id)
                } else {
                    selection.insert(category.id)
                }
            } label: {
                HStack {
                    Text(category.name)
                    Spacer()
                    if selection.contains(category.id) {
                        Image(systemName: "checkmark")
                            .foregroundStyle(.tint)
                            .accessibilityLabel("Selected")
                    }
                }
                .contentShape(Rectangle())
            }
            // Plain, or the list tints every name like a link.
            .buttonStyle(.plain)
            .accessibilityAddTraits(selection.contains(category.id) ? .isSelected : [])
        }
    }
}

/// Changes which categories count towards an existing limit.
struct LimitCategoriesEditView: View {
    let limit: CardLimitResponse
    let categories: [CardCategoryResponse]
    let onSaved: (CardLimitResponse) async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var selection: Set<String>
    @State private var saving = false
    @State private var errorMessage: String?

    init(
        limit: CardLimitResponse,
        categories: [CardCategoryResponse],
        onSaved: @escaping (CardLimitResponse) async -> Void
    ) {
        self.limit = limit
        self.categories = categories
        self.onSaved = onSaved
        _selection = State(initialValue: Set(limit.categoryIds))
    }

    var body: some View {
        LimitCategoryChecklist(categories: categories, selection: $selection)
            .safeAreaInset(edge: .bottom) {
                if let errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.red)
                        .padding()
                }
            }
            .navigationTitle(limit.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .disabled(saving || selection == Set(limit.categoryIds))
                }
            }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            let updated: CardLimitResponse = try await APIClient.shared.put(
                "/cards/limits/\(limit.id)",
                body: CardLimitCategoriesUpdate(categoryIds: categories.map(\.id).filter(selection.contains))
            )
            await onSaved(updated)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
