import SwiftUI

/// One person's share of a bill, as the form holds it while being edited.
///
/// Internal rather than private: the transaction form and Quick Add both edit
/// splits, and they must agree about what a half-filled row means.
struct SplitRow: Identifiable, Hashable {
    let id = UUID()
    var counterpartyId: String?
    var amountText: String = ""

    init(counterpartyId: String? = nil, amountText: String = "") {
        self.counterpartyId = counterpartyId
        self.amountText = amountText
    }
}

/// The pure half of splitting a bill: reading rows, judging them, and turning
/// them into what goes on the wire.
///
/// Split from the view so Quick Add can reach the same answers without copying
/// them. The maths itself lives further down still, in `Support/Reimbursements`,
/// which is the module web and Android port.
enum TransactionSplits {

    /// Rows with a person picked. A row with nobody selected yet is left out
    /// rather than counted as incomplete — matching the web's `splitHint`,
    /// which filters to `r => r.counterpartyId` first.
    static func entries(_ rows: [SplitRow]) -> [SplitEntry] {
        rows.compactMap { row in
            guard let counterpartyId = row.counterpartyId else { return nil }
            return SplitEntry(
                counterpartyId: counterpartyId,
                amount: Reimbursements.parseMoney(row.amountText)
            )
        }
    }

    static func assessment(amount: Double?, rows: [SplitRow]) -> SplitAssessment {
        Reimbursements.assessSplit(amount: amount, entries: entries(rows))
    }

    /// The sentence under the split fields. It restates the split as the two
    /// numbers the user actually cares about, because "they owe 180 combined"
    /// on a 300 bill is only meaningful once you can see that leaves you 120.
    static func hint(amount: Double?, rows: [SplitRow], currency: String) -> String {
        switch assessment(amount: amount, rows: rows) {
        case .incomplete:
            return "The full amount still leaves your account — only your share counts towards budgets."
        case let .invalid(reason):
            return reason
        case let .valid(yourShare, owed):
            let who = entries(rows).count > 1 ? "They owe you (combined)" : "They owe you"
            return "Your share: \(yourShare.currency(currency)). \(who) \(owed.currency(currency))."
        }
    }

    /// A split switched on but not yet complete blocks saving rather than being
    /// silently dropped — the user asked for it and would not notice it going.
    static func isUsable(isSplitting: Bool, amount: Double?, rows: [SplitRow]) -> Bool {
        guard isSplitting else { return true }
        if case .valid = assessment(amount: amount, rows: rows) { return true }
        return false
    }

    /// The completed rows, ready for the wire. Only meaningful once the
    /// assessment says valid, which guarantees a counterparty and a positive
    /// amount on every entry.
    static func inputs(_ rows: [SplitRow]) -> [TransactionSplitInput] {
        rows.compactMap { row in
            guard let counterpartyId = row.counterpartyId,
                  let amount = Reimbursements.parseMoney(row.amountText)
            else { return nil }
            return TransactionSplitInput(counterpartyId: counterpartyId, amount: amount)
        }
    }

    /// What a *new* transaction should send: nil when there's no split at all.
    static func forCreate(isSplitting: Bool, amount: Double?, rows: [SplitRow]) -> [TransactionSplitInput]? {
        guard isSplitting, case .valid = assessment(amount: amount, rows: rows) else { return nil }
        return inputs(rows)
    }

    /// Fills every blank-amount row by dividing what's left of the bill evenly
    /// across them, after subtracting whatever the other rows already specify.
    static func fillRemainderEvenly(amount: Double?, rows: inout [SplitRow]) {
        let blankIndices = rows.indices.filter {
            rows[$0].amountText.trimmingCharacters(in: .whitespaces).isEmpty
        }
        guard !blankIndices.isEmpty else { return }
        let specified = rows
            .filter { !$0.amountText.trimmingCharacters(in: .whitespaces).isEmpty }
            .compactMap { Reimbursements.parseMoney($0.amountText) }
        guard let share = Reimbursements.evenSplitRemainder(
            amount: amount ?? 0, specified: specified, remainingCount: blankIndices.count
        ) else { return }
        for index in blankIndices {
            rows[index].amountText = String(format: "%.2f", share)
        }
    }
}

/// Splitting a bill, as a form section.
///
/// The amount above it is untouched: the whole sum really did leave the
/// account. This only records how much of it was somebody else's, so the budget
/// charges you for your share and the rest becomes a debt they owe you.
struct TransactionSplitSection: View {
    @Environment(SessionStore.self) private var session

    let amount: Double?
    let householdId: String
    @Binding var isSplitting: Bool
    @Binding var splitRows: [SplitRow]
    @Binding var counterparties: [Counterparty]

    @State private var isCreatingCounterparty = false
    @State private var newCounterpartyName = ""
    @State private var isSavingCounterparty = false
    @State private var errorMessage: String?

    private var currency: String { session.activeHousehold?.baseCurrency ?? "USD" }

    /// Everyone already chosen in another row is excluded, so the same person
    /// can't be picked twice.
    private func pickable(for rowId: UUID) -> [Counterparty] {
        let pickedElsewhere = Set(splitRows.filter { $0.id != rowId }.compactMap(\.counterpartyId))
        return counterparties.filter { !pickedElsewhere.contains($0.id) }
    }

    var body: some View {
        Section {
            Toggle("Someone owes me for part of this", isOn: $isSplitting.animation())
            if isSplitting {
                ForEach($splitRows) { $row in
                    HStack(spacing: 8) {
                        Picker("Who", selection: $row.counterpartyId) {
                            Text("Select person").tag(String?.none)
                            ForEach(pickable(for: row.id)) { cp in
                                Text(cp.name).tag(String?.some(cp.id))
                            }
                        }
                        .labelsHidden()
                        CalculatorField(placeholder: "0.00", text: $row.amountText)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 70)
                        Button {
                            splitRows.removeAll { $0.id == row.id }
                        } label: {
                            Image(systemName: "minus.circle.fill")
                                .foregroundStyle(.red)
                        }
                        .buttonStyle(.borderless)
                    }
                }

                Button {
                    splitRows.append(SplitRow())
                } label: {
                    Label("Add Person", systemImage: "person.badge.plus")
                }

                Button {
                    isCreatingCounterparty.toggle()
                } label: {
                    Label(
                        isCreatingCounterparty ? "Cancel New Person" : "New Person",
                        systemImage: "plus.circle"
                    )
                }

                if isCreatingCounterparty {
                    HStack {
                        TextField("e.g. Alice", text: $newCounterpartyName)
                            .textInputAutocapitalization(.words)
                        Button {
                            Task { await createCounterparty() }
                        } label: {
                            if isSavingCounterparty { ProgressView() } else { Text("Add") }
                        }
                        .disabled(
                            newCounterpartyName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                || isSavingCounterparty
                        )
                    }
                }

                if splitRows.count > 1 {
                    Button("Split Remainder Evenly") {
                        TransactionSplits.fillRemainderEvenly(amount: amount, rows: &splitRows)
                    }
                }

                if let errorMessage {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }
        } footer: {
            if isSplitting {
                Text(TransactionSplits.hint(amount: amount, rows: splitRows, currency: currency))
                    .foregroundStyle(
                        TransactionSplits.assessment(amount: amount, rows: splitRows).isInvalid
                            ? .red : .secondary
                    )
            }
        }
    }

    /// Adds a new reusable person and appends them as a new, blank split row —
    /// there's no single row to fill in until at least one exists.
    private func createCounterparty() async {
        let name = newCounterpartyName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        isSavingCounterparty = true
        defer { isSavingCounterparty = false }
        do {
            let created: Counterparty = try await APIClient.shared.post(
                "/cashflow/counterparties",
                body: CounterpartyCreate(householdId: householdId, name: name)
            )
            counterparties.append(created)
            counterparties.sort { $0.name < $1.name }
            splitRows.append(SplitRow(counterpartyId: created.id))
            newCounterpartyName = ""
            isCreatingCounterparty = false
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
