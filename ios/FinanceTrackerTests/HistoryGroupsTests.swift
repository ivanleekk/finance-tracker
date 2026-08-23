import Foundation
import Testing

@testable import FinanceTracker

/// Grouping + per-section totals for the Transactions list (`Support/HistoryGroups.swift`).
/// Twin of the web `frontend/src/lib/historyGroups.test.ts` and the Android
/// `HistoryGroupsTest.kt` — the three must agree about the same numbers.
///
/// Dates are built with an explicit UTC calendar so results don't depend on the
/// machine's timezone.
struct HistoryGroupsTests {
    private static var utc: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }

    private static func date(_ year: Int, _ month: Int, _ day: Int, _ hour: Int = 12) -> Date {
        utc.date(from: DateComponents(year: year, month: month, day: day, hour: hour))!
    }

    private static func entry(
        _ date: Date,
        isTransfer: Bool = false,
        isInflow: Bool = false,
        homeAmount: Double? = 10
    ) -> HistoryEntry {
        HistoryEntry(date: date, isTransfer: isTransfer, isInflow: isInflow, homeAmount: homeAmount)
    }

    // MARK: - homeValue

    @Test func homeValuePrefersTheStoredConversion() {
        #expect(homeValue(stored: 42, nativeAmount: 60, nativeCurrency: "USD", baseCurrency: "SGD") == 42)
    }

    @Test func homeValueFallsBackToTheAmountWhenAlreadyInBaseCurrency() {
        #expect(homeValue(stored: nil, nativeAmount: 60, nativeCurrency: "SGD", baseCurrency: "SGD") == 60)
    }

    @Test func homeValueIsNilForAnUnconvertedForeignAmount() {
        #expect(homeValue(stored: nil, nativeAmount: 60, nativeCurrency: "USD", baseCurrency: "SGD") == nil)
        #expect(homeValue(stored: nil, nativeAmount: 60, nativeCurrency: nil, baseCurrency: "SGD") == nil)
    }

    @Test func homeValueIsAlwaysAMagnitude() {
        #expect(homeValue(stored: -42, nativeAmount: 0, nativeCurrency: nil, baseCurrency: "SGD") == 42)
    }

    // MARK: - summarizeHistory

    @Test func summarySplitsInflowFromOutflowAndNetsThem() {
        let day = Self.date(2026, 8, 20)
        let summary = summarizeHistory([
            Self.entry(day, isInflow: true, homeAmount: 3000),
            Self.entry(day, homeAmount: 42.5),
            Self.entry(day, homeAmount: 500),
        ])
        #expect(summary.inflow == 3000)
        #expect(summary.outflow == 542.5)
        #expect(summary.net == 2457.5)
        #expect(summary.showsNet)
    }

    @Test func summaryIgnoresBothLegsOfATransfer() {
        // Moving 1000 between your own accounts is neither income nor spending.
        let day = Self.date(2026, 8, 20)
        let summary = summarizeHistory([
            Self.entry(day, isTransfer: true, isInflow: true, homeAmount: 1000),
            Self.entry(day, isTransfer: true, homeAmount: 1000),
            Self.entry(day, homeAmount: 20),
        ])
        #expect(summary.inflow == 0)
        #expect(summary.outflow == 20)
        #expect(summary.net == -20)
    }

    @Test func summaryCountsRowsItCannotConvertInsteadOfSummingThem() {
        let day = Self.date(2026, 8, 20)
        let summary = summarizeHistory([
            Self.entry(day, homeAmount: nil),
            Self.entry(day, homeAmount: 20),
        ])
        #expect(summary.outflow == 20)
        #expect(summary.unconverted == 1)
    }

    @Test func summaryHidesTheNetWhenOnlyOneSideMoved() {
        let day = Self.date(2026, 8, 20)
        #expect(!summarizeHistory([Self.entry(day, homeAmount: 20)]).showsNet)
        #expect(!summarizeHistory([Self.entry(day, isInflow: true, homeAmount: 20)]).showsNet)
    }

    @Test func summaryOfNothingButTransfersIsAllZeroes() {
        let summary = summarizeHistory([Self.entry(Self.date(2026, 8, 20), isTransfer: true, homeAmount: 500)])
        #expect(summary == HistoryGroupSummary(inflow: 0, outflow: 0, unconverted: 0))
    }

    // MARK: - groupHistory

    private static var sample: [HistoryEntry] {
        [
            entry(date(2026, 8, 20, 10), isInflow: true, homeAmount: 100),
            entry(date(2026, 8, 20, 8), homeAmount: 30),
            entry(date(2026, 8, 19, 8), homeAmount: 12),
            entry(date(2026, 7, 2, 8), homeAmount: 7),
            entry(date(2025, 7, 2, 8), isInflow: true, homeAmount: 5),
        ]
    }

    @Test func groupsByDayWithATotalPerDay() {
        let groups = groupHistory(Self.sample, by: .day, now: Self.date(2026, 8, 20), calendar: Self.utc) { $0 }
        #expect(groups.count == 4)
        #expect(groups[0].items.count == 2)
        #expect(groups[0].summary.inflow == 100)
        #expect(groups[0].summary.outflow == 30)
        #expect(groups[1].summary.outflow == 12)
        #expect(groups[0].start == Self.date(2026, 8, 20, 0))
    }

    @Test func rollsTheSameItemsUpByMonth() {
        let groups = groupHistory(Self.sample, by: .month, now: Self.date(2026, 8, 20), calendar: Self.utc) { $0 }
        #expect(groups.count == 3)
        #expect(groups[0].summary.inflow == 100)
        #expect(groups[0].summary.outflow == 42)
        #expect(groups[0].summary.net == 58)
    }

    @Test func rollsTheSameItemsUpByYear() {
        let groups = groupHistory(Self.sample, by: .year, now: Self.date(2026, 8, 20), calendar: Self.utc) { $0 }
        #expect(groups.count == 2)
        #expect(groups[0].summary.outflow == 49)
        #expect(groups[0].summary.net == 51)
        #expect(groups[1].summary.inflow == 5)
    }

    @Test func preservesTheIncomingOrderOfGroupsAndItems() {
        let groups = groupHistory(Self.sample, by: .day, now: Self.date(2026, 8, 20), calendar: Self.utc) { $0 }
        #expect(groups.map(\.start) == groups.map(\.start).sorted(by: >))
        #expect(groups[0].items[0].homeAmount == 100)
        #expect(groups[0].items[1].homeAmount == 30)
    }

    @Test func groupsNothingIntoNothing() {
        let groups = groupHistory([HistoryEntry](), by: .month, calendar: Self.utc) { $0 }
        #expect(groups.isEmpty)
    }

    // MARK: - labels

    @Test func dayLabelsSayTodayAndYesterdayRelativeToTheGivenNow() {
        let now = Self.date(2026, 8, 20, 9)
        #expect(historyGroupLabel(for: Self.date(2026, 8, 20, 0), granularity: .day, now: now, calendar: Self.utc)
            .hasPrefix("Today · "))
        #expect(historyGroupLabel(for: Self.date(2026, 8, 19, 0), granularity: .day, now: now, calendar: Self.utc)
            .hasPrefix("Yesterday · "))
        let older = historyGroupLabel(for: Self.date(2026, 8, 18, 0), granularity: .day, now: now, calendar: Self.utc)
        #expect(!older.contains("Today"))
        #expect(!older.contains("Yesterday"))
    }

    @Test func monthAndYearLabelsNeverSayTodayOrYesterday() {
        let now = Self.date(2026, 8, 20, 9)
        let month = historyGroupLabel(for: Self.date(2026, 8, 1, 0), granularity: .month, now: now, calendar: Self.utc)
        #expect(!month.contains("Today"))
        let year = historyGroupLabel(for: Self.date(2026, 1, 1, 0), granularity: .year, now: now, calendar: Self.utc)
        #expect(year.contains("2026"))
    }
}
