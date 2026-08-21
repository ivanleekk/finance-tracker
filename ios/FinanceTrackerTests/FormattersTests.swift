import Foundation
import Testing
@testable import FinanceTracker

/// Formatting helpers (`Support/Formatters.swift`). Most currency/percent output flows
/// through Foundation's locale-aware `.formatted`, which isn't worth pinning to exact
/// strings in a test. `apiDateOnly` is the exception — it's a hand-rolled fixed-format,
/// UTC formatter whose exact output the backend depends on, so it's asserted precisely.
struct FormattersTests {

    // MARK: apiDateOnly — the backend-critical one

    @Test func apiDateOnlyFormatsUTCDate() {
        // 2026-07-19T00:00:00 UTC.
        let date = Date(timeIntervalSince1970: 1_784_419_200)
        #expect(date.apiDateOnly == "2026-07-19")
    }

    @Test func apiDateOnlyUsesUTCNotLocalTimeOfDay() {
        // A datetime late in the UTC day must still stringify to that UTC calendar day,
        // regardless of the device's local timezone — DatePicker carries a time-of-day and
        // Pydantic's `date` rejects a non-midnight datetime.
        // 2026-07-19T23:30:00 UTC.
        let date = Date(timeIntervalSince1970: 1_784_419_200 + 23 * 3600 + 30 * 60)
        #expect(date.apiDateOnly == "2026-07-19")
    }

    @Test func apiDateOnlyRoundTripsThroughDateParser() throws {
        let original = Date(timeIntervalSince1970: 1_784_419_200)
        let string = original.apiDateOnly
        let parsed = try #require(DateParser.parse(string))
        // DateParser reads date-only values at UTC midnight, matching apiDateOnly's output.
        #expect(parsed.apiDateOnly == string)
    }

    // MARK: currency helpers — structural (locale-tolerant) checks

    @Test func currencyIncludesTwoFractionDigits() {
        let s = 1234.5.currency("USD")
        // Whatever the locale symbol, the cents should be present.
        #expect(s.contains("34.50") || s.contains("34,50"))
    }

    @Test func currencyWholeHasNoDecimalSeparator() {
        let s = 29856.0.currencyWhole("SGD")
        #expect(!s.contains(".00"))
        #expect(s.contains("29"))
    }

    @Test func signedPercentPrefixesPlusForGains() {
        let s = 0.042.signedPercent
        #expect(s.hasPrefix("+"))
    }

    @Test func signedPercentPrefixesMinusForLosses() {
        let s = (-0.031).signedPercent
        #expect(s.hasPrefix("-"))
    }

    // MARK: display dates render in UTC, not the device's timezone
    //
    // Backend dates are calendar dates read at UTC midnight, so formatting them with the
    // device's calendar shifts them a day and splits a row from the month section header it
    // sits under (headers group in UTC via BudgetPresentation.groupedByMonth).
    //
    // Each case straddles *both* ends of the UTC day on purpose: the 23:30 instant lands on
    // the next day in any positive offset, the 00:30 instant on the previous day in any
    // negative one. Asserting both means these fail on a machine in any timezone but UTC if
    // the pin is removed — a single instant would only catch one hemisphere, and would pass
    // vacuously on the machine that happens to be running them.

    private static func utcInstant(_ year: Int, _ month: Int, _ day: Int, _ hour: Int, _ minute: Int) -> Date {
        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = day
        components.hour = hour
        components.minute = minute
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = backendTimeZone
        return calendar.date(from: components)!
    }

    /// The day number the UTC calendar would print, as a plain string.
    private static func utcDay(_ date: Date) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = backendTimeZone
        return String(calendar.component(.day, from: date))
    }

    @Test func shortDayKeepsTheBackendsCalendarDayAtBothEndsOfTheDay() {
        let lateInDay = Self.utcInstant(2026, 7, 15, 23, 30)   // 16 Jul east of Greenwich
        let earlyInDay = Self.utcInstant(2026, 7, 15, 0, 30)   // 14 Jul west of Greenwich
        #expect(lateInDay.shortDay.contains(Self.utcDay(lateInDay)))
        #expect(!lateInDay.shortDay.contains("16"))
        #expect(earlyInDay.shortDay.contains(Self.utcDay(earlyInDay)))
        #expect(!earlyInDay.shortDay.contains("14"))
    }

    @Test func monthYearKeepsTheBackendsMonthAcrossTheYearBoundary() {
        // 31 Dec 23:30 UTC is already January in a positive offset; 1 Jan 00:30 UTC is still
        // December in a negative one. Both must report the UTC year.
        let newYearsEve = Self.utcInstant(2025, 12, 31, 23, 30)
        let newYearsDay = Self.utcInstant(2026, 1, 1, 0, 30)
        #expect(newYearsEve.monthYear.contains("2025"))
        #expect(!newYearsEve.monthYear.contains("2026"))
        #expect(newYearsDay.monthYear.contains("2026"))
        #expect(!newYearsDay.monthYear.contains("2025"))
    }

    @Test func dueMonthYearKeepsTheBackendsMonthAcrossTheYearBoundary() {
        let lateInYear = Self.utcInstant(2027, 12, 31, 23, 30)
        let earlyInYear = Self.utcInstant(2028, 1, 1, 0, 30)
        #expect(lateInYear.dueMonthYear.contains("2027"))
        #expect(!lateInYear.dueMonthYear.contains("2028"))
        #expect(earlyInYear.dueMonthYear.contains("2028"))
        #expect(!earlyInYear.dueMonthYear.contains("2027"))
    }
}
