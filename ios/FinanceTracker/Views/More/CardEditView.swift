import SwiftUI

/// Editing a card after setup: when its limits reset, and the anniversary that
/// card-year and card-quarter limits count from.
///
/// Sends the whole card every time (see `CardUpdate`), so a cleared anniversary
/// goes out as an explicit null. The backend refuses to clear it while a limit
/// still counts from it, and that explanation is shown as-is.
struct CardEditView: View {
    let card: CardResponse
    let onSaved: (CardResponse) async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var cycleBasis: CycleBasis
    @State private var statementDay: Int
    @State private var hasAnniversary: Bool
    @State private var anniversary: Date
    @State private var isSaving = false
    @State private var errorMessage: String?

    init(card: CardResponse, onSaved: @escaping (CardResponse) async -> Void) {
        self.card = card
        self.onSaved = onSaved
        _cycleBasis = State(initialValue: card.cycleBasis)
        _statementDay = State(initialValue: card.statementDay)
        _hasAnniversary = State(initialValue: card.anniversaryDate != nil)
        _anniversary = State(initialValue: card.anniversaryDate ?? Date())
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Limits reset on", selection: $cycleBasis) {
                        Text("The statement cycle").tag(CycleBasis.statement)
                        Text("The calendar month").tag(CycleBasis.calendar)
                    }
                    if cycleBasis == .statement {
                        Stepper("Closes on day \(statementDay)", value: $statementDay, in: 1...31)
                    }
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
                    Text("Limits that reset each card year or card quarter count from this date.")
                }

                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Edit card")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }.disabled(isSaving)
                }
            }
            .discardGuard(fields: [cycleBasis, statementDay, hasAnniversary, anniversary])
        }
    }

    private func save() {
        isSaving = true
        errorMessage = nil
        Task {
            defer { isSaving = false }
            do {
                let updated: CardResponse = try await APIClient.shared.put(
                    "/cards/\(card.id)",
                    body: CardUpdate(
                        cycleBasis: cycleBasis.rawValue,
                        statementDay: statementDay,
                        anniversaryDate: hasAnniversary ? anniversary.apiDateOnly : nil
                    )
                )
                await onSaved(updated)
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}
