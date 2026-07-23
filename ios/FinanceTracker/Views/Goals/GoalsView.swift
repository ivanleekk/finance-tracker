import SwiftUI

/// Life-milestone goals. A "goal" is a sub-portfolio with a target amount/date; progress
/// is its latest-snapshot value against that target. Targets are editable here.
struct GoalsView: View {
    @Environment(SessionStore.self) private var session

    @State private var subPortfolios: [SubPortfolioResponse] = []
    @State private var snapshots: [PortfolioSnapshotResponse] = []
    @State private var isLoading = true
    @State private var editing: SubPortfolioResponse?
    @State private var errorMessage: String?

    private var baseCurrency: String { session.activeHousehold?.baseCurrency ?? "USD" }

    /// Holdings on the most recent snapshot date only.
    private var latestHoldings: [PortfolioSnapshotResponse] {
        guard let latest = snapshots.map(\.date).max() else { return [] }
        return snapshots.filter { $0.date == latest }
    }

    private func currentValue(of subPortfolioId: String) -> Double {
        latestHoldings
            .filter { $0.subPortfolioId == subPortfolioId }
            .reduce(0) { $0 + $1.currentValueHomeCurrency }
    }

    /// Sub-portfolios that are goals: they have a target, or already hold value.
    private var goals: [SubPortfolioResponse] {
        subPortfolios
            .filter { $0.targetAmount != nil || currentValue(of: $0.id) > 0 }
            .sorted { ($0.targetDate ?? .distantFuture) < ($1.targetDate ?? .distantFuture) }
    }

    var body: some View {
        NavigationStack {
            List {
                ForEach(goals) { goal in
                    Section {
                        GoalCard(
                            goal: goal,
                            currentValue: currentValue(of: goal.id),
                            baseCurrency: baseCurrency,
                            accent: session.theme.primary.accent
                        )
                        .contentShape(Rectangle())
                        .onTapGesture { editing = goal }
                    }
                }
            }
            .navigationTitle("Goals")
            .overlay {
                if isLoading && subPortfolios.isEmpty {
                    ProgressView()
                } else if !isLoading && goals.isEmpty {
                    ContentUnavailableView(
                        "No Goals Yet",
                        systemImage: "target",
                        description: Text("Create a sub-portfolio when you log a trade, then tap a goal here to set its target.")
                    )
                }
            }
            .sheet(item: $editing) { goal in
                GoalTargetEditView(subPortfolio: goal) { await load() }
            }
            .refreshable { await load() }
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
    }

    private func load() async {
        guard let household = session.activeHousehold else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            async let subsReq: [SubPortfolioResponse] = APIClient.shared.get("/portfolio/subportfolios/household/\(household.id)")
            async let snapsReq: [PortfolioSnapshotResponse] = APIClient.shared.get("/portfolio/snapshots/household/\(household.id)")
            (subPortfolios, snapshots) = try await (subsReq, snapsReq)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct GoalCard: View {
    let goal: SubPortfolioResponse
    let currentValue: Double
    let baseCurrency: String
    let accent: Color

    private var progress: Double? {
        guard let target = goal.targetAmount, target > 0 else { return nil }
        return currentValue / target
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(goal.name)
                    .font(.headline)
                if goal.ownerUserId != nil {
                    Image(systemName: "lock.fill")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if let targetDate = goal.targetDate {
                    Text("by \(targetDate.formatted(.dateTime.month(.abbreviated).year()))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(currentValue.currency(baseCurrency))
                    .font(.title3.weight(.semibold).monospacedDigit())
                if let target = goal.targetAmount {
                    Text("/ \(target.compactCurrency(baseCurrency))")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }

            if let progress {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color(.systemGray5))
                        Capsule()
                            .fill(accent)
                            .frame(width: geo.size.width * min(1, max(0, progress)))
                    }
                }
                .frame(height: 8)

                HStack {
                    Text("\(Int((progress * 100).rounded()))%")
                        .foregroundStyle(accent)
                    Spacer()
                    if let target = goal.targetAmount, target > currentValue {
                        Text("\((target - currentValue).compactCurrency(baseCurrency)) to go")
                            .foregroundStyle(.secondary)
                    } else {
                        Text("Reached 🎉").foregroundStyle(.secondary)
                    }
                }
                .font(.caption.monospacedDigit())
            } else {
                Text("Tap to set a target")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 6)
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
                    Text("Progress is tracked against this target on the Goals tab.")
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
                        targetDate: hasTargetDate ? targetDate : nil
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
