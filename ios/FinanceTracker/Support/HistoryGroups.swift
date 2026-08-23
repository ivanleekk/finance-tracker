import Foundation

// Grouping and per-group totals for the Transactions list.
//
// Swift port of `frontend/src/lib/historyGroups.ts` (and the twin of
// `android/.../logic/HistoryGroups.kt`). The list is bucketed by day, month or
// year, and each section header carries the money that moved inside it. Two
// judgement calls live here rather than in the view, and they are the same three
// places over:
//
//  - Transfers never count. Money moving between the household's own accounts is
//    not income and not spending; counting it would double a day's totals. Same
//    rule as the budget and runway rollups.
//  - A row with no known base-currency value is left out of the totals instead of
//    being summed at face value, and reported through `unconverted` so the header
//    can say the total is partial. A day mixing SGD and USD rows would otherwise
//    show a number that means nothing.

enum HistoryGranularity: String, CaseIterable, Identifiable, Sendable {
    case day, month, year

    var id: String { rawValue }

    var label: String {
        switch self {
        case .day: "Day"
        case .month: "Month"
        case .year: "Year"
        }
    }

    var calendarComponent: Calendar.Component {
        switch self {
        case .day: .day
        case .month: .month
        case .year: .year
        }
    }
}

/// The four facts summing a row needs, pulled off whatever model the screen holds.
struct HistoryEntry: Sendable {
    let date: Date
    let isTransfer: Bool
    let isInflow: Bool
    /// Value in the household's base currency, or nil when it can't be converted.
    let homeAmount: Double?

    init(date: Date, isTransfer: Bool, isInflow: Bool, homeAmount: Double?) {
        self.date = date
        self.isTransfer = isTransfer
        self.isInflow = isInflow
        self.homeAmount = homeAmount
    }
}

struct HistoryGroupSummary: Equatable, Sendable {
    var inflow: Double = 0
    var outflow: Double = 0
    /// Rows in the group with no base-currency value, so missing from the totals.
    var unconverted: Int = 0

    var net: Double { inflow - outflow }
    /// Both sides moved, so the net is worth spelling out next to them.
    var showsNet: Bool { inflow > 0 && outflow > 0 }
}

struct HistoryGroup<Item>: Identifiable {
    /// Start of the bucket — also its identity, so sections keep stable ids across reloads.
    let start: Date
    let label: String
    let items: [Item]
    let summary: HistoryGroupSummary

    var id: Date { start }
}

/// Best guess at a row's value in the household's base currency: the figure the
/// backend already converted, or the row's own amount when it was already booked in
/// the base currency. Anything else stays nil.
func homeValue(
    stored: Double?,
    nativeAmount: Double,
    nativeCurrency: String?,
    baseCurrency: String
) -> Double? {
    if let stored, stored.isFinite { return abs(stored) }
    if let nativeCurrency, nativeCurrency == baseCurrency { return abs(nativeAmount) }
    return nil
}

func summarizeHistory(_ entries: [HistoryEntry]) -> HistoryGroupSummary {
    var summary = HistoryGroupSummary()
    for entry in entries {
        if entry.isTransfer { continue }
        guard let amount = entry.homeAmount, amount.isFinite else {
            summary.unconverted += 1
            continue
        }
        if entry.isInflow { summary.inflow += abs(amount) } else { summary.outflow += abs(amount) }
    }
    return summary
}

func historyGroupLabel(
    for start: Date,
    granularity: HistoryGranularity,
    now: Date = Date(),
    calendar: Calendar = .current
) -> String {
    switch granularity {
    case .year:
        return start.formatted(.dateTime.year())
    case .month:
        return start.monthYear
    case .day:
        // Relative to the passed-in `now` rather than the wall clock, so this stays testable.
        if calendar.isDate(start, inSameDayAs: now) { return "Today · \(start.shortDay)" }
        if let yesterday = calendar.date(byAdding: .day, value: -1, to: now),
           calendar.isDate(start, inSameDayAs: yesterday) {
            return "Yesterday · \(start.shortDay)"
        }
        return start.formatted(.dateTime.day().month(.abbreviated).year())
    }
}

/// Buckets `items` newest-first, keeping the incoming order of items inside each bucket.
func groupHistory<Item>(
    _ items: [Item],
    by granularity: HistoryGranularity,
    now: Date = Date(),
    calendar: Calendar = .current,
    entry: (Item) -> HistoryEntry
) -> [HistoryGroup<Item>] {
    var order: [Date] = []
    var buckets: [Date: [Item]] = [:]
    var entries: [Date: [HistoryEntry]] = [:]

    for item in items {
        let itemEntry = entry(item)
        let start = calendar.dateInterval(of: granularity.calendarComponent, for: itemEntry.date)?.start
            ?? itemEntry.date
        if buckets[start] == nil {
            buckets[start] = []
            entries[start] = []
            order.append(start)
        }
        buckets[start]?.append(item)
        entries[start]?.append(itemEntry)
    }

    return order.map { start in
        HistoryGroup(
            start: start,
            label: historyGroupLabel(for: start, granularity: granularity, now: now, calendar: calendar),
            items: buckets[start] ?? [],
            summary: summarizeHistory(entries[start] ?? [])
        )
    }
}
