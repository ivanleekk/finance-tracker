import SwiftUI

/// Budgets + the emergency-fund runway. Native counterpart of the web /budgets page.
///
/// Reached from the More tab. Two questions on one screen because they answer
/// the same worry from opposite ends: "am I overspending this month" and "how
/// long would I last if the income stopped".
struct BudgetsView: View {
    @Environment(SessionStore.self) private var session
    @Environment(QuickAddStore.self) private var quickAdd

    @State private var status: BudgetStatusResponse?
    @State private var fund: EmergencyFundResponse?
    @State private var categories: [CategoryResponse] = []
    @State private var isLoading = true
    @State private var showingAddBudget = false
    @State private var editingBudget: BudgetStatusRow?
    @State private var errorMessage: String?
    // Confirmation state lives on the screen, not the row: a dialog presented from
    // inside a swipe-actions row is torn down with the row's own collapse animation
    // before it ever appears (same reason RecurringView keeps it here).
    @State private var pendingDelete: BudgetStatusRow?

    private var currency: String {
        status?.baseCurrency ?? session.activeHousehold?.baseCurrency ?? "USD"
    }

    private var rows: [BudgetStatusRow] { status?.budgets ?? [] }

    /// Only expense categories can be budgeted, and one that already belongs to
    /// a budget shouldn't be offered again.
    private var budgetableCategories: [CategoryResponse] {
        let taken = Set(rows.flatMap(\.categoryIds))
        return categories.filter { $0.type == .expense && !taken.contains($0.id) }
    }

    var body: some View {
        List {
            if let fund {
                EmergencyFundSection(fund: fund, currency: currency) { months in
                    await updateTarget(months)
                }
            }

            if !rows.isEmpty {
                Section {
                    LabeledContent("Budgeted") {
                        Text((status?.totalLimit ?? 0).currencyWhole(currency)).monospacedDigit()
                    }
                    LabeledContent("Spent") {
                        Text((status?.totalSpent ?? 0).currencyWhole(currency)).monospacedDigit()
                    }
                    LabeledContent("Off pace") {
                        Text("\(rows.filter { BudgetPresentation.tone(for: $0) != .ok }.count) of \(rows.count)")
                            .monospacedDigit()
                    }
                }
            }

            Section("Budgets") {
                ForEach(rows) { row in
                    // A Button, not `.onTapGesture` — a bare tap gesture gives the row
                    // no press highlight and no button trait for VoiceOver, so the row
                    // looks inert right up until the sheet appears.
                    Button { editingBudget = row } label: {
                        BudgetRowView(row: row, currency: currency)
                    }
                    .buttonStyle(.plain)
                    // `allowsFullSwipe: false`: deleting a budget is a server-side
                    // delete with no undo, so the swipe reveals the button and the
                    // confirmation is the only path through.
                    .swipeActions(allowsFullSwipe: false) {
                        Button(role: .destructive) {
                            pendingDelete = row
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                    // Same actions on a long press: a swipe is invisible until you try
                    // it, and unreachable from Voice Control / Switch Control.
                    .contextMenu {
                        Button { editingBudget = row } label: {
                            Label("Edit", systemImage: "pencil")
                        }
                        Button(role: .destructive) { pendingDelete = row } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                }
                if rows.isEmpty && !isLoading {
                    Text("No budgets yet. Tap + to cap a category.")
                        .foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle("Budgets")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showingAddBudget = true
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("New Budget")
                .disabled(budgetableCategories.isEmpty)
            }
        }
        .sheet(isPresented: $showingAddBudget) {
            BudgetFormView(existing: nil, categories: budgetableCategories) { await load() }
        }
        .sheet(item: $editingBudget) { row in
            BudgetFormView(existing: row, categories: categories) { await load() }
        }
        .overlay {
            if isLoading && status == nil { LoadingSkeleton() }
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
        .confirmationDialog(
            "Delete this budget?",
            isPresented: .init(
                get: { pendingDelete != nil },
                set: { if !$0 { pendingDelete = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let row = pendingDelete {
                    Task { await delete(row) }
                }
            }
        } message: {
            Text("The transactions in it stay — only the cap is removed.")
        }
    }

    private func load() async {
        guard let household = session.activeHousehold else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            async let statusReq: BudgetStatusResponse =
                APIClient.shared.get("/cashflow/budgets/household/\(household.id)/status")
            async let fundReq: EmergencyFundResponse =
                APIClient.shared.get("/cashflow/household/\(household.id)/emergency-fund")
            async let categoriesReq: [CategoryResponse] =
                APIClient.shared.get("/cashflow/categories/household/\(household.id)")
            (status, fund, categories) = try await (statusReq, fundReq, categoriesReq)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func delete(_ row: BudgetStatusRow) async {
        do {
            try await APIClient.shared.delete("/cashflow/budgets/\(row.budgetId)")
            await load()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func updateTarget(_ months: Double) async {
        guard let household = session.activeHousehold else { return }
        do {
            // Go through the store so its cached household stays in sync.
            try await session.updateHousehold(id: household.id, emergencyFundTargetMonths: months)
            await load()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// The runway readout plus the editable target.
struct EmergencyFundSection: View {
    let fund: EmergencyFundResponse
    let currency: String
    let onTargetChanged: (Double) async -> Void

    @State private var targetText = ""
    @State private var isSaving = false
    @State private var isEditingTarget = false

    private var tint: Color {
        switch BudgetPresentation.runwayTone(fund) {
        case .critical: return .red
        case .low: return .orange
        case .ok: return .green
        case .unknown: return .secondary
        }
    }

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .firstTextBaseline) {
                    Text(BudgetPresentation.runwayLabel(fund))
                        .font(.title2.bold())
                        .foregroundStyle(tint)
                    Spacer()
                    Text(fund.liquidTotal.currencyWhole(currency))
                        .font(.body.monospacedDigit())
                }

                if fund.monthsCovered != nil {
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(.quaternary)
                            Capsule()
                                .fill(fund.onTrack ? Color.green : Color.orange)
                                .frame(width: geo.size.width * BudgetPresentation.runwayFraction(fund))
                        }
                    }
                    .frame(height: 6)

                    Text("\(fund.averageMonthlyExpenses.currencyWhole(currency))/month spending · \(Int(fund.targetMonths))-month target")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    if fund.shortfall > 0 {
                        Text("\(fund.shortfall.currencyWhole(currency)) short of target")
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }
                } else {
                    // No burn rate to measure against. Never imply an infinite runway.
                    Text("No expenses recorded in the last 6 months, so there's no burn rate to measure against yet.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.vertical, 4)

            Button {
                targetText = String(Int(fund.targetMonths))
                isEditingTarget = true
            } label: {
                HStack {
                    Text("Target months")
                        .foregroundStyle(.primary)
                    Spacer()
                    if isSaving {
                        ProgressView()
                    } else {
                        Text("\(Int(fund.targetMonths)) months")
                            .foregroundStyle(.secondary)
                        Image(systemName: "pencil")
                            .font(.caption)
                    }
                }
            }
            .disabled(isSaving)
        } header: {
            Text("Emergency fund")
        } footer: {
            Text("How long your liquid cash covers recent spending. Only cash accounts count. Share purchases, transfers and balance corrections are left out of the burn rate — you'd stop investing, not starve.")
        }
        .alert("Target Months", isPresented: $isEditingTarget) {
            TextField("Months", text: $targetText)
                .keyboardType(.numberPad)
            Button("Cancel", role: .cancel) {}
            Button("Save") {
                guard let months = Double(targetText.trimmingCharacters(in: .whitespaces)) else { return }
                isSaving = true
                Task {
                    await onTargetChanged(months)
                    isSaving = false
                }
            }
        } message: {
            Text("Months of expenses you want held in liquid cash.")
        }
    }
}

/// One budget: spend against limit, with a pace marker showing where the
/// calendar says you should be.
struct BudgetRowView: View {
    let row: BudgetStatusRow
    let currency: String

    private var tone: BudgetTone { BudgetPresentation.tone(for: row) }

    private var tint: Color {
        switch tone {
        case .over: return .red
        case .atRisk: return .orange
        case .ok: return .green
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(row.categoryNames.joined(separator: ", "))
                if row.isPrivate {
                    Image(systemName: "lock.fill")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text("\(row.spent.currencyWhole(currency)) / \(row.limit.currencyWhole(currency))")
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(tint)
            }

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(.quaternary)
                    Capsule()
                        .fill(tint)
                        .frame(width: geo.size.width * BudgetPresentation.barFraction(for: row))
                    // Where the calendar says you should be by today.
                    Rectangle()
                        .fill(.primary.opacity(0.45))
                        .frame(width: 1.5)
                        .offset(x: geo.size.width * BudgetPresentation.elapsedFraction(for: row))
                }
            }
            .frame(height: 6)

            Text(detailLine)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }

    private var detailLine: String {
        switch tone {
        case .over:
            return "\(tone.label) by \(abs(row.remaining).currencyWhole(currency))"
        default:
            return "\(tone.label) · \(row.remaining.currencyWhole(currency)) left · projected \(row.projectedSpend.currencyWhole(currency))"
        }
    }
}

/// Create or edit a budget. `existing == nil` creates.
struct BudgetFormView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(SessionStore.self) private var session

    let existing: BudgetStatusRow?
    let categories: [CategoryResponse]
    let onSaved: () async -> Void

    @State private var categoryIds: Set<String>
    @State private var amountText: String
    @State private var period: BudgetPeriod
    @State private var isSaving = false
    @State private var errorMessage: String?

    init(existing: BudgetStatusRow?, categories: [CategoryResponse], onSaved: @escaping () async -> Void) {
        self.existing = existing
        self.categories = categories
        self.onSaved = onSaved
        _categoryIds = State(initialValue: existing.map { Set($0.categoryIds) } ?? [])
        _amountText = State(initialValue: existing.map { String($0.limit) } ?? "")
        _period = State(initialValue: existing?.period ?? .monthly)
    }

    private var amount: Double? {
        let cleaned = amountText.replacingOccurrences(of: ",", with: "").trimmingCharacters(in: .whitespaces)
        guard let value = Double(cleaned), value > 0 else { return nil }
        return value
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if existing == nil {
                        ForEach(categories) { category in
                            Button {
                                if categoryIds.contains(category.id) {
                                    categoryIds.remove(category.id)
                                } else {
                                    categoryIds.insert(category.id)
                                }
                            } label: {
                                HStack {
                                    Text(category.name).foregroundStyle(.primary)
                                    Spacer()
                                    if categoryIds.contains(category.id) {
                                        Image(systemName: "checkmark").foregroundStyle(.tint)
                                    }
                                }
                            }
                        }
                    } else {
                        LabeledContent("Categories", value: existing?.categoryNames.joined(separator: ", ") ?? "")
                    }
                    TextField("Limit", text: $amountText)
                        .keyboardType(.decimalPad)
                    Picker("Period", selection: $period) {
                        ForEach(BudgetPeriod.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                } footer: {
                    Text("Only expense categories can be budgeted, and one or more can share a limit.")
                }

                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle(existing == nil ? "New Budget" : "Edit Budget")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .disabled(amount == nil || categoryIds.isEmpty || isSaving)
                }
            }
        }
    }

    private func save() {
        guard let amount, let household = session.activeHousehold else { return }
        isSaving = true
        errorMessage = nil
        Task {
            defer { isSaving = false }
            do {
                if let existing {
                    let _: BudgetResponse = try await APIClient.shared.put(
                        "/cashflow/budgets/\(existing.budgetId)",
                        body: BudgetUpdate(amount: amount, period: period)
                    )
                } else {
                    let _: BudgetResponse = try await APIClient.shared.post(
                        "/cashflow/budgets",
                        body: BudgetCreate(
                            householdId: household.id,
                            categoryIds: Array(categoryIds),
                            amount: amount,
                            period: period,
                            ownerUserId: nil
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
