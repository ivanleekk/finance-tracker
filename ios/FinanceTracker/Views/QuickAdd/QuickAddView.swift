import SwiftUI

/// The "command bar": an options-first quick-add opened by pulling down any main screen.
/// Pick a mode at the top, fill in the fields, and log it — covering expenses, income,
/// transfers, trades, dividends, and balance updates. Mirrors the web ⌘K command bar,
/// but structured (pick-then-fill) rather than a parsed CLI.
struct QuickAddView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(SessionStore.self) private var session
    @Environment(QuickAddStore.self) private var quickAdd
    @Environment(ReferenceDataStore.self) private var reference

    enum Mode: String, CaseIterable, Identifiable {
        case expense, income, transfer, trade, dividend, balance
        var id: String { rawValue }
        var label: String {
            switch self {
            case .expense: "Expense"
            case .income: "Income"
            case .transfer: "Transfer"
            case .trade: "Trade"
            case .dividend: "Dividend"
            case .balance: "Balance"
            }
        }
        var icon: String {
            switch self {
            case .expense: "arrow.up.circle.fill"
            case .income: "arrow.down.circle.fill"
            case .transfer: "arrow.left.arrow.right.circle.fill"
            case .trade: "chart.line.uptrend.xyaxis.circle.fill"
            case .dividend: "dollarsign.circle.fill"
            case .balance: "equal.circle.fill"
            }
        }
    }

    // Reference data, loaded once per household at the app root rather than on every
    // open — see `ReferenceDataStore` and #272.
    private var accounts: [AccountResponse] { reference.accounts }
    private var categories: [CategoryResponse] { reference.categories }
    private var subPortfolios: [SubPortfolioResponse] { reference.subPortfolios }
    private var assets: [AssetResponse] { reference.assets }

    // Shared fields
    @State private var mode: Mode = .expense
    @State private var amountText = ""
    @State private var date = Date()
    @State private var description = ""

    // Cash-flow fields
    @State private var accountId: String?
    @State private var categoryId: String?
    /// The card behind the selected account, if it is one. Fetched on demand —
    /// most accounts are not cards, and Quick Add is meant to be fast.
    @State private var card: CardResponse?
    @State private var cardHeadroom: [String: CardLimitStatusRow] = [:]
    @State private var cardCategoryId = ""
    /// The rest of what a payment can record. Quick Add used to leave these out
    /// as a "reduced surface", which meant the fastest way to log something was
    /// the one way that couldn't describe it fully — and the split in particular
    /// had to be added afterwards, from a different screen.
    @State private var mcc = ""
    @State private var isSplitting = false
    @State private var splitRows: [SplitRow] = []
    @State private var counterparties: [Counterparty] = []
    @State private var fromAccountId: String?
    @State private var toAccountId: String?

    // Portfolio fields
    @State private var subPortfolioId: String?
    @State private var assetId: String?
    @State private var tradeType: TradeType = .buy
    @State private var quantityText = ""
    @State private var priceText = ""
    @State private var settleFromCash = false

    @State private var isSaving = false
    /// Defaults are picked once, when the reference data first arrives.
    @State private var appliedDefaults = false
    @State private var showingNewCategory = false
    @State private var showingNewAsset = false
    @State private var errorMessage: String?

    private var household: HouseholdResponse? { session.activeHousehold }
    private var baseCurrency: String { household?.baseCurrency ?? "USD" }
    private var accent: Color { session.theme.primary.accent }

    private var filteredCategories: [CategoryResponse] {
        categories.filter { $0.type == (mode == .income ? .income : .expense) }
    }
    private var tradableAssets: [AssetResponse] {
        assets.filter { !$0.isCash }.sorted { $0.ticker < $1.ticker }
    }
    private var selectedAsset: AssetResponse? { assets.first { $0.id == assetId } }
    private var fundingCurrency: String { accounts.first { $0.id == accountId }?.currency ?? baseCurrency }

    private var amount: Double? { CalculatorInput.evaluateArithmeticExpression(amountText) }
    private var quantity: Double? { CalculatorInput.evaluateArithmeticExpression(quantityText) }
    private var price: Double? { CalculatorInput.evaluateArithmeticExpression(priceText) }

    private var canSave: Bool {
        guard !isSaving, household != nil else { return false }
        switch mode {
        case .expense, .income:
            return amount ?? 0 > 0 && accountId != nil && categoryId != nil
                && TransactionSplits.isUsable(isSplitting: isSplitting, amount: amount, rows: splitRows)
        case .transfer:
            return amount ?? 0 > 0 && fromAccountId != nil && toAccountId != nil && fromAccountId != toAccountId
        case .trade:
            return quantity ?? 0 > 0 && price ?? 0 > 0 && subPortfolioId != nil && assetId != nil && accountId != nil
        case .dividend:
            return amount ?? 0 > 0 && subPortfolioId != nil && assetId != nil && accountId != nil
        case .balance:
            return amount != nil && accountId != nil
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    modeSelector
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                }

                referenceStatusSection

                switch mode {
                case .expense, .income: cashFlowFields
                case .transfer: transferFields
                case .trade: tradeFields
                case .dividend: dividendFields
                case .balance: balanceFields
                }

                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Quick Add")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Log") { save() }
                        .disabled(!canSave)
                        .fontWeight(.semibold)
                }
            }
            .discardGuard(
                fields: [mode, amountText, date, description, accountId, categoryId,
                         cardCategoryId, mcc, isSplitting, splitRows,
                         fromAccountId, toAccountId, subPortfolioId, assetId,
                         tradeType, quantityText, priceText, settleFromCash],
                // `applyDefaults()` picks the default account / category / sub-portfolio only
                // once the reference data lands, so the baseline can't be taken before then.
                settled: referenceSettled
            )
            // Normally a no-op: the app root loaded this when the household resolved. It
            // still matters on the two paths that leave it unloaded — a household that
            // changed while the sheet was closed, and a load that failed, which this
            // retries on open.
            .task { await reference.load(householdId: household?.id) }
            .task(id: reference.status) { syncFromReference() }
            .onChange(of: mode) { resetForMode() }
            .onChange(of: accountId) { _, newValue in
                // A pick from the old card is meaningless on a new one.
                cardCategoryId = ""
                Task { await loadCard(for: newValue) }
            }
            .sheet(isPresented: $showingNewCategory) {
                if let household {
                    CategoryEditView(category: nil, householdId: household.id, lockedType: mode == .income ? .income : .expense) { created in
                        reference.add(category: created)
                        categoryId = created.id
                    }
                }
            }
            .sheet(isPresented: $showingNewAsset) {
                AssetCreateView(defaultCurrency: selectedAsset?.currency ?? accounts.first?.currency ?? baseCurrency) { created in
                    reference.add(asset: created)
                    assetId = created.id
                }
            }
        }
    }

    // MARK: - Mode selector

    private var modeSelector: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Mode.allCases) { m in
                    let selected = m == mode
                    Button {
                        withAnimation(.snappy(duration: 0.15)) { mode = m }
                    } label: {
                        Label(m.label, systemImage: m.icon)
                            .font(.subheadline.weight(.semibold))
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(selected ? accent : Color(.secondarySystemFill), in: Capsule())
                            .foregroundStyle(selected ? .white : .primary)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 4)
        }
    }

    // MARK: - Field groups

    private var cashFlowFields: some View {
        Group {
            Section {
                amountRow(currency: fundingCurrency)
                DatePicker("Date", selection: $date, displayedComponents: .date)
                TextField("Description (optional)", text: $description)
            }
            Section {
                accountPicker(title: "Account", selection: $accountId)
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
            // The same fields the full transaction form records — Quick Add is
            // the faster way to log a payment, not a lesser one. The card
            // category carries its headroom because logging card spend is
            // exactly when that number can still change a decision.
            CardCategorySection(
                card: card,
                headroom: cardHeadroom,
                currency: card?.currency ?? baseCurrency,
                cardCategoryId: $cardCategoryId
            )

            if mode == .expense, let household {
                TransactionSplitSection(
                    amount: amount,
                    householdId: household.id,
                    isSplitting: $isSplitting,
                    splitRows: $splitRows,
                    counterparties: $counterparties
                )
            }

            MerchantCodeSection(mcc: $mcc)
        }
    }

    private var transferFields: some View {
        Group {
            Section {
                accountPicker(title: "From", selection: $fromAccountId)
                accountPicker(title: "To", selection: $toAccountId)
            } footer: {
                if fromAccountId != nil && fromAccountId == toAccountId {
                    Text("Pick two different accounts.").foregroundStyle(.red)
                }
            }
            Section {
                amountRow(currency: accounts.first { $0.id == fromAccountId }?.currency ?? baseCurrency)
                DatePicker("Date", selection: $date, displayedComponents: .date)
                TextField("Description (optional)", text: $description)
            }
        }
    }

    private var tradeFields: some View {
        Group {
            Section {
                Picker("Type", selection: $tradeType) {
                    ForEach(TradeType.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                .draggableSegments(options: TradeType.allCases, selection: $tradeType)
                .listRowBackground(Color.clear)
            }
            Section {
                subPortfolioPicker
                Picker("Asset", selection: $assetId) {
                    Text("Select").tag(String?.none)
                    ForEach(tradableAssets) { asset in
                        Text(asset.ticker).tag(String?.some(asset.id))
                    }
                }
                Button {
                    showingNewAsset = true
                } label: {
                    Label("New Asset", systemImage: "plus.circle")
                }
            }
            Section {
                HStack {
                    Text("Quantity")
                    CalculatorField(placeholder: "0", text: $quantityText)
                        .multilineTextAlignment(.trailing)
                }
                HStack {
                    Text("Price\(selectedAsset.map { " (\($0.currency))" } ?? "")")
                    CalculatorField(placeholder: "0.00", text: $priceText)
                        .multilineTextAlignment(.trailing)
                }
                DatePicker("Date", selection: $date, displayedComponents: .date)
            } footer: {
                if let quantity, let price, let asset = selectedAsset {
                    Text("Estimated total: \((quantity * price).currency(asset.currency))")
                }
            }
            Section {
                Toggle("Settle from sub-portfolio cash", isOn: $settleFromCash)
                accountPicker(title: "Funding Account", selection: $accountId)
                TextField("Description (optional)", text: $description)
            }
        }
    }

    private var dividendFields: some View {
        Group {
            Section {
                subPortfolioPicker
                Picker("Asset", selection: $assetId) {
                    Text("Select").tag(String?.none)
                    ForEach(tradableAssets) { asset in
                        Text(asset.ticker).tag(String?.some(asset.id))
                    }
                }
                Button {
                    showingNewAsset = true
                } label: {
                    Label("New Asset", systemImage: "plus.circle")
                }
            }
            Section {
                amountRow(currency: baseCurrency)
                accountPicker(title: "Credited Account", selection: $accountId)
                DatePicker("Date", selection: $date, displayedComponents: .date)
            } footer: {
                Text("Records a dividend payout for this holding.")
            }
        }
    }

    private var balanceFields: some View {
        Section {
            accountPicker(title: "Account", selection: $accountId)
            HStack {
                Text("Balance (\(fundingCurrency))")
                CalculatorField(placeholder: "0.00", text: $amountText)
                    .multilineTextAlignment(.trailing)
            }
            DatePicker("Date", selection: $date, displayedComponents: .date)
        } footer: {
            Text("Sets the account's balance on this date; the difference is reconciled. Use a leading “-” for liabilities.")
        }
    }

    // MARK: - Reusable rows

    private func amountRow(currency: String) -> some View {
        HStack {
            Text("Amount (\(currency))")
            CalculatorField(placeholder: "0.00", text: $amountText)
                .multilineTextAlignment(.trailing)
        }
    }

    private func accountPicker(title: String, selection: Binding<String?>) -> some View {
        Picker(title, selection: selection) {
            Text("Select").tag(String?.none)
            ForEach(selectableAccounts(accounts)) { account in
                Text(account.name).tag(String?.some(account.id))
            }
        }
    }

    private var subPortfolioPicker: some View {
        Picker("Sub-Portfolio", selection: $subPortfolioId) {
            Text("Select").tag(String?.none)
            ForEach(subPortfolios) { sp in
                Text(sp.name).tag(String?.some(sp.id))
            }
        }
    }

    // MARK: - Data

    /// The card behind an account, with this cycle's headroom — or nothing, which
    /// is the common answer rather than an error.
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

    /// True once the defaults below are final and the discard guard can snapshot its
    /// baseline. It tracks `applyDefaults()` having run to completion, **not** the store
    /// reaching `.ready`: the store's status is read during `body`, which SwiftUI
    /// re-evaluates before the `.task` that reacts to it, so settling on the status alone
    /// takes the baseline one pass too early and the sheet's own default asset reads back
    /// as a user edit — "Discard changes?" on an untouched form.
    private var referenceSettled: Bool { appliedDefaults || reference.isFailed }

    /// Fold the store's latest into the sheet's own state. Called whenever the store's
    /// status moves, so the pickers pick up the staged arrivals (accounts and categories
    /// first, the portfolio sets a moment later).
    private func syncFromReference() {
        // The split section can create a counterparty inline, so the sheet owns a mutable
        // copy. Merge rather than overwrite, or the second stage of the load would drop
        // one the user had just added. (Dismissing the sheet bumps `reloadToken`, which
        // re-fetches the store, so the addition isn't lost on the next open either.)
        let known = Set(reference.counterparties.map(\.id))
        counterparties = (reference.counterparties + counterparties.filter { !known.contains($0.id) })
            .sorted { $0.name < $1.name }
        guard reference.hasEssentials, !appliedDefaults else { return }
        applyDefaults()
        // Only once everything has landed are the sub-portfolio and asset defaults real,
        // so the second stage gets its own pass before this is called done.
        if reference.status == .ready { appliedDefaults = true }
    }

    /// Says which of the three states the pickers are in — still loading, failed, or
    /// genuinely empty — instead of leaving every picker on a bare "Select", which reads
    /// as "this household has no accounts" (#272).
    @ViewBuilder
    private var referenceStatusSection: some View {
        if let message = reference.failureMessage {
            Section {
                Label(message, systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.red)
                Button {
                    Task { await reference.load(householdId: household?.id, force: true) }
                } label: {
                    Label("Retry", systemImage: "arrow.clockwise")
                }
            }
        } else if !reference.hasEssentials {
            Section {
                HStack(spacing: 10) {
                    ProgressView()
                    Text("Loading your accounts…").foregroundStyle(.secondary)
                }
            }
        } else if selectableAccounts(accounts).isEmpty {
            Section {
                Label("No accounts yet — add one from the Accounts tab first.",
                      systemImage: "building.columns")
                    .foregroundStyle(.secondary)
            }
        }
    }

    /// Pick sensible defaults, preferring the household's configured funding account and
    /// sub-portfolio (mirrors the web/mobile quick-add routing). Expense/income starts
    /// from the user's own default expense account instead, when one is set.
    private func applyDefaults() {
        let funding = accounts.first { $0.id == household?.defaultFundingAccountId } ?? accounts.first
        let expenseDefault = accounts.first { $0.id == session.user?.defaultAccountId } ?? funding
        if accountId == nil { accountId = (mode == .expense || mode == .income) ? expenseDefault?.id : funding?.id }
        if fromAccountId == nil { fromAccountId = funding?.id }
        if toAccountId == nil { toAccountId = accounts.first { $0.id != fromAccountId }?.id }
        if categoryId == nil { categoryId = filteredCategories.first?.id }
        let defaultSub = subPortfolios.first { $0.id == household?.defaultSubPortfolioId } ?? subPortfolios.first
        if subPortfolioId == nil { subPortfolioId = defaultSub?.id }
        if assetId == nil { assetId = tradableAssets.first?.id }
    }

    private func resetForMode() {
        errorMessage = nil
        if categoryId == nil || !filteredCategories.contains(where: { $0.id == categoryId }) {
            categoryId = filteredCategories.first?.id
        }
    }

    // MARK: - Save

    private func save() {
        guard canSave, let household else { return }
        isSaving = true
        errorMessage = nil
        Task {
            defer { isSaving = false }
            do {
                switch mode {
                case .expense, .income:
                    try await saveTransaction(household: household)
                case .transfer:
                    try await saveTransfer()
                case .trade:
                    try await saveTrade(household: household)
                case .dividend:
                    try await saveDividend(household: household)
                case .balance:
                    try await saveBalance()
                }
                quickAdd.requestReload()
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func saveTransaction(household: HouseholdResponse) async throws {
        guard let amount, let accountId, let categoryId else { return }
        let _: TransactionResponse = try await APIClient.shared.post(
            "/cashflow/transactions",
            body: TransactionCreate(
                date: date, amount: amount,
                description: description.isEmpty ? nil : description,
                accountId: accountId, categoryId: categoryId,
                splits: TransactionSplits.forCreate(
                    isSplitting: isSplitting, amount: amount, rows: splitRows
                ),
                mcc: mcc,
                cardCategoryId: cardCategoryId.isEmpty ? nil : cardCategoryId
            )
        )
    }

    private func saveTransfer() async throws {
        guard let amount, let fromAccountId, let toAccountId else { return }
        let _: [TransactionResponse] = try await APIClient.shared.post(
            "/cashflow/transfers",
            body: TransferCreate(
                fromAccountId: fromAccountId, toAccountId: toAccountId,
                amount: amount, date: date,
                description: description.isEmpty ? nil : description
            )
        )
    }

    private func saveTrade(household: HouseholdResponse) async throws {
        guard let quantity, let price, let subPortfolioId, let assetId, let accountId else { return }
        let _: TradeResponse = try await APIClient.shared.post(
            "/portfolio/trades",
            body: TradeCreate(
                type: tradeType, date: date, quantity: quantity, price: price,
                currency: selectedAsset?.currency, exchangeRate: 1.0,
                description: description.isEmpty ? nil : description,
                householdId: household.id, subPortfolioId: subPortfolioId,
                assetId: assetId, accountId: accountId, settleFromCash: settleFromCash
            )
        )
    }

    private func saveDividend(household: HouseholdResponse) async throws {
        guard let amount, let subPortfolioId, let assetId, let accountId else { return }
        let _: DividendResponse = try await APIClient.shared.post(
            "/portfolio/dividends",
            body: DividendCreate(
                householdId: household.id, subPortfolioId: subPortfolioId,
                assetId: assetId, accountId: accountId,
                date: date, amount: amount, exchangeRate: 1.0
            )
        )
    }

    private func saveBalance() async throws {
        guard let amount, let accountId else { return }
        let _: BalanceResponse = try await APIClient.shared.post(
            "/accounts/balances",
            body: BalanceCreate(accountId: accountId, date: date.apiDateOnly, balance: amount, isManual: true)
        )
    }
}
