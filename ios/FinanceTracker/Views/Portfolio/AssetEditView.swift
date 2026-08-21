import SwiftUI

/// Corrects an asset's identity (PUT /portfolio/assets/{id}).
///
/// The case this exists for: a ticker created with the wrong currency -- a
/// Singapore listing entered as USD -- which silently misvalues every snapshot
/// it appears in. Saving replays the affected snapshots server-side, so the
/// caller reloads afterwards rather than patching its copy in place.
struct AssetEditView: View {
    @Environment(\.dismiss) private var dismiss

    let asset: AssetResponse
    let onSaved: () async -> Void

    @State private var ticker: String
    @State private var name: String
    @State private var type: String
    @State private var currency: String
    @State private var isManualPriced: Bool
    @State private var isSaving = false
    @State private var errorMessage: String?

    init(asset: AssetResponse, onSaved: @escaping () async -> Void) {
        self.asset = asset
        self.onSaved = onSaved
        _ticker = State(initialValue: asset.ticker)
        _name = State(initialValue: asset.name)
        _type = State(initialValue: asset.type)
        _currency = State(initialValue: asset.currency)
        _isManualPriced = State(initialValue: asset.isManualPriced)
    }

    private var trimmedTicker: String {
        ticker.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    }

    private var canSave: Bool { !trimmedTicker.isEmpty && !currency.isEmpty && !isSaving }

    /// Ticker and currency are the two fields that reach back into history.
    private var revaluesHistory: Bool {
        trimmedTicker != asset.ticker || currency != asset.currency
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    // Labelled rows rather than bare placeholders: every field here
                    // arrives pre-filled, so a placeholder would never be visible.
                    LabeledField("Ticker") {
                        TextField("VWRA.L", text: $ticker)
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                            .multilineTextAlignment(.trailing)
                    }
                    LabeledField("Name") {
                        TextField("Asset name", text: $name)
                            .multilineTextAlignment(.trailing)
                    }
                    LabeledField("Type") {
                        TextField("stock", text: $type)
                            .autocorrectionDisabled()
                            .multilineTextAlignment(.trailing)
                    }
                } footer: {
                    Text("The ticker has to match the symbol prices are looked up by — Singapore listings end in .SI, London in .L.")
                }

                Section {
                    NavigationLink {
                        CurrencyPicker(selection: $currency)
                    } label: {
                        LabeledContent("Currency", value: currency)
                    }
                    Toggle("I record prices manually", isOn: $isManualPriced)
                } footer: {
                    Text(isManualPriced
                         ? "Prices come from what you record — for unlisted bonds and SSBs."
                         : "Prices come from market data for this ticker.")
                }

                if revaluesHistory {
                    Section {
                        Label(
                            "Valuations recalculate back to your first trade in this asset.",
                            systemImage: "clock.arrow.circlepath"
                        )
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    }
                }

                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Edit Asset")
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
        isSaving = true
        errorMessage = nil
        Task {
            defer { isSaving = false }
            do {
                let _: AssetResponse = try await APIClient.shared.put(
                    "/portfolio/assets/\(asset.id)",
                    body: AssetUpdate(
                        ticker: trimmedTicker,
                        name: name.trimmingCharacters(in: .whitespacesAndNewlines),
                        type: type.trimmingCharacters(in: .whitespacesAndNewlines),
                        currency: currency,
                        pricingMode: isManualPriced ? "manual" : "market"
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

/// A form row with a fixed leading label and a trailing editable field.
private struct LabeledField<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    init(_ title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        HStack {
            Text(title)
            content
        }
    }
}
