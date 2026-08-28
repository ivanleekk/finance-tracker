import SwiftUI

/// Per-card spend limits — the reviewing surface.
///
/// The number that actually changes a decision lives in the transaction form's
/// card-category picker, not here: a meter you have to go and look at will not
/// stop anyone overspending. This screen is for setting the limits up and for
/// looking back over the cycle.
struct CardsView: View {
    @Environment(SessionStore.self) private var session

    @State private var cards: [CardResponse] = []
    @State private var statuses: [String: CardStatusResponse] = [:]
    @State private var availableAccounts: [AccountResponse] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var showingSetUp = false
    @State private var managing: CardResponse?

    var body: some View {
        List {
            if let errorMessage {
                Section {
                    Label(errorMessage, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.red)
                }
            }

            if cards.isEmpty && !isLoading {
                Section {
                    ContentUnavailableView(
                        "No cards set up",
                        systemImage: "creditcard",
                        description: Text(
                            availableAccounts.isEmpty
                                ? "Add a liability account first — a card's balance is money owed."
                                : "Set one up on a liability account to start metering its spending."
                        )
                    )
                }
            }

            ForEach(cards) { card in
                Section {
                    if let status = statuses[card.id] {
                        if status.limits.isEmpty {
                            Text("No limits yet. Add a cap or a minimum spend, and this card's spending will be measured against it.")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        ForEach(status.limits) { row in
                            CardLimitMeter(row: row, currency: card.currency ?? baseCurrency)
                        }
                        if !status.categories.isEmpty {
                            ForEach(status.categories) { spend in
                                LabeledContent(spend.name) {
                                    Text(spend.spent.currencyWhole(card.currency ?? baseCurrency))
                                        .monospacedDigit()
                                }
                                .font(.footnote)
                            }
                        }
                    } else {
                        ProgressView()
                    }

                    Button("Manage") { managing = card }
                        .font(.footnote)
                } header: {
                    HStack {
                        Text(card.accountName)
                        Spacer()
                        if let status = statuses[card.id] {
                            Text(Cards.cycleLabel(start: status.cycleStart, end: status.cycleEnd))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .navigationTitle("Cards")
        .toolbar {
            if !availableAccounts.isEmpty {
                ToolbarItem(placement: .primaryAction) {
                    Button { showingSetUp = true } label: { Image(systemName: "plus") }
                }
            }
        }
        .refreshable { await load() }
        .task { await load() }
        .sheet(isPresented: $showingSetUp) {
            CardSetUpView(accounts: availableAccounts) { await load() }
        }
        .sheet(item: $managing) { card in
            CardManageView(card: card) { await load() }
        }
    }

    private var baseCurrency: String { session.activeHousehold?.baseCurrency ?? "USD" }

    private func load() async {
        guard let householdId = session.activeHousehold?.id else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            async let cardsCall: [CardResponse] = APIClient.shared.get("/cards/household/\(householdId)")
            async let accountsCall: [AccountResponse] = APIClient.shared.get("/accounts/household/\(householdId)")
            let (loadedCards, accounts) = try await (cardsCall, accountsCall)

            cards = loadedCards
            let taken = Set(loadedCards.map(\.financialAccountId))
            availableAccounts = accounts.filter { $0.kind == "liability" && !taken.contains($0.id) }

            // One small aggregate per card, in parallel. A household has a
            // handful of cards rather than a list that grows.
            var loaded: [String: CardStatusResponse] = [:]
            try await withThrowingTaskGroup(of: (String, CardStatusResponse?).self) { group in
                for card in loadedCards {
                    group.addTask {
                        let status: CardStatusResponse? = try? await APIClient.shared.get(
                            "/cards/\(card.id)/status"
                        )
                        return (card.id, status)
                    }
                }
                for try await (id, status) in group {
                    if let status { loaded[id] = status }
                }
            }
            statuses = loaded
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// One limit and how the cycle is tracking against it.
///
/// The bar and the pace marker come from `BudgetPresentation` unchanged — a card
/// limit row is deliberately the same shape as a budget row.
struct CardLimitMeter: View {
    let row: CardLimitStatusRow
    let currency: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 6) {
                        Text(row.name).font(.subheadline.weight(.medium))
                        if row.direction == .floor {
                            Text("Minimum")
                                .font(.caption2)
                                .padding(.horizontal, 5)
                                .padding(.vertical, 1)
                                .background(Color.secondary.opacity(0.15), in: Capsule())
                        }
                    }
                    if !row.categoryNames.isEmpty {
                        Text(row.categoryNames.joined(separator: " · "))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 1) {
                    Text(Cards.headroomLabel(for: row) { $0.currencyWhole(currency) })
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(toneColor)
                        .monospacedDigit()
                    Text("\(row.spent.currencyWhole(currency)) of \(row.amount.currencyWhole(currency))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
            }

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.secondary.opacity(0.15))
                    Capsule()
                        .fill(toneColor)
                        .frame(width: geo.size.width * barFraction)
                    // Where the cycle is, so the bar can be read against the
                    // clock rather than in isolation.
                    Rectangle()
                        .fill(Color.primary.opacity(0.35))
                        .frame(width: 1)
                        .offset(x: geo.size.width * elapsedFraction)
                }
            }
            .frame(height: 6)

            if Cards.measuresNothing(row) {
                Text("No categories point at this limit yet, so it isn't measuring anything.")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }

            if Cards.tone(for: row) == .atRisk {
                Text(
                    row.direction == .floor
                        ? "On pace for \(row.projectedSpend.currencyWhole(currency)) — short of the minimum."
                        : "On pace for \(row.projectedSpend.currencyWhole(currency)) by the end of the cycle."
                )
                .font(.caption)
                .foregroundStyle(.orange)
            }
        }
        .padding(.vertical, 2)
    }

    /// Reuses the budget row's fractions — the shapes match by design.
    private var barFraction: Double {
        guard row.percentUsed.isFinite else { return 0 }
        return min(max(row.percentUsed / 100, 0), 1)
    }

    private var elapsedFraction: Double {
        guard row.daysTotal > 0 else { return 0 }
        return min(max(Double(row.daysElapsed) / Double(row.daysTotal), 0), 1)
    }

    private var toneColor: Color {
        switch Cards.tone(for: row) {
        case .over: return .red
        case .atRisk: return .orange
        case .ok: return .primary
        }
    }
}
