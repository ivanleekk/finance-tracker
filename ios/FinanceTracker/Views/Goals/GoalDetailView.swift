import SwiftUI
import Charts

/// A fleshed-out goal (sub-portfolio) detail page — the native counterpart of the web
/// `/goals/:id` screen. Reached by tapping a goal's progress row in the Portfolio tab.
/// Shows funding progress, a projected-completion chart, which accounts (and members)
/// funded it, and recent contributions; supports editing, deleting, and adding funds.
struct GoalDetailView: View {
    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss

    let goal: SubPortfolioResponse
    /// Let the parent (Portfolio) refresh after edits/deletes/contributions here.
    var onChanged: () async -> Void = {}

    @State private var goalState: SubPortfolioResponse
    /// Pre-aggregated (date, sub-portfolio) totals — goal history only ever needs this
    /// sub-portfolio's per-date total, never per-asset detail.
    @State private var timeseries: [PortfolioTimeseriesPoint] = []
    @State private var trades: [TradeResponse] = []
    @State private var accounts: [AccountResponse] = []
    @State private var assets: [AssetResponse] = []
    @State private var members: [HouseholdMemberUserResponse] = []
    @State private var isLoading = true
    @State private var isEditing = false
    @State private var isAddingFunds = false
    @State private var confirmingDelete = false
    @State private var errorMessage: String?

    init(goal: SubPortfolioResponse, onChanged: @escaping () async -> Void = {}) {
        self.goal = goal
        self.onChanged = onChanged
        _goalState = State(initialValue: goal)
    }

    private var baseCurrency: String { session.activeHousehold?.baseCurrency ?? "USD" }
    private var accent: Color { session.theme.secondary.accent }

    private var accountsById: [String: AccountResponse] {
        Dictionary(uniqueKeysWithValues: accounts.map { ($0.id, $0) })
    }

    private var history: [GoalHistoryPoint] {
        valueHistory(for: timeseries, subPortfolioId: goalState.id)
    }

    private var proj: GoalProjection {
        projectGoal(history: history, targetAmount: goalState.targetAmount, targetDate: goalState.targetDate)
    }

    /// Trades into this goal that were funded from a real account. Cash-settlement legs
    /// (no account) are internal reshuffles, not contributions, so they're excluded to
    /// avoid double-counting the money that was already deposited from an account.
    private var contributingTrades: [TradeResponse] {
        trades.filter { $0.subPortfolioId == goalState.id && $0.accountId != nil }
    }

    private func signedAmount(_ t: TradeResponse) -> Double {
        t.quantity * t.price * t.exchangeRate * (t.type == .sell ? -1 : 1)
    }

    private func accountName(_ id: String?) -> String {
        id.flatMap { accountsById[$0]?.name } ?? "Unknown account"
    }

    private struct FundedRow: Identifiable { let id: String; let name: String; let total: Double }

    private var fundedFrom: [FundedRow] {
        var byAccount: [String: Double] = [:]
        for t in contributingTrades {
            guard let accountId = t.accountId else { continue }
            byAccount[accountId, default: 0] += signedAmount(t)
        }
        return byAccount
            .map { FundedRow(id: $0.key, name: accountName($0.key), total: $0.value) }
            .filter { $0.total > 0 }
            .sorted { $0.total > $1.total }
    }

    private struct MemberContribution: Identifiable { let id: String; let name: String; let total: Double }

    private var contributionsByMember: (items: [MemberContribution], max: Double) {
        var byOwner: [String: Double] = [:]
        for t in contributingTrades {
            let ownerKey = (t.accountId.flatMap { accountsById[$0]?.ownerUserId }) ?? "shared"
            byOwner[ownerKey, default: 0] += signedAmount(t)
        }
        let memberName = Dictionary(members.map { ($0.userId, $0.name) }, uniquingKeysWith: { a, _ in a })
        let items = byOwner
            .map { MemberContribution(id: $0.key, name: $0.key == "shared" ? "Shared accounts" : (memberName[$0.key] ?? "Member"), total: $0.value) }
            .filter { $0.total > 0 }
            .sorted { $0.total > $1.total }
        return (items, max(1, items.map(\.total).max() ?? 1))
    }

    private struct ContributionRow: Identifiable { let id: String; let date: Date; let accountName: String; let amount: Double; let type: TradeType }

    private var recentContributions: [ContributionRow] {
        contributingTrades
            .sorted { $0.date > $1.date }
            .prefix(8)
            .map { ContributionRow(id: $0.id, date: $0.date, accountName: accountName($0.accountId), amount: signedAmount($0), type: $0.type) }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                summaryCard
                projectionCard
                fundedFromCard
                recentContributionsCard
            }
            .padding(16)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(goalState.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button { isAddingFunds = true } label: { Label("Add Funds", systemImage: "plus.circle") }
                    Button { isEditing = true } label: { Label("Edit Goal", systemImage: "pencil") }
                    Button(role: .destructive) { confirmingDelete = true } label: { Label("Delete Goal", systemImage: "trash") }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .sheet(isPresented: $isEditing) {
            GoalFormView(existing: goalState) { await reload() }
        }
        .sheet(isPresented: $isAddingFunds) {
            if let household = session.activeHousehold {
                // Restrict the sub-portfolio picker to this goal so the trade lands here.
                TradeFormView(
                    householdId: household.id,
                    subPortfolios: [goalState],
                    assets: assets,
                    accounts: accounts
                ) {
                    await reload()
                }
            }
        }
        .confirmationDialog("Delete this goal?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Delete Goal", role: .destructive) { delete() }
        } message: {
            Text("Goals with trades or funding activity can't be deleted.")
        }
        .overlay {
            if isLoading && timeseries.isEmpty && trades.isEmpty {
                LoadingSkeleton(showsHeader: true)
            }
        }
        .task { await reload() }
        .alert("Error", isPresented: .init(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage ?? "")
        }
    }

    // MARK: - Summary (ring + stats)

    private var summaryCard: some View {
        DetailCard {
            VStack(spacing: 16) {
                ZStack {
                    Circle().stroke(accent.opacity(0.15), lineWidth: 12)
                    Circle()
                        .trim(from: 0, to: min(1, max(0, proj.percentComplete / 100)))
                        .stroke(accent, style: StrokeStyle(lineWidth: 12, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                    VStack(spacing: 0) {
                        Text("\(Int(proj.percentComplete.rounded()))%")
                            .font(.system(.title, design: .rounded, weight: .bold))
                            .foregroundStyle(accent)
                        Text("FUNDED")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                }
                .frame(width: 140, height: 140)
                .animation(.easeInOut, value: proj.percentComplete)

                VStack(spacing: 2) {
                    Text(proj.currentValue.currencyWhole(baseCurrency))
                        .font(.system(.title2, design: .rounded, weight: .bold))
                    Text("of \(goalState.targetAmount.map { $0.currencyWhole(baseCurrency) } ?? "no target set")")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                Divider()

                HStack(alignment: .top, spacing: 12) {
                    GoalStat(title: "Remaining", value: proj.remaining.currencyWhole(baseCurrency))
                    GoalStat(title: "Per month", value: proj.monthlyPace > 0 ? proj.monthlyPace.currencyWhole(baseCurrency) : "—", tint: accent)
                    GoalStat(title: "ETA", value: proj.etaLabel ?? "—", tint: .green)
                }

                if let targetDate = goalState.targetDate {
                    Divider()
                    HStack(alignment: .top, spacing: 12) {
                        GoalStat(title: "Due", value: targetDate.dueMonthYear)
                        GoalStat(
                            title: "Needed / mo",
                            value: (proj.requiredPace.map { $0 > 0 ? $0.currencyWhole(baseCurrency) : "—" }) ?? "—",
                            tint: accent
                        )
                        GoalStat(
                            title: proj.shortfallAtTarget.map { $0 > 0 ? "Shortfall" : "On target" } ?? "On target",
                            value: proj.shortfallAtTarget.map { $0 > 0 ? $0.currencyWhole(baseCurrency) : "✓" } ?? "—",
                            tint: (proj.shortfallAtTarget ?? 0) > 0 ? .orange : .green
                        )
                    }
                }
            }
            .frame(maxWidth: .infinity)
        }
    }

    // MARK: - Projected completion

    private var projectionNarrative: String {
        var text: String
        if proj.monthlyPace > 0, let eta = proj.etaLabel {
            let targetStr = goalState.targetAmount.map { $0.currencyWhole(baseCurrency) } ?? "your target"
            text = "At \(proj.monthlyPace.currencyWhole(baseCurrency))/mo you reach \(targetStr) by \(eta)."
        } else {
            text = "Not enough contribution history yet to project a completion date."
        }
        if let months = proj.etaVsTargetMonths, let targetDate = goalState.targetDate {
            let due = targetDate.dueMonthYear
            if months > 0 {
                let paceClause = proj.requiredPace.map { " — you'd need \($0.currencyWhole(baseCurrency))/mo to land on time" } ?? ""
                text += " That's ~\(months) month\(months == 1 ? "" : "s") past your \(due) target\(paceClause)."
            } else if months < 0 {
                text += " That's ~\(-months) month\(months == -1 ? "" : "s") ahead of your \(due) target."
            } else {
                text += " That lands right on your \(due) target."
            }
        }
        return text
    }

    private var projectionCard: some View {
        DetailCard(title: "Projected completion") {
            if let onTrack = proj.onTrack {
                StatusPill(text: onTrack ? "ON TRACK" : "BEHIND PACE", color: onTrack ? .green : .orange)
            }
        } content: {
            Text(projectionNarrative)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            if history.count > 1 {
                Chart {
                    ForEach(history) { point in
                        AreaMark(x: .value("Date", point.date), y: .value("Value", point.value))
                            .foregroundStyle(ChartStyle.accentFill(accent))
                            .interpolationMethod(.monotone)
                        LineMark(x: .value("Date", point.date), y: .value("Value", point.value))
                            .foregroundStyle(accent)
                            .lineStyle(StrokeStyle(lineWidth: ChartStyle.lineWidth, lineCap: .round, lineJoin: .round))
                            .interpolationMethod(.monotone)
                    }
                    if let target = goalState.targetAmount {
                        RuleMark(y: .value("Target", target))
                            .foregroundStyle(accent.opacity(0.6))
                            .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
                            .annotation(position: .top, alignment: .leading) {
                                Text("target").font(.caption2).foregroundStyle(accent)
                            }
                    }
                }
                .financeChartAxes(currency: baseCurrency, showsXAxis: false)
                .adaptiveChartHeight(compact: 160, regular: 260)
            }
        }
    }

    // MARK: - Funded from

    private var fundedFromCard: some View {
        DetailCard(title: "Funded from") {
            Text("Accounts that have contributed to this goal via trades.")
                .font(.caption)
                .foregroundStyle(.secondary)

            if fundedFrom.isEmpty {
                Text("No funding activity yet.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 8)
            } else {
                ForEach(fundedFrom) { row in
                    HStack {
                        Text(row.name).font(.subheadline.weight(.medium))
                        Spacer()
                        Text(row.total.currencyWhole(baseCurrency))
                            .font(.subheadline.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 2)
                }
            }

            let byMember = contributionsByMember
            if members.count > 1 && !byMember.items.isEmpty {
                Divider()
                Text("Contributions by member")
                    .font(.subheadline.weight(.semibold))
                ForEach(Array(byMember.items.enumerated()), id: \.element.id) { index, member in
                    let color = index % 2 == 0 ? session.theme.primary.accent : session.theme.secondary.accent
                    HStack(spacing: 10) {
                        Circle().fill(color).frame(width: 20, height: 20)
                        Text(member.name).font(.subheadline).lineLimit(1)
                        Spacer(minLength: 8)
                        ProgressView(value: member.total / byMember.max)
                            .tint(color)
                            .frame(width: 80)
                        Text(member.total.currencyWhole(baseCurrency))
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    // MARK: - Recent contributions

    private var recentContributionsCard: some View {
        DetailCard(title: "Recent contributions") {
            if recentContributions.isEmpty {
                Text("No contributions yet.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 8)
            } else {
                ForEach(recentContributions) { c in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(c.accountName).font(.subheadline.weight(.medium))
                            Text("\(c.date.formatted(date: .abbreviated, time: .omitted)) · \(c.type.label.lowercased())")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text((c.amount >= 0 ? "+" : "") + c.amount.currencyWhole(baseCurrency))
                            .font(.subheadline.monospacedDigit().weight(.semibold))
                            .foregroundStyle(c.amount >= 0 ? .green : .red)
                    }
                    .padding(.vertical, 2)
                }
            }
        }
    }

    // MARK: - Data

    private func reload() async {
        guard let household = session.activeHousehold else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            async let goalReq: SubPortfolioResponse = APIClient.shared.get("/portfolio/subportfolios/\(goalState.id)")
            async let timeseriesReq: [PortfolioTimeseriesPoint] = APIClient.shared.get("/portfolio/snapshots/household/\(household.id)/timeseries")
            async let tradesReq: [TradeResponse] = APIClient.shared.get("/portfolio/trades/household/\(household.id)")
            async let accountsReq: [AccountResponse] = APIClient.shared.get("/accounts/household/\(household.id)")
            async let assetsReq: [AssetResponse] = APIClient.shared.get("/portfolio/assets")
            async let membersReq: [HouseholdMemberUserResponse] = APIClient.shared.get("/users/householdmember/\(household.id)")
            (goalState, timeseries, trades, accounts, assets, members) =
                try await (goalReq, timeseriesReq, tradesReq, accountsReq, assetsReq, membersReq)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func delete() {
        Task {
            do {
                try await APIClient.shared.delete("/portfolio/subportfolios/\(goalState.id)")
                await onChanged()
                dismiss()
            } catch {
                errorMessage = "Couldn't delete this goal. Goals with trades or funding activity can't be deleted."
            }
        }
    }
}

// MARK: - Building blocks

/// A rounded card used throughout the goal detail page. Optional title with a trailing
/// accessory (e.g. a status pill).
struct DetailCard<Accessory: View, Content: View>: View {
    var title: String?
    @ViewBuilder var accessory: () -> Accessory
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let title {
                HStack {
                    Text(title).font(.headline)
                    Spacer()
                    accessory()
                }
            }
            content()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color(.secondarySystemGroupedBackground)))
    }
}

extension DetailCard where Accessory == EmptyView {
    init(title: String? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.init(title: title, accessory: { EmptyView() }, content: content)
    }
}

/// One labelled figure in the goal summary's stat rows.
struct GoalStat: View {
    let title: String
    let value: String
    var tint: Color = .primary

    var body: some View {
        VStack(spacing: 3) {
            Text(title.uppercased())
                .font(.caption2.weight(.medium))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Text(value)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(tint)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity)
    }
}

/// Small uppercase status pill (ON TRACK / BEHIND PACE).
struct StatusPill: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text)
            .font(.caption2.weight(.bold))
            .foregroundStyle(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Capsule().fill(color.opacity(0.15)))
    }
}
