import Foundation

/// Swift port of the web's `frontend/src/lib/budgets.ts` — keep the two in sync.
///
/// These are the judgement calls the UI depends on: when a budget counts as "at
/// risk" rather than merely spent, and what to say when the runway is undefined
/// rather than infinite. Keeping them here (not in a View) makes them testable
/// and keeps the two clients saying the same thing about the same numbers.

enum BudgetTone: String {
    case over
    case atRisk
    case ok

    var label: String {
        switch self {
        case .over: return "Over budget"
        case .atRisk: return "On pace to overspend"
        case .ok: return "On track"
        }
    }
}

enum RunwayTone: String {
    case unknown
    case critical
    case low
    case ok
}

enum BudgetPresentation {

    /// A budget is "at risk" when today's pace would blow the limit even though
    /// it hasn't yet. Flagging that early is the whole point of the projection —
    /// telling someone they overspent on the 30th is useless.
    static func tone(for row: BudgetStatusRow) -> BudgetTone {
        if row.spent > row.limit { return .over }
        if row.projectedOver { return .atRisk }
        return .ok
    }

    /// Fraction of the limit used, clamped to 0...1 for bar widths.
    static func barFraction(for row: BudgetStatusRow) -> Double {
        guard row.percentUsed.isFinite else { return 0 }
        return min(max(row.percentUsed / 100, 0), 1)
    }

    /// How far through the period we are, 0...1. Drives the pace marker.
    static func elapsedFraction(for row: BudgetStatusRow) -> Double {
        guard row.daysTotal > 0 else { return 0 }
        return min(max(Double(row.daysElapsed) / Double(row.daysTotal), 0), 1)
    }

    /// What to show for the runway headline.
    ///
    /// A nil `monthsCovered` means no spending has been recorded — an undefined
    /// runway, not an infinite one. Saying "∞ months" to someone who simply
    /// hasn't logged expenses yet is false reassurance.
    static func runwayLabel(_ fund: EmergencyFundResponse) -> String {
        guard let months = fund.monthsCovered, months.isFinite else { return "Not enough data" }
        if months >= 99 { return "99+ months" }
        return String(format: "%.1f months", months)
    }

    /// Under one month is critical, under target is low. Deliberately about
    /// absolute survival time, not just progress to target: three months of cash
    /// is genuinely fine even against a twelve-month goal.
    static func runwayTone(_ fund: EmergencyFundResponse) -> RunwayTone {
        guard let months = fund.monthsCovered, months.isFinite else { return .unknown }
        if months < 1 { return .critical }
        if months < fund.targetMonths { return .low }
        return .ok
    }

    /// Progress toward the target, 0...1, for the runway bar.
    static func runwayFraction(_ fund: EmergencyFundResponse) -> Double {
        guard let months = fund.monthsCovered, months.isFinite, fund.targetMonths > 0 else { return 0 }
        return min(max(months / fund.targetMonths, 0), 1)
    }

    /// Net effect of the upcoming occurrences: income minus expenses. Tells the
    /// user whether the period ahead is already committed to more than it brings in.
    static func netUpcoming(_ occurrences: [UpcomingOccurrence]) -> Double {
        occurrences.reduce(into: 0.0) { total, item in
            guard item.amount.isFinite else { return }
            total += item.transactionType == .income ? item.amount : -item.amount
        }
    }

    /// Normalize active rules of different cadences into one comparable
    /// "per month" figure, split by direction.
    static func monthlyCommitment(
        rules: [RecurringTransactionResponse],
        categoryTypes: [String: TransactionType],
        today: Date = Date(),
        calendar: Calendar = .current
    ) -> (income: Double, expense: Double, net: Double) {
        var income = 0.0
        var expense = 0.0
        for rule in rules where isCommitted(rule, today: today, calendar: calendar) {
            let value = rule.amount * rule.frequency.occurrencesPerMonth
            guard value.isFinite else { continue }
            if categoryTypes[rule.categoryId] == .income {
                income += value
            } else {
                expense += value
            }
        }
        return (income, expense, income - expense)
    }

    /// Upcoming occurrences bucketed by calendar month, oldest first, for a
    /// readable agenda. Bucketing is UTC so an occurrence can't drift into a
    /// neighbouring month by timezone (same rule as the growth charts).
    static func groupedByMonth(
        _ occurrences: [UpcomingOccurrence]
    ) -> [(id: String, label: String, items: [UpcomingOccurrence])] {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt

        var buckets: [String: [UpcomingOccurrence]] = [:]
        var monthStart: [String: Date] = [:]

        for item in occurrences {
            let components = calendar.dateComponents([.year, .month], from: item.date)
            guard let year = components.year, let month = components.month else { continue }
            let key = String(format: "%04d-%02d", year, month)
            buckets[key, default: []].append(item)
            if monthStart[key] == nil {
                monthStart[key] = calendar.date(from: DateComponents(year: year, month: month, day: 1))
            }
        }

        return buckets.keys.sorted().map { key in
            let items = (buckets[key] ?? []).sorted { $0.date < $1.date }
            let label = monthStart[key]?.monthYear ?? key
            return (id: key, label: label, items: items)
        }
    }

    // MARK: - Rule health

    /// What a rule is actually doing, as opposed to what it says it does.
    ///
    /// The row used to read the same for all of these: a schedule and a "next"
    /// date. A rule whose end date has passed still printed a next date it will
    /// never post on, and one the nightly job has missed for a week looked
    /// identical to one due tomorrow.
    enum RuleHealth: String {
        /// Its next occurrence was before today and it still hasn't posted.
        case overdue
        /// Past its end date but never switched off — it will never fire again.
        case ended
        case paused
        case healthy
    }

    /// Classify a rule. `today` is injected so this is testable and so a screen
    /// can classify a whole list against one clock.
    ///
    /// Due *today* is healthy, not overdue: rules post overnight, so a rule
    /// dated today has not missed anything yet. Only a date already behind us
    /// means the schedule slipped.
    static func health(
        of rule: RecurringTransactionResponse,
        today: Date = Date(),
        calendar: Calendar = .current
    ) -> RuleHealth {
        let startOfToday = calendar.startOfDay(for: today)
        // Ended is checked before paused: a rule past its end date is finished
        // whether or not someone also paused it, and "Ended" is the more useful
        // of the two words.
        if let end = rule.endDate, calendar.startOfDay(for: end) < startOfToday {
            return .ended
        }
        if !rule.isActive { return .paused }
        if calendar.startOfDay(for: rule.nextDueDate) < startOfToday { return .overdue }
        return .healthy
    }

    /// Whether a rule still commits the household to anything.
    ///
    /// `isActive` alone is not enough. A rule past its end date is usually left
    /// switched on — the engine only clears the flag the next time it runs — so
    /// a cancelled gym membership went on being counted as a monthly commitment
    /// forever, inflating both the headline figure and its breakdown. A paused
    /// rule is excluded for the plainer reason that it isn't going to charge.
    static func isCommitted(
        _ rule: RecurringTransactionResponse,
        today: Date = Date(),
        calendar: Calendar = .current
    ) -> Bool {
        switch health(of: rule, today: today, calendar: calendar) {
        case .healthy, .overdue: return true
        case .paused, .ended: return false
        }
    }

    /// What the row should say where it used to say "next 1 Oct".
    static func scheduleLabel(
        for rule: RecurringTransactionResponse,
        today: Date = Date(),
        calendar: Calendar = .current
    ) -> String {
        switch health(of: rule, today: today, calendar: calendar) {
        case .ended: return "ended \(rule.endDate?.shortDay ?? "")"
        case .paused: return "paused"
        case .overdue: return "due \(rule.nextDueDate.shortDay)"
        case .healthy: return "next \(rule.nextDueDate.shortDay)"
        }
    }

    /// What the rule has actually done. `nil` when it has never posted, which
    /// the caller renders as its own sentence rather than as "0 times".
    static func postingLabel(for rule: RecurringTransactionResponse) -> String? {
        guard rule.timesPosted > 0 else { return nil }
        let times = rule.timesPosted == 1 ? "once" : "\(rule.timesPosted) times"
        guard let last = rule.lastPostedDate else { return "Posted \(times)" }
        return "Posted \(times) · last \(last.shortDay)"
    }

    // MARK: - Where the commitment goes

    /// One category's share of the monthly commitment.
    struct CommitmentSlice: Identifiable, Hashable {
        let categoryId: String
        let name: String
        /// Normalized to a per-month figure, so a yearly insurance premium and a
        /// weekly cleaner are comparable.
        let monthly: Double
        let ruleCount: Int

        var id: String { categoryId }
    }

    /// Monthly *expense* commitment broken down by category, biggest first.
    ///
    /// The three totals above answer "how much"; this answers "on what", which
    /// is the question that actually changes behaviour — a household can see it
    /// is committed to $84/month of subscriptions without adding up rows by eye.
    /// Income is excluded on purpose: a breakdown mixing salary with rent is a
    /// list of unrelated things sorted by size.
    static func commitmentByCategory(
        rules: [RecurringTransactionResponse],
        categoryTypes: [String: TransactionType],
        categoryNames: [String: String],
        today: Date = Date(),
        calendar: Calendar = .current
    ) -> [CommitmentSlice] {
        var monthly: [String: Double] = [:]
        var counts: [String: Int] = [:]
        for rule in rules where isCommitted(rule, today: today, calendar: calendar) {
            guard categoryTypes[rule.categoryId] != .income else { continue }
            let value = rule.amount * rule.frequency.occurrencesPerMonth
            guard value.isFinite else { continue }
            monthly[rule.categoryId, default: 0] += value
            counts[rule.categoryId, default: 0] += 1
        }
        return monthly
            .map {
                CommitmentSlice(
                    categoryId: $0.key,
                    name: categoryNames[$0.key] ?? "Uncategorized",
                    monthly: $0.value,
                    ruleCount: counts[$0.key] ?? 0
                )
            }
            .sorted {
                // Ties break on name so the order can't shuffle between loads.
                $0.monthly == $1.monthly ? $0.name < $1.name : $0.monthly > $1.monthly
            }
    }
}
