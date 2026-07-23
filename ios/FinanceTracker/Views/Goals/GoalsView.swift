import SwiftUI

// Goals are sub-portfolios with a target amount/date. They no longer have their own
// tab — progress is shown per sub-portfolio inside the Portfolio tab. This file holds
// the reusable goal-progress row and the target editor used from there.

/// Compact goal progress for a sub-portfolio: target, progress bar, and remaining.
/// The sub-portfolio's name and value are shown by the surrounding section header,
/// so this row deliberately omits them.
struct GoalProgressRow: View {
    let currentValue: Double
    let targetAmount: Double?
    let targetDate: Date?
    let accent: Color
    let baseCurrency: String

    private var progress: Double {
        guard let targetAmount, targetAmount > 0 else { return 0 }
        return currentValue / targetAmount
    }

    var body: some View {
        if let targetAmount {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 4) {
                    Text("Goal \(targetAmount.compactCurrency(baseCurrency))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if let targetDate {
                        Text("· by \(targetDate.formatted(.dateTime.month(.abbreviated).year()))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text("\(Int((progress * 100).rounded()))%")
                        .font(.caption.bold().monospacedDigit())
                        .foregroundStyle(accent)
                }
                ProgressView(value: min(1, max(0, progress)))
                    .tint(accent)
                HStack {
                    Spacer()
                    if targetAmount > currentValue {
                        Text("\((targetAmount - currentValue).compactCurrency(baseCurrency)) to go")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    } else {
                        Text("Reached 🎉")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .padding(.vertical, 2)
        } else {
            Label("Set a goal target", systemImage: "target")
                .font(.subheadline)
                .foregroundStyle(accent)
        }
    }
}

/// Set a goal's name and target amount/date on its sub-portfolio.
struct GoalTargetEditView: View {
    @Environment(\.dismiss) private var dismiss

    let subPortfolio: SubPortfolioResponse
    let onSaved: () async -> Void

    @State private var name: String
    @State private var targetAmountText: String
    @State private var hasTargetDate: Bool
    @State private var targetDate: Date
    @State private var isSaving = false
    @State private var errorMessage: String?

    init(subPortfolio: SubPortfolioResponse, onSaved: @escaping () async -> Void) {
        self.subPortfolio = subPortfolio
        self.onSaved = onSaved
        _name = State(initialValue: subPortfolio.name)
        _targetAmountText = State(initialValue: subPortfolio.targetAmount.map {
            $0 == $0.rounded() ? String(Int($0)) : String($0)
        } ?? "")
        _hasTargetDate = State(initialValue: subPortfolio.targetDate != nil)
        _targetDate = State(initialValue: subPortfolio.targetDate ?? Date())
    }

    private var targetAmount: Double? {
        Double(targetAmountText.replacingOccurrences(of: ",", with: ""))
    }

    private var canSave: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty && !isSaving
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $name)
                }

                Section {
                    HStack {
                        Text("Target Amount")
                        TextField("Optional", text: $targetAmountText)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                    }
                    Toggle("Target Date", isOn: $hasTargetDate.animation())
                    if hasTargetDate {
                        DatePicker("Reach by", selection: $targetDate, displayedComponents: .date)
                    }
                } footer: {
                    Text("Progress is tracked against this target in the Portfolio tab.")
                }

                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Edit Goal")
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
        let cleanName = name.trimmingCharacters(in: .whitespaces)
        Task {
            defer { isSaving = false }
            do {
                let _: SubPortfolioResponse = try await APIClient.shared.patch(
                    "/portfolio/subportfolios/\(subPortfolio.id)",
                    body: SubPortfolioUpdate(
                        name: cleanName,
                        targetAmount: targetAmount,
                        targetDate: hasTargetDate ? targetDate.apiDateOnly : nil
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
