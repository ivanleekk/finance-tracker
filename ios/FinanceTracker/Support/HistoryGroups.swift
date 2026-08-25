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

/// UTC, and **not** `.current`, for the same reason every display formatter in this app is
/// UTC (see `Date.FormatStyle.utc` in Support/Formatters.swift): backend dates mean a
/// *calendar date* and are parsed at UTC midnight, so a bucket boundary drawn in the device's
/// timezone lands on a different instant than the label rendered from it.
///
/// This was a live bug rather than a theoretical one. Bucketing ran in `.current` while
/// `.month`'s label used the UTC `Date.monthYear`, so east of UTC every month section was
/// headed with the *previous* month's name — a Singapore user's July transactions sat under
/// "June 2026". `.day` had the mirror-image fault to the west of UTC, where its
/// device-calendar label disagreed with the UTC `shortDay` on the rows underneath.
/// `HistoryGroupTimezoneTests` pins both. Android's `HistoryGroups.kt` has always used
/// `ZoneOffset.UTC` throughout; this brings iOS back in line with it.
let historyCalendar: Calendar = {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    return calendar
}()

func historyGroupLabel(
    for start: Date,
    granularity: HistoryGranularity,
    now: Date = Date(),
    calendar: Calendar = historyCalendar,
    /// The **reader's** calendar, and deliberately not `calendar` above. "Today" is the one
    /// question on this screen that isn't about the backend's calendar dates at all — it's
    /// about the day the person holding the phone is having. A row is dated 25 August in UTC;
    /// whether that is *today* depends on the date where they are. Comparing both sides in UTC
    /// meant that for the eight hours each morning that Singapore runs ahead of UTC, today's
    /// transactions were headed "25 Aug 2026" instead of "Today" — and west of Greenwich the
    /// same mismatch labels tomorrow's date "Today" late in the evening.
    localCalendar: Calendar = .current
) -> String {
    switch granularity {
    case .year:
        return start.utcYear
    case .month:
        return start.monthYear
    case .day:
        // Relative to the passed-in `now` rather than the wall clock, so this stays testable.
        let day = calendar.dateComponents([.year, .month, .day], from: start)
        func isLocalDay(_ date: Date) -> Bool {
            let other = localCalendar.dateComponents([.year, .month, .day], from: date)
            return day.year == other.year && day.month == other.month && day.day == other.day
        }
        if isLocalDay(now) { return "Today · \(start.shortDay)" }
        if let yesterday = localCalendar.date(byAdding: .day, value: -1, to: now),
           isLocalDay(yesterday) {
            return "Yesterday · \(start.shortDay)"
        }
        return start.utcDayMonthYear
    }
}

/// Buckets `items` newest-first, keeping the incoming order of items inside each bucket.
func groupHistory<Item>(
    _ items: [Item],
    by granularity: HistoryGranularity,
    now: Date = Date(),
    calendar: Calendar = historyCalendar,
    localCalendar: Calendar = .current,
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
            label: historyGroupLabel(
                for: start, granularity: granularity, now: now,
                calendar: calendar, localCalendar: localCalendar
            ),
            items: buckets[start] ?? [],
            summary: summarizeHistory(entries[start] ?? [])
        )
    }
}
