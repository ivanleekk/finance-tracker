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
        categoryTypes: [String: TransactionType]
    ) -> (income: Double, expense: Double, net: Double) {
        var income = 0.0
        var expense = 0.0
        for rule in rules where rule.isActive {
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
}
