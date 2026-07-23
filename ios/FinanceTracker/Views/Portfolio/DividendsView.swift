import SwiftUI

/// Read-only dividend income, newest first, grouped by month with a running total.
/// Reached from the Portfolio tab.
struct DividendsView: View {
    @Environment(SessionStore.self) private var session
    @Environment(QuickAddStore.self) private var quickAdd

    @State private var dividends: [DividendResponse] = []
    @State private var assets: [AssetResponse] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    private var baseCurrency: String { session.activeHousehold?.baseCurrency ?? "USD" }

    private func ticker(for assetId: String) -> String {
        assets.first { $0.id == assetId }?.ticker ?? "—"
    }

    private var total: Double {
        dividends.reduce(0) { $0 + ($1.amountHomeCurrency ?? $1.amount) }
    }

    private var byMonth: [(month: Date, dividends: [DividendResponse])] {
        Dictionary(grouping: dividends.sorted { $0.date > $1.date }) { div in
            Calendar.current.dateInterval(of: .month, for: div.date)?.start ?? div.date
        }
        .map { (month: $0.key, dividends: $0.value) }
        .sorted { $0.month > $1.month }
    }

    var body: some View {
        List {
            if !dividends.isEmpty {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Total Received")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Text(total.currency(baseCurrency))
                            .font(.system(.title, design: .rounded, weight: .bold))
                    }
                    .padding(.vertical, 4)
                }
            }

            ForEach(byMonth, id: \.month) { group in
                Section(group.month.monthYear) {
                    ForEach(group.dividends) { dividend in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(ticker(for: dividend.assetId))
                                    .font(.body.bold())
                                Text(dividend.date.formatted(date: .abbreviated, time: .omitted))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text("+" + (dividend.amountHomeCurrency ?? dividend.amount).currency(baseCurrency))
                                .font(.body.monospacedDigit())
                                .foregroundStyle(.green)
                        }
                    }
                }
            }
        }
        .navigationTitle("Dividends")
        .navigationBarTitleDisplayMode(.inline)
        .overlay {
            if isLoading && dividends.isEmpty {
                ProgressView()
            } else if !isLoading && dividends.isEmpty {
                ContentUnavailableView(
                    "No Dividends",
                    systemImage: "dollarsign.circle",
                    description: Text("Dividend payouts on your holdings will appear here.")
                )
            }
        }
        .pullDownToQuickAdd(quickAdd, onReload: load)
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

    private func load() async {
        guard let household = session.activeHousehold else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            async let dividendsReq: [DividendResponse] = APIClient.shared.get("/portfolio/dividends/household/\(household.id)")
            async let assetsReq: [AssetResponse] = APIClient.shared.get("/portfolio/assets")
            (dividends, assets) = try await (dividendsReq, assetsReq)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// Record a price observation for a manually-priced asset (SSB, unlisted bonds…).
struct RecordPriceView: View {
    @Environment(\.dismiss) private var dismiss

    let asset: AssetResponse
    let householdId: String
    let onSaved: () async -> Void

    @State private var priceText = ""
    @State private var date = Date()
    @State private var isSaving = false
    @State private var errorMessage: String?

    private var price: Double? { Double(priceText.replacingOccurrences(of: ",", with: "")) }
    private var canSave: Bool { price ?? 0 > 0 && !isSaving }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent("Asset", value: asset.ticker)
                    HStack {
                        Text("Price (\(asset.currency))")
                        TextField("0.00", text: $priceText)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                    }
                    DatePicker("Date", selection: $date, in: ...Date(), displayedComponents: .date)
                } footer: {
                    Text("Valuations forward-fill from the latest recorded price and update immediately.")
                }

                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Record Price")
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
        guard let price else { return }
        isSaving = true
        errorMessage = nil
        Task {
            defer { isSaving = false }
            do {
                let _: ManualPriceResponse = try await APIClient.shared.post(
                    "/portfolio/assets/\(asset.id)/price",
                    body: ManualPriceCreate(householdId: householdId, date: date.apiDateOnly, price: price)
                )
                await onSaved()
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}
