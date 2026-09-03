import Foundation

/// The plan half of the Cash Flow tab: budgets, card caps and what's scheduled.
///
/// The transactions list is the *record* — what happened. Budgets, card limits
/// and recurring rules are the *plan*, and they live on the same screen because
/// a cap only means anything read against the spending it constrains.
///
/// Everything here is pure and formatter-injected, the same shape `Cards` uses,
/// so the wording is testable without a view. `load` is the one exception, and
/// it sits here for the same reason `Cards.load` does: two screens need it (the
/// Cash Flow tab and the Dashboard's exception row) and they must not drift
/// into disagreeing about what needs attention.

/// One card limit, carrying the card it belongs to so a row can name it.
struct CardLimitSummary: Identifiable, Hashable {
    let cardName: String
    let currency: String
    let row: CardLimitStatusRow

    var id: String { row.limitId }
}

/// Something worth interrupting someone about, already worded.
struct AttentionItem: Identifiable, Hashable {
    enum Kind: String { case budget, card, recurring }
    /// `.over` has already happened; `.atRisk` is a projection. Only the first
    /// deserves red — warning in red about something that hasn't occurred yet
    /// trains people to ignore the colour.
    enum Tone: String { case over, atRisk }

    let id: String
    let kind: Kind
    let tone: Tone
    let title: String
    let detail: String
}

enum CashFlowSummary {

    // MARK: - Pure rules

    /// Active rules whose next occurrence has already come round — the nightly
    /// job hasn't run yet. Compared by day, not instant: a rule due today is due,
    /// regardless of what time it is now.
    static func dueNow(
        rules: [RecurringTransactionResponse],
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> [RecurringTransactionResponse] {
        let today = calendar.startOfDay(for: now)
        return rules.filter { $0.isActive && calendar.startOfDay(for: $0.nextDueDate) <= today }
    }

    /// Occurrences falling in the next `days` days, today included.
    ///
    /// The upcoming endpoint is asked for 90 days because the Recurring screen
    /// lists that far ahead; the summary row wants the near horizon, which is the
    /// part you can still do something about.
    static func upcomingWithin(
        _ occurrences: [UpcomingOccurrence],
        days: Int,
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> [UpcomingOccurrence] {
        let start = calendar.startOfDay(for: now)
        guard let end = calendar.date(byAdding: .day, value: days, to: start) else { return [] }
        return occurrences.filter { $0.date >= start && $0.date < end }
    }

    /// Occurrences belonging to rules the current view mode can see.
    ///
    /// An `UpcomingOccurrence` carries no owner of its own — only the id of the
    /// rule that produced it — so visibility has to be resolved through the rules.
    /// Without this the "coming up" figure in Private mode would quietly include
    /// the household's rent.
    static func visibleUpcoming(
        _ occurrences: [UpcomingOccurrence],
        visibleRuleIds: Set<String>
    ) -> [UpcomingOccurrence] {
        occurrences.filter { visibleRuleIds.contains($0.recurringTransactionId) }
    }

    /// What needs attention right now, worst first, or an empty array.
    ///
    /// Empty is the ordinary answer and the reason the section can be rendered
    /// unconditionally: a household that is on top of things sees nothing at all,
    /// which is what makes the row worth reading on the days it does appear.
    static func attention(
        budgets: [BudgetStatusRow],
        cards: [CardLimitSummary],
        dueNowCount: Int,
        formatAmount: (Double, String) -> String,
        baseCurrency: String
    ) -> [AttentionItem] {
        var items: [AttentionItem] = []

        for row in budgets {
            let tone = BudgetPresentation.tone(for: row)
            guard tone != .ok else { continue }
            let name = row.categoryNames.isEmpty
                ? "Budget"
                : row.categoryNames.joined(separator: ", ")
            items.append(
                AttentionItem(
                    id: "budget-\(row.budgetId)",
                    kind: .budget,
                    tone: tone == .over ? .over : .atRisk,
                    title: name,
                    detail: tone == .over
                        ? "\(formatAmount(row.spent - row.limit, baseCurrency)) over budget"
                        : "On pace for \(formatAmount(row.projectedSpend, baseCurrency)) of \(formatAmount(row.limit, baseCurrency))"
                )
            )
        }

        for card in cards {
            // A limit nothing points at measures nothing — a setup mistake, and
            // one that would otherwise read as a perfectly healthy "nothing spent".
            guard !Cards.measuresNothing(card.row) else { continue }
            let tone = Cards.tone(for: card.row)
            guard tone != .ok else { continue }
            items.append(
                AttentionItem(
                    id: "card-\(card.row.limitId)",
                    kind: .card,
                    // A missed *minimum* is a projection, never something that has
                    // already failed: the cycle can still be rescued until it closes.
                    tone: (tone == .over && card.row.direction == .ceiling) ? .over : .atRisk,
                    title: "\(card.cardName) · \(card.row.name)",
                    detail: cardDetail(card, formatAmount: formatAmount)
                )
            )
        }

        if dueNowCount > 0 {
            items.append(
                AttentionItem(
                    id: "recurring-due",
                    kind: .recurring,
                    tone: .atRisk,
                    title: dueNowCount == 1 ? "1 recurring transaction due" : "\(dueNowCount) recurring transactions due",
                    detail: "Posts overnight, or tap to post now"
                )
            )
        }

        // What has already gone wrong outranks what might.
        return items.sorted { lhs, rhs in
            if lhs.tone != rhs.tone { return lhs.tone == .over }
            return lhs.title < rhs.title
        }
    }

    /// Why a limit is in the attention list, not just where it stands.
    ///
    /// `Cards.headroomLabel` answers "how much is left", which is the right
    /// thing in the picker at entry and the wrong thing here: a cap flagged for
    /// being on pace to burst would read "$225 left", which is exactly what
    /// someone who did *not* need warning would see. The reason comes first.
    private static func cardDetail(
        _ card: CardLimitSummary,
        formatAmount: (Double, String) -> String
    ) -> String {
        let standing = Cards.headroomLabel(for: card.row) { formatAmount($0, card.currency) }
        guard !card.row.settled else { return standing }
        if card.row.direction == .floor {
            return "On pace to fall short · \(standing)"
        }
        return "On pace to burst · \(standing)"
    }

    /// "1 over" / "2 off pace" / nil when every budget is fine.
    static func budgetsSubtitle(_ rows: [BudgetStatusRow]) -> String? {
        guard !rows.isEmpty else { return nil }
        let over = rows.filter { BudgetPresentation.tone(for: $0) == .over }.count
        let atRisk = rows.filter { BudgetPresentation.tone(for: $0) == .atRisk }.count
        if over > 0 { return "\(over) over" }
        if atRisk > 0 { return "\(atRisk) off pace" }
        return "On track"
    }
}

// MARK: - Loading

/// Everything the summary block reads, with each piece allowed to be missing.
///
/// A household with no cards, no budgets and no rules is the normal starting
/// state, and it must produce an empty summary rather than an error.
struct CashFlowSummaryData: Equatable {
    var budgets: [BudgetStatusRow] = []
    var cardLimits: [CardLimitSummary] = []
    /// Already filtered to rules the current view mode can see.
    var upcoming: [UpcomingOccurrence] = []
    var dueNowCount: Int = 0
    var owedToYou: Double = 0
    var youOwe: Double = 0

    var isEmpty: Bool {
        budgets.isEmpty && cardLimits.isEmpty && upcoming.isEmpty && dueNowCount == 0
            && owedToYou == 0 && youOwe == 0
    }
}

extension CashFlowSummary {

    /// Fetch the summary. Every request is individually optional: this block is
    /// supplementary to whichever screen hosts it, and a card endpoint having a
    /// bad day must not take the transactions list — or the whole Dashboard —
    /// down with it.
    ///
    /// `isVisible` is passed in rather than read from a store so this stays
    /// callable off the main actor and testable without an environment.
    static func load(
        householdId: String,
        isVisible: @escaping (String?) -> Bool
    ) async -> CashFlowSummaryData {
        async let budgetsReq: BudgetStatusResponse? = optional(
            "/cashflow/budgets/household/\(householdId)/status"
        )
        async let rulesReq: [RecurringTransactionResponse]? = optional(
            "/cashflow/recurring/household/\(householdId)"
        )
        async let upcomingReq: [UpcomingOccurrence]? = optional(
            "/cashflow/recurring/household/\(householdId)/upcoming?days=90"
        )
        async let owedReq: [CounterpartyBalanceResponse]? = optional(
            "/cashflow/reimbursements/household/\(householdId)"
        )
        // Most households have no cards at all, so this is usually one request
        // returning an empty array and no status calls at all.
        async let cardsReq: [CardResponse]? = optional("/cards/household/\(householdId)")

        var data = CashFlowSummaryData()

        // Budgets are served already scoped to what the caller may see, the same
        // way `BudgetsView` renders them unfiltered.
        data.budgets = (await budgetsReq)?.budgets ?? []

        let rules = (await rulesReq)?.filter { isVisible($0.ownerUserId) } ?? []
        data.dueNowCount = dueNow(rules: rules).count
        data.upcoming = visibleUpcoming(await upcomingReq ?? [], visibleRuleIds: Set(rules.map(\.id)))

        if let balances = await owedReq {
            let totals = Reimbursements.totals(balances)
            data.owedToYou = totals.owedToYou
            data.youOwe = totals.youOwe
        }

        if let cards = await cardsReq, !cards.isEmpty {
            data.cardLimits = await cardLimits(for: cards)
        }

        return data
    }

    /// One status per card, in parallel. A household has a handful of cards
    /// rather than a list that grows, which is why this fans out rather than
    /// asking for a page.
    private static func cardLimits(for cards: [CardResponse]) async -> [CardLimitSummary] {
        await withTaskGroup(of: [CardLimitSummary].self) { group in
            for card in cards {
                group.addTask {
                    guard let status: CardStatusResponse = try? await APIClient.shared.get(
                        "/cards/\(card.id)/status"
                    ) else { return [] }
                    return status.limits.map {
                        CardLimitSummary(
                            cardName: status.accountName,
                            currency: status.currency ?? card.currency ?? "USD",
                            row: $0
                        )
                    }
                }
            }
            var out: [CardLimitSummary] = []
            for await limits in group { out.append(contentsOf: limits) }
            return out
        }
    }

    private static func optional<T: Decodable>(_ path: String) async -> T? {
        try? await APIClient.shared.get(path)
    }
}
