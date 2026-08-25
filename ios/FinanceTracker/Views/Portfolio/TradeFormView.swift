import SwiftUI

/// Log or edit a buy/sell of an asset in a sub-portfolio, funded from an account (or the
/// sub-portfolio's own cash). Cross-currency trades assume a 1:1 rate for now.
/// Pass `existing` to edit a trade in place (PUT); omit it to create (POST).
struct TradeFormView: View {
    @Environment(\.dismiss) private var dismiss

    let existing: TradeResponse?
    let householdId: String
    let subPortfolios: [SubPortfolioResponse]
    let accounts: [AccountResponse]
    let onSaved: () async -> Void

    @State private var assets: [AssetResponse]
    @State private var type: TradeType
    @State private var subPortfolioId: String?
    @State private var assetId: String?
    @State private var accountId: String?
    @State private var quantityText: String
    @State private var priceText: String
    @State private var date: Date
    @State private var settleFromCash = false
    @State private var description: String
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var showingNewAsset = false

    private var isEditing: Bool { existing != nil }

    init(
        existing: TradeResponse? = nil,
        householdId: String,
        subPortfolios: [SubPortfolioResponse],
        assets: [AssetResponse],
        accounts: [AccountResponse],
        onSaved: @escaping () async -> Void
    ) {
        self.existing = existing
        self.householdId = householdId
        self.subPortfolios = subPortfolios
        self.accounts = accounts
        self.onSaved = onSaved
        _assets = State(initialValue: assets)
        _type = State(initialValue: existing?.type ?? .buy)
        _subPortfolioId = State(initialValue: existing?.subPortfolioId)
        _assetId = State(initialValue: existing?.assetId)
        _accountId = State(initialValue: existing?.accountId)
        _quantityText = State(initialValue: existing.map { Self.numberString($0.quantity) } ?? "")
        _priceText = State(initialValue: existing.map { Self.numberString($0.price) } ?? "")
        _date = State(initialValue: existing?.date ?? Date())
        _description = State(initialValue: existing?.description ?? "")
    }

    /// Editable string for a stored number: drop the trailing ".0" on whole values.
    private static func numberString(_ value: Double) -> String {
        value == value.rounded() ? String(Int(value)) : String(value)
    }

    /// Real (non-cash) assets are tradable.
    private var tradableAssets: [AssetResponse] {
        assets.filter { !$0.isCash }.sorted { $0.ticker < $1.ticker }
    }

    private var selectedAsset: AssetResponse? {
        assets.first { $0.id == assetId }
    }

    private var quantity: Double? { Double(quantityText.replacingOccurrences(of: ",", with: "")) }
    private var price: Double? { Double(priceText.replacingOccurrences(of: ",", with: "")) }

    private var estimatedTotal: Double? {
        guard let quantity, let price else { return nil }
        return quantity * price
    }

    private var canSave: Bool {
        quantity ?? 0 > 0 && price ?? 0 > 0
            && subPortfolioId != nil && assetId != nil && accountId != nil
            && !isSaving
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Type", selection: $type) {
                        ForEach(TradeType.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                }

                Section {
                    Picker("Sub-Portfolio", selection: $subPortfolioId) {
                        Text("Select").tag(String?.none)
                        ForEach(subPortfolios) { sp in
                            Text(sp.name).tag(String?.some(sp.id))
                        }
                    }
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
                        TextField("0", text: $quantityText)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                    }
                    HStack {
                        Text("Price\(selectedAsset.map { " (\($0.currency))" } ?? "")")
                        TextField("0.00", text: $priceText)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                    }
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                } footer: {
                    if let estimatedTotal, let asset = selectedAsset {
                        Text("Estimated total: \(estimatedTotal.currency(asset.currency))")
                    }
                }

                Section {
                    // Settlement mode is fixed once a trade exists (the backend keeps any
                    // cash companion leg in sync), so it's only offered when creating.
                    if !isEditing {
                        Toggle("Settle from sub-portfolio cash", isOn: $settleFromCash)
                    }
                    Picker("Funding Account", selection: $accountId) {
                        Text("Select").tag(String?.none)
                        ForEach(accounts) { account in
                            Text(account.name).tag(String?.some(account.id))
                        }
                    }
                    TextField("Description (optional)", text: $description)
                } footer: {
                    Text(settleFromCash
                         ? "Buys draw on the sub-portfolio's own cash; the account sets the settlement currency."
                         : "The funding account is debited (buy) or credited (sell).")
                }

                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle(isEditing ? "Edit Trade" : "New Trade")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .disabled(!canSave)
                }
            }
            .discardGuard(fields: [type, subPortfolioId, assetId, accountId, quantityText, priceText, date, settleFromCash, description])
            .onAppear {
                if subPortfolioId == nil { subPortfolioId = subPortfolios.first?.id }
                if assetId == nil { assetId = tradableAssets.first?.id }
                if accountId == nil { accountId = accounts.first?.id }
            }
            .sheet(isPresented: $showingNewAsset) {
                AssetCreateView(defaultCurrency: selectedAsset?.currency ?? accounts.first?.currency ?? "USD") { created in
                    assets.append(created)
                    assetId = created.id
                }
            }
        }
    }

    private func save() {
        guard let quantity, let price,
              let subPortfolioId, let assetId, let accountId else { return }
        isSaving = true
        errorMessage = nil
        Task {
            defer { isSaving = false }
            do {
                if let existing {
                    let body = TradeUpdate(
                        type: type,
                        date: date,
                        quantity: quantity,
                        price: price,
                        currency: selectedAsset?.currency,
                        exchangeRate: existing.exchangeRate,
                        description: description.isEmpty ? nil : description,
                        subPortfolioId: subPortfolioId,
                        assetId: assetId,
                        accountId: accountId
                    )
                    let _: TradeResponse = try await APIClient.shared.put(
                        "/portfolio/trades/\(existing.id)", body: body
                    )
                } else {
                    let body = TradeCreate(
                        type: type,
                        date: date,
                        quantity: quantity,
                        price: price,
                        currency: selectedAsset?.currency,
                        exchangeRate: 1.0,
                        description: description.isEmpty ? nil : description,
                        householdId: householdId,
                        subPortfolioId: subPortfolioId,
                        assetId: assetId,
                        accountId: accountId,
                        settleFromCash: settleFromCash
                    )
                    let _: TradeResponse = try await APIClient.shared.post("/portfolio/trades", body: body)
                }
                await onSaved()
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

/// Deposit cash into (or withdraw it from) a sub-portfolio, moving money to/from a
/// funding account. Buys settled from cash draw on this balance.
struct CashMoveFormView: View {
    @Environment(\.dismiss) private var dismiss

    let householdId: String
    let subPortfolios: [SubPortfolioResponse]
    let accounts: [AccountResponse]
    let onSaved: () async -> Void

    private enum Direction: String, CaseIterable, Identifiable {
        case deposit, withdraw
        var id: String { rawValue }
        var label: String { self == .deposit ? "Deposit" : "Withdraw" }
    }

    @State private var subPortfolioId: String?
    @State private var accountId: String?
    @State private var direction: Direction = .deposit
    @State private var amountText = ""
    @State private var date = Date()
    @State private var description = ""
    @State private var isSaving = false
    @State private var errorMessage: String?

    private var amount: Double? { Double(amountText.replacingOccurrences(of: ",", with: "")) }

    private var fundingCurrency: String {
        accounts.first { $0.id == accountId }?.currency ?? "USD"
    }

    private var canSave: Bool {
        amount ?? 0 > 0 && subPortfolioId != nil && accountId != nil && !isSaving
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Direction", selection: $direction) {
                        ForEach(Direction.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                }

                Section {
                    Picker("Sub-Portfolio", selection: $subPortfolioId) {
                        Text("Select").tag(String?.none)
                        ForEach(subPortfolios) { sp in
                            Text(sp.name).tag(String?.some(sp.id))
                        }
                    }
                    Picker("Account", selection: $accountId) {
                        Text("Select").tag(String?.none)
                        ForEach(accounts) { account in
                            Text(account.name).tag(String?.some(account.id))
                        }
                    }
                } footer: {
                    Text(direction == .deposit
                         ? "Moves cash from the account into the sub-portfolio."
                         : "Returns cash from the sub-portfolio to the account.")
                }

                Section {
                    HStack {
                        Text("Amount (\(fundingCurrency))")
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
            .navigationTitle("Move Cash")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .disabled(!canSave)
                }
            }
            .discardGuard(fields: [subPortfolioId, accountId, direction, amountText, date, description])
            .onAppear {
                if subPortfolioId == nil { subPortfolioId = subPortfolios.first?.id }
                if accountId == nil { accountId = accounts.first?.id }
            }
        }
    }

    private func save() {
        guard let amount, let subPortfolioId, let accountId else { return }
        isSaving = true
        errorMessage = nil
        Task {
            defer { isSaving = false }
            do {
                let body = SubPortfolioCashCreate(
                    householdId: householdId,
                    accountId: accountId,
                    direction: direction.rawValue,
                    amount: amount,
                    currency: fundingCurrency,
                    date: date,
                    exchangeRate: 1.0,
                    description: description.isEmpty ? nil : description
                )
                let _: TradeResponse = try await APIClient.shared.post(
                    "/portfolio/subportfolios/\(subPortfolioId)/cash", body: body
                )
                await onSaved()
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

/// Create a tradable asset (ticker/name/type/currency/pricing mode).
struct AssetCreateView: View {
    @Environment(\.dismiss) private var dismiss

    let defaultCurrency: String
    let onCreated: (AssetResponse) -> Void

    private static let assetTypes = ["stock", "etf", "bond", "crypto"]

    @State private var ticker = ""
    @State private var name = ""
    @State private var assetType = "stock"
    @State private var currency: String
    @State private var pricingMode = "market"
    @State private var isSaving = false
    @State private var errorMessage: String?

    init(defaultCurrency: String, onCreated: @escaping (AssetResponse) -> Void) {
        self.defaultCurrency = defaultCurrency
        self.onCreated = onCreated
        _currency = State(initialValue: defaultCurrency)
    }

    private var canSave: Bool {
        !ticker.trimmingCharacters(in: .whitespaces).isEmpty
            && !name.trimmingCharacters(in: .whitespaces).isEmpty
            && currency.trimmingCharacters(in: .whitespaces).count >= 3
            && !isSaving
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Ticker (e.g. AAPL)", text: $ticker)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                    TextField("Name", text: $name)
                    TextField("Currency", text: $currency)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                }

                Section {
                    Picker("Type", selection: $assetType) {
                        ForEach(Self.assetTypes, id: \.self) { Text($0.capitalized).tag($0) }
                    }
                    Picker("Pricing", selection: $pricingMode) {
                        Text("Market").tag("market")
                        Text("Manual").tag("manual")
                    }
                    .pickerStyle(.segmented)
                } footer: {
                    Text("“Market” prices from Yahoo Finance by ticker. “Manual” means you record prices yourself (e.g. unlisted bonds).")
                }

                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("New Asset")
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
                let created: AssetResponse = try await APIClient.shared.post(
                    "/portfolio/assets",
                    body: AssetCreate(
                        id: UUID().uuidString.lowercased(),
                        ticker: ticker.trimmingCharacters(in: .whitespaces).uppercased(),
                        name: name.trimmingCharacters(in: .whitespaces),
                        type: assetType,
                        currency: currency.trimmingCharacters(in: .whitespaces).uppercased(),
                        pricingMode: pricingMode
                    )
                )
                onCreated(created)
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}
