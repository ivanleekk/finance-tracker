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
    @State private var equity: [LinkedEquityRow] = []
    @State private var isLoading = true
    @State private var showingAddAccount = false
    @State private var errorMessage: String?
    @State private var lastLoadedAt: Date?

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

    /// Properties a loan can be secured against, for the account form's picker.
    private var propertyAccounts: [AccountResponse] {
        visibleAccounts.filter { $0.liquidity == .illiquid && !$0.isLiability }
    }

    /// Equity rows for properties the current view mode actually shows.
    private var visibleEquity: [LinkedEquityRow] {
        equity.filter { row in visibleAccounts.contains { $0.id == row.assetAccountId } }
    }

    var body: some View {
        // Computed once per body evaluation and reused for every account row
        // below, instead of each row re-scanning the whole balance history.
        let latestByAccount = latestBalanceByAccount
        List {
            QuickAddPullSensor()

            if !visibleEquity.isEmpty {
                Section("Property & equity") {
                    ForEach(visibleEquity) { row in
                        EquityRow(row: row, currency: session.activeHousehold?.baseCurrency ?? "USD")
                    }
                }
            }

            ForEach(grouped, id: \.liquidity) { group in
                Section(group.liquidity.label) {
                    ForEach(group.accounts) { account in
                        NavigationLink {
                            AccountDetailView(account: account, onChanged: load)
                        } label: {
                            AccountRow(account: account, latestBalance: latestByAccount[account.id])
                        }
                    }
                }
            }
        }
        .navigationTitle("Accounts")
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { VaultLockButton() }
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
            AccountFormView(existing: nil, propertyAccounts: propertyAccounts) { await load() }
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
        .task { await loadIfNeeded() }
        .alert("Error", isPresented: .init(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage ?? "")
        }
    }

    /// One pass over the whole balance history instead of re-filtering it per
    /// account row (`.filter { ... }.max { ... }` was O(accounts × balances)).
    private var latestBalanceByAccount: [String: BalanceResponse] {
        balances.reduce(into: [:]) { result, balance in
            if let existing = result[balance.accountId], existing.date >= balance.date { return }
            result[balance.accountId] = balance
        }
    }

    /// Mirrors Dashboard's staleness guard: skip refetching on every tab
    /// reselect when the list was loaded moments ago. `onReload`/`onChanged`
    /// callbacks bypass this and always force a real reload after an edit.
    private static let stalenessWindow: TimeInterval = 30

    private func loadIfNeeded() async {
        if let lastLoadedAt, Date().timeIntervalSince(lastLoadedAt) < Self.stalenessWindow {
            return
        }
        await load()
    }

    private func load() async {
        guard let household = session.activeHousehold else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            async let accountsReq: [AccountResponse] = APIClient.shared.get("/accounts/household/\(household.id)")
            async let balancesReq: [BalanceResponse] = APIClient.shared.get("/accounts/balances/household/\(household.id)")
            (accounts, balances) = try await (accountsReq, balancesReq)
            // Equity is a supplementary panel — a failure here shouldn't blank
            // the accounts list the user came for.
            equity = (try? await APIClient.shared.get("/accounts/household/\(household.id)/equity")) ?? []
            lastLoadedAt = Date()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct AccountDetailView: View {
    @Environment(SessionStore.self) private var session
    @Environment(QuickAddStore.self) private var quickAdd

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

    /// Properties this account's loan could be secured against. Fetched here
    /// because the detail screen can be pushed straight from the Dashboard,
    /// without the accounts list ever having loaded.
    @State private var propertyAccounts: [AccountResponse] = []
    /// Where the finger is on the balance chart, or nil when nobody is scrubbing.
    @State private var chartScrubDate: Date?

    var body: some View {
        List {
            if account.hasLoanTerms {
                Section {
                    NavigationLink {
                        LoanScheduleView(account: account)
                    } label: {
                        Label("Payoff schedule", systemImage: "calendar.badge.clock")
                    }
                } footer: {
                    Text("Every payment split into interest and principal, with your payoff date.")
                }
            }

            if sorted.count > 1 {
                Section {
                    let readout = chartScrubDate
                        .flatMap { ChartStyle.nearest(to: $0, in: sorted, by: \.date) }
                        .map { point in
                            ChartScrubReadout(
                                date: point.date,
                                entries: [ChartScrubEntry(label: "Balance", value: point.balance,
                                                          color: session.theme.primary.accent,
                                                          markerY: point.balance)]
                            )
                        }
                    Chart(sorted) { balance in
                        AreaMark(
                            x: .value("Date", balance.date),
                            y: .value("Balance", balance.balance)
                        )
                        .foregroundStyle(ChartStyle.accentFill(session.theme.primary.accent))
                        .interpolationMethod(.monotone)
                        LineMark(
                            x: .value("Date", balance.date),
                            y: .value("Balance", balance.balance)
                        )
                        .foregroundStyle(session.theme.primary.accent)
                        .lineStyle(StrokeStyle(lineWidth: ChartStyle.lineWidth, lineCap: .round, lineJoin: .round))
                        .interpolationMethod(.monotone)
                    }
                    .financeChartAxes(
                        currency: account.currency,
                        dateSpan: sorted.last?.date.timeIntervalSince(sorted[0].date)
                    )
                    .chartScrub(selection: $chartScrubDate, readout: readout)
                    .adaptiveChartHeight(compact: 160, regular: 280)
                    .padding(.vertical, 4)

                    ChartScrubCaption(readout: readout, currency: account.currency,
                                      selection: $chartScrubDate)
                        .listRowSeparator(.hidden)
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
            AccountFormView(existing: account, propertyAccounts: propertyAccounts) {
                await onChanged()
            }
        }
        .overlay {
            if isLoading && balances.isEmpty { ProgressView() }
        }
        .quickAddPull(quickAdd, onReload: reload)
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
        // Only a liability can be secured against something, so don't spend the
        // request otherwise. A failure just means an empty picker.
        if account.isLiability, let household = session.activeHousehold {
            let all: [AccountResponse] =
                (try? await APIClient.shared.get("/accounts/household/\(household.id)")) ?? []
            propertyAccounts = all.filter { $0.liquidity == .illiquid && !$0.isLiability }
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
    /// On create, `isPrivate` is seeded from the user's "default new items private"
    /// preference in onAppear — SessionStore isn't reachable from init.
    @State private var didSeedPrivacy: Bool
    @State private var isSaving = false
    @State private var errorMessage: String?

    // Optional loan terms (liabilities) and property terms (illiquid assets).
    // Held as text so a blank field means "not set" rather than 0.
    @State private var principalText: String
    @State private var rateText: String
    @State private var termMonthsText: String
    @State private var paymentText: String
    @State private var hasLoanStart: Bool
    @State private var loanStartDate: Date
    @State private var appreciationText: String
    @State private var linkedAccountId: String

    /// Property accounts a loan can be secured against. Passed in so the form
    /// doesn't need its own fetch.
    var propertyAccounts: [AccountResponse] = []

    init(existing: AccountResponse?, propertyAccounts: [AccountResponse] = [], onSaved: @escaping () async -> Void) {
        self.propertyAccounts = propertyAccounts
        self.existing = existing
        self.onSaved = onSaved
        _name = State(initialValue: existing?.name ?? "")
        _liquidity = State(initialValue: existing?.liquidity ?? .liquid)
        _taxStatus = State(initialValue: existing.flatMap { TaxTreatment(rawValue: $0.taxStatus) } ?? .taxable)
        _kind = State(initialValue: existing?.kind.flatMap(AccountKind.init(rawValue:)) ?? .asset)
        _currency = State(initialValue: existing?.currency ?? "")
        _isPrivate = State(initialValue: existing?.ownerUserId != nil)
        _didSeedPrivacy = State(initialValue: existing != nil)

        _principalText = State(initialValue: existing?.originalPrincipal.map { String($0) } ?? "")
        _rateText = State(initialValue: existing?.interestRateAnnual.map { String($0) } ?? "")
        _termMonthsText = State(initialValue: existing?.loanTermMonths.map(String.init) ?? "")
        _paymentText = State(initialValue: existing?.monthlyPayment.map { String($0) } ?? "")
        _hasLoanStart = State(initialValue: existing?.loanStartDate != nil)
        _loanStartDate = State(initialValue: existing?.loanStartDate ?? Date())
        _appreciationText = State(initialValue: existing?.appreciationRateAnnual.map { String($0) } ?? "")
        _linkedAccountId = State(initialValue: existing?.linkedAccountId ?? "")
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

                if kind == .liability {
                    Section {
                        TextField("Amount borrowed", text: $principalText)
                            .keyboardType(.decimalPad)
                        TextField("Interest rate % / yr", text: $rateText)
                            .keyboardType(.decimalPad)
                        TextField("Term (months)", text: $termMonthsText)
                            .keyboardType(.numberPad)
                        TextField("Monthly payment (optional)", text: $paymentText)
                            .keyboardType(.decimalPad)
                        Toggle("Set first payment date", isOn: $hasLoanStart.animation())
                        if hasLoanStart {
                            DatePicker(
                                "First payment", selection: $loanStartDate, displayedComponents: .date
                            )
                        }
                        if !propertyAccounts.isEmpty {
                            Picker("Secured against", selection: $linkedAccountId) {
                                Text("Nothing — unsecured").tag("")
                                ForEach(propertyAccounts) { Text($0.name).tag($0.id) }
                            }
                        }
                    } header: {
                        Text("Loan terms")
                    } footer: {
                        Text("Optional. With the amount, rate, term and first payment set, we amortize the balance down and show your payoff date. Leave the monthly payment blank to calculate it.")
                    }
                }

                if kind == .asset && liquidity == .illiquid {
                    Section {
                        TextField("Expected appreciation % / yr", text: $appreciationText)
                            .keyboardType(.numbersAndPunctuation)
                    } header: {
                        Text("Property")
                    } footer: {
                        Text("Used only for the net worth projection — your recorded valuations are never overwritten. Leave blank to hold today's value flat.")
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
                if !didSeedPrivacy {
                    isPrivate = session.user?.defaultsNewItemsPrivate ?? false
                    didSeedPrivacy = true
                }
            }
        }
    }

    /// Blank means "no term set", so send nil rather than 0 — the backend
    /// treats a partial set of terms as "no terms" and keeps the flat balance.
    private func loanNumber(_ text: String) -> Double? {
        guard kind == .liability else { return nil }
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, let value = Double(trimmed), value > 0 else { return nil }
        return value
    }

    private func loanInt(_ text: String) -> Int? {
        guard kind == .liability else { return nil }
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, let value = Int(trimmed), value > 0 else { return nil }
        return value
    }

    /// Property can fall in value, so a negative rate is legitimate here.
    private func propertyNumber(_ text: String) -> Double? {
        guard kind == .asset, liquidity == .illiquid else { return nil }
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, let value = Double(trimmed) else { return nil }
        return value
    }

    private var loanStartValue: String? {
        guard kind == .liability, hasLoanStart else { return nil }
        return loanStartDate.apiDateOnly
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
                            kind: kind, currency: cleanCurrency, ownerUserId: owner,
                            originalPrincipal: loanNumber(principalText),
                            interestRateAnnual: loanNumber(rateText),
                            loanTermMonths: loanInt(termMonthsText),
                            monthlyPayment: loanNumber(paymentText),
                            loanStartDate: loanStartValue,
                            appreciationRateAnnual: propertyNumber(appreciationText),
                            linkedAccountId: linkedAccountId.isEmpty ? nil : linkedAccountId
                        )
                    )
                } else {
                    let _: AccountResponse = try await APIClient.shared.post(
                        "/accounts",
                        body: AccountCreate(
                            householdId: household.id, name: cleanName, liquidity: liquidity,
                            taxStatus: taxStatus, kind: kind, currency: cleanCurrency, ownerUserId: owner,
                            originalPrincipal: loanNumber(principalText),
                            interestRateAnnual: loanNumber(rateText),
                            loanTermMonths: loanInt(termMonthsText),
                            monthlyPayment: loanNumber(paymentText),
                            loanStartDate: loanStartValue,
                            appreciationRateAnnual: propertyNumber(appreciationText),
                            linkedAccountId: linkedAccountId.isEmpty ? nil : linkedAccountId
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
