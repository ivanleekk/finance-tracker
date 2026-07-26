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
}
