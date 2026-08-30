import SwiftUI

/// Manage the household's income/expense categories: create, rename, retype, delete.
/// Reached from the More tab; also surfaced inline from the New Transaction sheet.
struct CategoriesView: View {
    @Environment(SessionStore.self) private var session
    @Environment(QuickAddStore.self) private var quickAdd

    @State private var categories: [CategoryResponse] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var showingAdd = false
    @State private var editing: CategoryResponse?

    private func categories(ofType type: TransactionType) -> [CategoryResponse] {
        categories.filter { $0.type == type }.sorted { $0.name < $1.name }
    }

    var body: some View {
        List {
            ForEach([TransactionType.expense, .income]) { type in
                Section(type == .expense ? "Expense" : "Income") {
                    let items = categories(ofType: type)
                    if items.isEmpty && !isLoading {
                        Text("No categories yet")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(items) { category in
                        if category.isSystem {
                            // The app manages these itself (Transfer, Balance
                            // Adjustment, ...) — they're matched by exact name
                            // everywhere the backend files spend under them, so
                            // renaming or deleting one here would just split its
                            // history from a freshly created category with the
                            // canonical name. Shown, but not tappable.
                            HStack {
                                Text(category.name)
                                    .foregroundStyle(.secondary)
                                Spacer()
                                Text("System")
                                    .font(.caption)
                                    .foregroundStyle(.tertiary)
                            }
                        } else {
                            Button {
                                editing = category
                            } label: {
                                HStack {
                                    Text(category.name)
                                        .foregroundStyle(.primary)
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(.tertiary)
                                }
                            }
                            // Reveal-then-tap rather than `.onDelete`'s full swipe. A
                            // category still used by a transaction is refused server-side,
                            // so the cost of a slip is low — but low enough to be worth one
                            // deliberate tap, not low enough to commit on a flick.
                            .swipeActions(allowsFullSwipe: false) {
                                Button(role: .destructive) {
                                    if let index = items.firstIndex(where: { $0.id == category.id }) {
                                        delete(items, at: IndexSet(integer: index))
                                    }
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            }
                            // Same actions on a long press: a swipe is invisible until you
                            // try it, and unreachable from Voice Control / Switch Control.
                            .contextMenu {
                                Button { editing = category } label: {
                                    Label("Edit", systemImage: "pencil")
                                }
                                Button(role: .destructive) {
                                    if let index = items.firstIndex(where: { $0.id == category.id }) {
                                        delete(items, at: IndexSet(integer: index))
                                    }
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Categories")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showingAdd = true
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("New Category")
            }
        }
        .overlay {
            if isLoading && categories.isEmpty {
                ProgressView()
            } else if !isLoading && categories.isEmpty {
                ContentUnavailableView(
                    "No Categories",
                    systemImage: "tag",
                    description: Text("Tap + to create your first category.")
                )
            }
        }
        .sheet(isPresented: $showingAdd) {
            if let household = session.activeHousehold {
                CategoryEditView(category: nil, householdId: household.id) { _ in
                    await load()
                }
            }
        }
        .sheet(item: $editing) { category in
            if let household = session.activeHousehold {
                CategoryEditView(category: category, householdId: household.id) { _ in
                    await load()
                }
            }
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
    }

    private func delete(_ group: [CategoryResponse], at offsets: IndexSet) {
        let toDelete = offsets.map { group[$0] }
        Task {
            do {
                for category in toDelete {
                    try await APIClient.shared.delete("/cashflow/categories/\(category.id)")
                }
                await load()
            } catch {
                // A category still used by a transaction can't be deleted (FK constraint).
                errorMessage = "Couldn’t delete a category that’s still used by a transaction. Reassign those transactions first."
                await load()
            }
        }
    }

    private func load() async {
        guard let household = session.activeHousehold else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            categories = try await APIClient.shared.get("/cashflow/categories/household/\(household.id)")
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// Shared create/edit form for a single category. `category == nil` creates a new one.
/// Pass `lockedType` to force the type (used by the New Transaction sheet, where a
/// new category must match the transaction's income/expense flow) and hide the picker.
struct CategoryEditView: View {
    @Environment(\.dismiss) private var dismiss

    let category: CategoryResponse?
    let householdId: String
    let lockedType: TransactionType?
    /// Receives the created/updated category so callers can select it inline.
    let onSaved: (CategoryResponse) async -> Void

    @State private var name: String
    @State private var type: TransactionType
    @State private var isSaving = false
    @State private var errorMessage: String?

    init(
        category: CategoryResponse?,
        householdId: String,
        lockedType: TransactionType? = nil,
        onSaved: @escaping (CategoryResponse) async -> Void
    ) {
        self.category = category
        self.householdId = householdId
        self.lockedType = lockedType
        self.onSaved = onSaved
        _name = State(initialValue: category?.name ?? "")
        _type = State(initialValue: category?.type ?? lockedType ?? .expense)
    }

    private var trimmedName: String {
        name.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var canSave: Bool { !trimmedName.isEmpty && !isSaving }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $name)
                        .autocorrectionDisabled()
                    if lockedType == nil {
                        Picker("Type", selection: $type) {
                            Text("Expense").tag(TransactionType.expense)
                            Text("Income").tag(TransactionType.income)
                        }
                        .pickerStyle(.segmented)
                    }
                }

                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle(category == nil ? "New Category" : "Edit Category")
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
        }
    }

    private func save() {
        guard canSave else { return }
        isSaving = true
        errorMessage = nil
        Task {
            defer { isSaving = false }
            do {
                let result: CategoryResponse
                if let category {
                    result = try await APIClient.shared.put(
                        "/cashflow/categories/\(category.id)",
                        body: CategoryUpdate(name: trimmedName, type: type)
                    )
                } else {
                    result = try await APIClient.shared.post(
                        "/cashflow/categories",
                        body: CategoryCreate(householdId: householdId, name: trimmedName, type: type)
                    )
                }
                await onSaved(result)
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}
