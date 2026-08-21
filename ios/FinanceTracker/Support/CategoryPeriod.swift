import Foundation

/// The date window the Transactions "Top categories" card is scoped to.
///
/// Swift port of the web's `CategoryPeriodPreset` (`frontend/src/pages/Transactions/Transactions.tsx`);
/// the Kotlin twin is `android/.../logic/CategoryPeriod.kt`. Raw values match the web's strings so the
/// three clients describe the same window with the same name.
enum CategoryPeriod: String, CaseIterable, Identifiable, Codable {
    case all
    case thisMonth = "this_month"
    case lastMonth = "last_month"
    case last3Months = "last_3_months"
    case last6Months = "last_6_months"
    case thisYear = "this_year"
    case specificMonth = "specific_month"
    case custom

    var id: String { rawValue }

    var label: String {
        switch self {
        case .all: "All time"
        case .thisMonth: "This month"
        case .lastMonth: "Last month"
        case .last3Months: "Last 3 months"
        case .last6Months: "Last 6 months"
        case .thisYear: "This year"
        case .specificMonth: "Specific month"
        case .custom: "Custom range"
        }
    }

    /// Whether this case needs the custom start/end dates filled in to mean anything.
    var usesCustomStart: Bool { self == .custom || self == .specificMonth }
}

/// A half-open window: `start` inclusive, `end` **exclusive**. Either side may be nil, meaning
/// unbounded in that direction.
struct CategoryPeriodRange: Equatable {
    let start: Date?
    let end: Date?

    func contains(_ date: Date) -> Bool {
        if let start, date < start { return false }
        if let end, date >= end { return false }
        return true
    }
}

extension CategoryPeriod {
    /// Boundaries are computed in **UTC**, not the device's calendar. Backend transaction dates are
    /// naive and read back as UTC, so a local-calendar month boundary would pull the 1st of the month
    /// into the previous bucket for anyone west of Greenwich — the same reason the Activity list groups
    /// its months in UTC.
    static var utcCalendar: Calendar {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        return cal
    }

    /// The window to filter by, or `nil` for "no filter at all" (`.all`, or a `.custom` range with
    /// neither end filled in).
    func range(customStart: Date? = nil, customEnd: Date? = nil, now: Date = Date()) -> CategoryPeriodRange? {
        let cal = Self.utcCalendar

        func monthStart(offset: Int) -> Date {
            let current = cal.date(from: cal.dateComponents([.year, .month], from: now))!
            return cal.date(byAdding: .month, value: offset, to: current)!
        }

        switch self {
        case .all:
            return nil
        case .thisMonth:
            return CategoryPeriodRange(start: monthStart(offset: 0), end: nil)
        case .lastMonth:
            return CategoryPeriodRange(start: monthStart(offset: -1), end: monthStart(offset: 0))
        case .last3Months:
            return CategoryPeriodRange(start: monthStart(offset: -2), end: nil)
        case .last6Months:
            return CategoryPeriodRange(start: monthStart(offset: -5), end: nil)
        case .thisYear:
            return CategoryPeriodRange(start: cal.date(from: cal.dateComponents([.year], from: now))!, end: nil)
        case .specificMonth:
            // `customStart` doubles as the month anchor — only its year/month are read, so any
            // day within the month selects that whole month. Reusing the field keeps the saved
            // preferences one shape rather than adding a third date that's null most of the time.
            guard let anchor = customStart else { return nil }
            let start = cal.date(from: cal.dateComponents([.year, .month], from: anchor))!
            return CategoryPeriodRange(start: start, end: cal.date(byAdding: .month, value: 1, to: start)!)
        case .custom:
            // The end date the user picked is inclusive, so the exclusive bound is the next midnight.
            let start = customStart.map { cal.startOfDay(for: $0) }
            let end = customEnd.map { cal.date(byAdding: .day, value: 1, to: cal.startOfDay(for: $0))! }
            if start == nil && end == nil { return nil }
            return CategoryPeriodRange(start: start, end: end)
        }
    }
}

/// The user's saved Top-categories filter for one household: which categories are hidden and which
/// period is selected. Persisted so it survives leaving the tab, matching the web's localStorage.
struct TopCategoryFilterPrefs: Codable, Equatable {
    var hiddenCategoryIds: Set<String> = []
    var period: CategoryPeriod = .all
    var customStart: Date?
    var customEnd: Date?

    static let empty = TopCategoryFilterPrefs()
}

/// UserDefaults-backed store for `TopCategoryFilterPrefs`, keyed per household — two households have
/// different categories, so one household's hidden set is meaningless in the other.
enum TopCategoryFilterStore {
    static func key(householdId: String) -> String { "ft:tx-category-filter:\(householdId)" }

    static func load(householdId: String, defaults: UserDefaults = .standard) -> TopCategoryFilterPrefs {
        guard let data = defaults.data(forKey: key(householdId: householdId)),
              let prefs = try? JSONDecoder().decode(TopCategoryFilterPrefs.self, from: data)
        else { return .empty }
        return prefs
    }

    static func save(_ prefs: TopCategoryFilterPrefs, householdId: String, defaults: UserDefaults = .standard) {
        guard let data = try? JSONEncoder().encode(prefs) else { return }
        defaults.set(data, forKey: key(householdId: householdId))
    }
}
