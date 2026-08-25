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

/// The bug the rest of this suite couldn't see: every other test passes `calendar: utc`
/// explicitly, but `TransactionsView` calls `groupHistory` *without* a calendar. It used to
/// get `.current` — the device's timezone — while the labels (`Date.monthYear`,
/// `Date.shortDay`) render in UTC, so the two disagreed by the size of the offset. East of
/// UTC that was enough to head every month section with the previous month's name.
///
/// So these tests deliberately call the API the way the screen does, with **no calendar
/// argument**, and assert against the UTC calendar date the backend actually sent. On a
/// non-UTC machine that alone reproduces the bug; `theDefaultCalendarIsUTC` is what makes the
/// guard bite on a UTC build machine too.
struct HistoryGroupTimezoneTests {
    private static func utcDate(_ year: Int, _ month: Int, _ day: Int) -> Date {
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        // Backend dates are calendar dates, parsed at UTC midnight — see DateParser.
        return utc.date(from: DateComponents(year: year, month: month, day: day, hour: 0))!
    }

    private static func entry(_ date: Date) -> HistoryEntry {
        HistoryEntry(date: date, isTransfer: false, isInflow: false, homeAmount: 10)
    }

    /// The guard that works regardless of the machine's timezone: the default must be UTC,
    /// because every label these groups carry is formatted in UTC.
    @Test func theDefaultCalendarIsUTC() {
        #expect(historyCalendar.timeZone.secondsFromGMT() == 0)
    }

    /// July transactions must head up a "July 2026" section, not "June 2026".
    @Test func monthSectionsAreLabelledWithTheirOwnMonth() {
        let groups = groupHistory(
            [Self.entry(Self.utcDate(2026, 7, 24)), Self.entry(Self.utcDate(2026, 7, 1))],
            by: .month
        ) { $0 }
        #expect(groups.count == 1)
        #expect(groups.first?.label == "July 2026")
    }

    /// The month boundary falls where the backend put it: 1 July and 30 June are two
    /// sections, not one, and neither is named after its neighbour.
    @Test func theMonthBoundaryFallsWhereTheBackendPutIt() {
        let groups = groupHistory(
            [Self.entry(Self.utcDate(2026, 7, 1)), Self.entry(Self.utcDate(2026, 6, 30))],
            by: .month
        ) { $0 }
        #expect(groups.map(\.label) == ["July 2026", "June 2026"])
    }

    /// A day header has to agree with the `Date.shortDay` printed on the rows beneath it.
    @Test func daySectionsAgreeWithTheirRows() {
        let date = Self.utcDate(2026, 7, 1)
        let groups = groupHistory([Self.entry(date)], by: .day, now: Self.utcDate(2026, 8, 20)) { $0 }
        #expect(groups.first?.label.contains(date.shortDay) == true)
    }

    /// "Today" is about the reader's day, not UTC's.
    ///
    /// A Singapore morning is the case: at 07:00 on 25 August local, UTC is still on the 24th.
    /// A row the backend dated 2026-08-25 is today's — comparing both sides in UTC headed it
    /// "25 Aug 2026" for the first eight hours of every day.
    @Test func todayMeansTheReadersDayNotUTCs() {
        // 07:00 on the 25th in UTC+8 is still the 24th in UTC.
        let now = Self.utcInstant(2026, 8, 24, hour: 23)
        let label = historyGroupLabel(
            for: Self.utcDate(2026, 8, 25),
            granularity: .day,
            now: now,
            localCalendar: Self.calendar(offsetHours: 8)
        )
        #expect(label.hasPrefix("Today · "))
    }

    @Test func yesterdayIsRelativeToTheReadersDayToo() {
        let now = Self.utcInstant(2026, 8, 24, hour: 23)
        let label = historyGroupLabel(
            for: Self.utcDate(2026, 8, 24),
            granularity: .day,
            now: now,
            localCalendar: Self.calendar(offsetHours: 8)
        )
        #expect(label.hasPrefix("Yesterday · "))
    }

    /// The mirror image, west of Greenwich: at 20:00 on 24 August in UTC-5, UTC has already
    /// rolled over to the 25th. Tomorrow's date must not be labelled "Today".
    @Test func todayDoesNotRunAheadWestOfUTC() {
        // 20:00 on the 24th in UTC-5 is already the 25th in UTC.
        let now = Self.utcInstant(2026, 8, 25, hour: 1)
        let local = Self.calendar(offsetHours: -5)
        #expect(
            historyGroupLabel(
                for: Self.utcDate(2026, 8, 24), granularity: .day, now: now, localCalendar: local
            ).hasPrefix("Today · ")
        )
        #expect(
            !historyGroupLabel(
                for: Self.utcDate(2026, 8, 25), granularity: .day, now: now, localCalendar: local
            ).hasPrefix("Today · ")
        )
    }

    /// A wall-clock instant, expressed in UTC. Built from components rather than an epoch
    /// literal so the timezone arithmetic under test is readable in the test itself.
    private static func utcInstant(_ year: Int, _ month: Int, _ day: Int, hour: Int) -> Date {
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        return utc.date(from: DateComponents(year: year, month: month, day: day, hour: hour))!
    }

    private static func calendar(offsetHours: Int) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: offsetHours * 3600)!
        return calendar
    }

    /// And the year header, the third label that used to be formatted a different way again.
    @Test func yearSectionsAreLabelledWithTheirOwnYear() {
        let groups = groupHistory(
            [Self.entry(Self.utcDate(2026, 1, 1)), Self.entry(Self.utcDate(2025, 12, 31))],
            by: .year
        ) { $0 }
        #expect(groups.map(\.label) == ["2026", "2025"])
    }
}
