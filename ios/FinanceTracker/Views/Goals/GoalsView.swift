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

/// Create a sub-portfolio, or edit an existing one's name/target/ownership.
/// A goal *is* a sub-portfolio, so this is both "New Goal" (Portfolio ▸ +) and the
/// editor reached from GoalDetailView's ⋯ menu.
struct GoalFormView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(SessionStore.self) private var session

    /// nil = create a new sub-portfolio in `householdId`.
    let existing: SubPortfolioResponse?
    let householdId: String
    let onSaved: () async -> Void

    @State private var name: String
    @State private var riskProfile: String
    @State private var targetAmountText: String
    @State private var hasTargetDate: Bool
    @State private var targetDate: Date
    @State private var isPrivate: Bool
    @State private var didSeedPrivacy: Bool
    @State private var isSaving = false
    @State private var errorMessage: String?

    private static let riskProfiles = ["Conservative", "Moderate", "Aggressive"]

    init(existing: SubPortfolioResponse, onSaved: @escaping () async -> Void) {
        self.init(existing: existing, householdId: existing.householdId, onSaved: onSaved)
    }

    init(householdId: String, onSaved: @escaping () async -> Void) {
        self.init(existing: nil, householdId: householdId, onSaved: onSaved)
    }

    private init(
        existing: SubPortfolioResponse?,
        householdId: String,
        onSaved: @escaping () async -> Void
    ) {
        self.existing = existing
        self.householdId = householdId
        self.onSaved = onSaved
        _name = State(initialValue: existing?.name ?? "")
        _riskProfile = State(initialValue: existing?.riskProfile ?? "Moderate")
        _targetAmountText = State(initialValue: existing?.targetAmount.map {
            $0 == $0.rounded() ? String(Int($0)) : String($0)
        } ?? "")
        _hasTargetDate = State(initialValue: existing?.targetDate != nil)
        _targetDate = State(initialValue: existing?.targetDate ?? Date())
        _isPrivate = State(initialValue: existing?.ownerUserId != nil)
        // On create, seed from the user's "default new items private" preference in
        // onAppear — SessionStore isn't reachable from init.
        _didSeedPrivacy = State(initialValue: existing != nil)
    }

    private var targetAmount: Double? {
        CalculatorInput.evaluateArithmeticExpression(targetAmountText)
    }

    private var canSave: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty && !isSaving
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name (e.g. House Downpayment)", text: $name)
                    Picker("Risk Profile", selection: $riskProfile) {
                        ForEach(Self.riskProfiles, id: \.self) { Text($0).tag($0) }
                    }
                }

                Section {
                    HStack {
                        Text("Target Amount")
                        CalculatorField(placeholder: "Optional", text: $targetAmountText)
                            .multilineTextAlignment(.trailing)
                    }
                    Toggle("Target Date", isOn: $hasTargetDate.animation())
                    if hasTargetDate {
                        DatePicker("Reach by", selection: $targetDate, displayedComponents: .date)
                    }
                } footer: {
                    Text("A sub-portfolio with a target becomes a goal — progress is tracked against it in the Portfolio tab.")
                }

                Section {
                    Toggle("Private to me", isOn: $isPrivate)
                } footer: {
                    Text("Private goals and their holdings are visible only to you, not other household members.")
                }

                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle(existing == nil ? "New Goal" : "Edit Goal")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(existing == nil ? "Create" : "Save") { save() }
                        .disabled(!canSave)
                }
            }
            .discardGuard(
                fields: [name, riskProfile, targetAmountText, hasTargetDate, targetDate, isPrivate],
                // `onAppear` below fills in the private-by-default toggle for a new goal;
                // that isn't an edit the user made.
                settled: didSeedPrivacy
            )
            .onAppear {
                guard !didSeedPrivacy else { return }
                isPrivate = session.user?.defaultsNewItemsPrivate ?? false
                didSeedPrivacy = true
            }
        }
    }

    private func save() {
        guard canSave else { return }
        isSaving = true
        errorMessage = nil
        let cleanName = name.trimmingCharacters(in: .whitespaces)
        let owner = isPrivate ? session.user?.id : nil
        let date = hasTargetDate ? targetDate.apiDateOnly : nil
        Task {
            defer { isSaving = false }
            do {
                if let existing {
                    let _: SubPortfolioResponse = try await APIClient.shared.patch(
                        "/portfolio/subportfolios/\(existing.id)",
                        body: SubPortfolioUpdate(
                            name: cleanName,
                            targetAmount: targetAmount,
                            targetDate: date,
                            // Only send ownership when it actually changed, so an
                            // untouched toggle can't clear someone else's owner id.
                            ownerUserId: owner == existing.ownerUserId ? .unchanged : .set(owner)
                        )
                    )
                } else {
                    let _: SubPortfolioResponse = try await APIClient.shared.post(
                        "/portfolio/subportfolios",
                        body: SubPortfolioCreate(
                            householdId: householdId,
                            name: cleanName,
                            riskProfile: riskProfile,
                            targetAmount: targetAmount,
                            targetDate: date,
                            ownerUserId: owner
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
