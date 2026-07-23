import SwiftUI
import Charts

/// The full accounts list. Reached by pushing from the Dashboard, so it relies on the
/// caller's NavigationStack rather than wrapping its own.
struct AccountsListView: View {
    @Environment(SessionStore.self) private var session
    @Environment(QuickAddStore.self) private var quickAdd
    @Environment(ViewModeStore.self) private var viewModeStore

    @State private var accounts: [AccountResponse] = []
    @State private var balances: [BalanceResponse] = []
    @State private var isLoading = true
    @State private var showingAddAccount = false
    @State private var errorMessage: String?

    /// Accounts visible under the current view mode (private/household/blended).
    private var visibleAccounts: [AccountResponse] {
        accounts.filter { viewModeStore.isVisible(ownerUserId: $0.ownerUserId, currentUserId: session.user?.id) }
    }

    private var grouped: [(liquidity: LiquidityStatus, accounts: [AccountResponse])] {
        LiquidityStatus.allCases.compactMap { liquidity in
            let matching = visibleAccounts.filter { $0.liquidity == liquidity }
            return matching.isEmpty ? nil : (liquidity, matching.sorted { $0.name < $1.name })
        }
    }

    var body: some View {
        List {
            QuickAddPullSensor()
            ForEach(grouped, id: \.liquidity) { group in
                Section(group.liquidity.label) {
                    ForEach(group.accounts) { account in
                        NavigationLink {
                            AccountDetailView(account: account, onChanged: load)
                        } label: {
                            AccountRow(account: account, latestBalance: latestBalance(for: account))
                        }
                    }
                }
            }
        }
        .navigationTitle("Accounts")
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { ViewModeSwitcher() }
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showingAddAccount = true
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("New Account")
            }
        }
        .sheet(isPresented: $showingAddAccount) {
            AccountFormView(existing: nil) { await load() }
        }
        .overlay {
            if isLoading && accounts.isEmpty {
                LoadingSkeleton()
            } else if !isLoading && visibleAccounts.isEmpty {
                ContentUnavailableView(
                    accounts.isEmpty ? "No Accounts" : "Nothing to Show",
                    systemImage: "building.columns",
                    description: Text(accounts.isEmpty
                        ? "Tap + to add your first account."
                        : "No accounts match the current view mode.")
                )
            }
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

    private func latestBalance(for account: AccountResponse) -> BalanceResponse? {
        balances.filter { $0.accountId == account.id }.max { $0.date < $1.date }
    }

    private func load() async {
        guard let household = session.activeHousehold else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            async let accountsReq: [AccountResponse] = APIClient.shared.get("/accounts/household/\(household.id)")
            async let balancesReq: [BalanceResponse] = APIClient.shared.get("/accounts/balances/household/\(household.id)")
            (accounts, balances) = try await (accountsReq, balancesReq)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct AccountDetailView: View {
    @Environment(SessionStore.self) private var session

    let account: AccountResponse
    /// Called after a change so the parent list (and net worth) reload.
    let onChanged: () async -> Void

    @State private var balances: [BalanceResponse] = []
    @State private var isLoading = true
    @State private var showingAddBalance = false
    @State private var showingEditAccount = false
    @State private var errorMessage: String?

    private var sorted: [BalanceResponse] {
        balances.sorted { $0.date < $1.date }
    }

    var body: some View {
        List {
            if sorted.count > 1 {
                Section {
                    Chart(sorted) { balance in
                        LineMark(
                            x: .value("Date", balance.date),
                            y: .value("Balance", balance.balance)
                        )
                        .foregroundStyle(session.theme.primary.accent)
                        .interpolationMethod(.monotone)
                    }
                    .frame(height: 160)
                    .padding(.vertical, 4)
                }
            }

            Section("History") {
                if sorted.isEmpty && !isLoading {
                    Text("No balances yet. Tap + to record one.")
                        .foregroundStyle(.secondary)
                }
                ForEach(sorted.reversed()) { balance in
                    HStack {
                        Text(balance.date.formatted(date: .abbreviated, time: .omitted))
                        if balance.isManual {
                            Image(systemName: "pencil")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(balance.balance.currency(account.currency))
                            .font(.body.monospacedDigit())
                    }
                }
            }
        }
        .navigationTitle(account.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button {
                        showingAddBalance = true
                    } label: {
                        Label("Add Balance", systemImage: "plus")
                    }
                    Button {
                        showingEditAccount = true
                    } label: {
                        Label("Edit Account", systemImage: "pencil")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .sheet(isPresented: $showingAddBalance) {
            AddBalanceView(account: account) {
                await reload()
                await onChanged()
            }
        }
        .sheet(isPresented: $showingEditAccount) {
            AccountFormView(existing: account) {
                await onChanged()
            }
        }
        .overlay {
            if isLoading && balances.isEmpty { ProgressView() }
        }
        .task { await reload() }
        .alert("Error", isPresented: .init(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private func reload() async {
        isLoading = true
        defer { isLoading = false }
        do {
            balances = try await APIClient.shared.get("/accounts/balances/account/\(account.id)")
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// Create or edit an account. `existing == nil` creates.
struct AccountFormView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(SessionStore.self) private var session

    let existing: AccountResponse?
    let onSaved: () async -> Void

    @State private var name: String
    @State private var liquidity: LiquidityStatus
    @State private var taxStatus: TaxTreatment
    @State private var kind: AccountKind
    @State private var currency: String
    @State private var isPrivate: Bool
    @State private var isSaving = false
    @State private var errorMessage: String?

    init(existing: AccountResponse?, onSaved: @escaping () async -> Void) {
        self.existing = existing
        self.onSaved = onSaved
        _name = State(initialValue: existing?.name ?? "")
        _liquidity = State(initialValue: existing?.liquidity ?? .liquid)
        _taxStatus = State(initialValue: existing.flatMap { TaxTreatment(rawValue: $0.taxStatus) } ?? .taxable)
        _kind = State(initialValue: existing?.kind.flatMap(AccountKind.init(rawValue:)) ?? .asset)
        _currency = State(initialValue: existing?.currency ?? "")
        _isPrivate = State(initialValue: existing?.ownerUserId != nil)
    }

    private var canSave: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty
            && currency.trimmingCharacters(in: .whitespaces).count >= 3
            && !isSaving
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $name)
                    TextField("Currency (e.g. USD)", text: $currency)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                }

                Section {
                    Picker("Type", selection: $kind) {
                        ForEach(AccountKind.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    Picker("Liquidity", selection: $liquidity) {
                        ForEach(LiquidityStatus.allCases) { Text($0.label).tag($0) }
                    }
                    Picker("Tax Status", selection: $taxStatus) {
                        ForEach(TaxTreatment.allCases) { Text($0.label).tag($0) }
                    }
                }

                Section {
                    Toggle("Private to me", isOn: $isPrivate)
                } footer: {
                    Text("Private accounts are visible only to you, not other household members.")
                }

                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle(existing == nil ? "New Account" : "Edit Account")
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
                if currency.isEmpty {
                    currency = session.activeHousehold?.baseCurrency ?? "USD"
                }
            }
        }
    }

    private func save() {
        guard canSave, let household = session.activeHousehold else { return }
        isSaving = true
        errorMessage = nil
        let owner = isPrivate ? session.user?.id : nil
        let cleanName = name.trimmingCharacters(in: .whitespaces)
        let cleanCurrency = currency.trimmingCharacters(in: .whitespaces).uppercased()
        Task {
            defer { isSaving = false }
            do {
                if let existing {
                    let _: AccountResponse = try await APIClient.shared.put(
                        "/accounts/\(existing.id)",
                        body: AccountUpdate(
                            name: cleanName, liquidity: liquidity, taxStatus: taxStatus,
                            kind: kind, currency: cleanCurrency, ownerUserId: owner
                        )
                    )
                } else {
                    let _: AccountResponse = try await APIClient.shared.post(
                        "/accounts",
                        body: AccountCreate(
                            householdId: household.id, name: cleanName, liquidity: liquidity,
                            taxStatus: taxStatus, kind: kind, currency: cleanCurrency, ownerUserId: owner
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

/// Record a manual balance for an account on a given date.
struct AddBalanceView: View {
    @Environment(\.dismiss) private var dismiss

    let account: AccountResponse
    let onSaved: () async -> Void

    @State private var date = Date()
    @State private var amountText = ""
    @State private var isSaving = false
    @State private var errorMessage: String?

    /// Balances may be negative (liabilities, overdrawn accounts).
    private var amount: Double? {
        Double(amountText.replacingOccurrences(of: ",", with: ""))
    }

    private var canSave: Bool { amount != nil && !isSaving }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        Text("Balance")
                        TextField("0.00", text: $amountText)
                            .keyboardType(.numbersAndPunctuation)
                            .multilineTextAlignment(.trailing)
                    }
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                } footer: {
                    Text("Recording a balance creates a reconciliation entry for the difference from the previous balance. Use a leading “-” for liabilities.")
                }

                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Add Balance")
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
        guard let amount else { return }
        isSaving = true
        errorMessage = nil
        Task {
            defer { isSaving = false }
            do {
                let _: BalanceResponse = try await APIClient.shared.post(
                    "/accounts/balances",
                    body: BalanceCreate(accountId: account.id, date: date.apiDateOnly, balance: amount, isManual: true)
                )
                await onSaved()
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}
