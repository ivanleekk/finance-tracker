import Foundation
import Testing
@testable import FinanceTracker

/// `DateParser` (Networking/APIClient.swift) — the hand-rolled ISO-8601 scanner that
/// replaced a chain of six `DateFormatter`s.
///
/// It is on the app's hottest path (every date field of every row of every response), and
/// a scanner that is fast but subtly wrong would silently shift a transaction into the
/// neighbouring day. So the contract asserted here is: **the fast path agrees with the old
/// formatter chain**, which is still present as `legacyParse` and is the reference.
struct DateParserTests {

    /// Every shape the backend emits, and a few edges around leap years and the epoch.
    static let backendShapes = [
        "2026-07-19",                          // date-only (the common case)
        "2026-07-19T00:00:00",                 // naive datetime
        "2026-07-19T01:53:01.787071",          // naive, fractional
        "2026-07-19T01:53:01Z",                // zoned
        "2026-07-19T01:53:01.787071Z",         // zoned, fractional
        "2026-07-19T01:53:01+08:00",           // positive offset
        "2026-07-19T01:53:01-05:30",           // negative, half-hour offset
        "2026-07-19T01:53:01.787071+08:00",
        "1970-01-01",                          // the epoch itself
        "1969-12-31T23:59:59",                 // before it
        "2000-02-29",                          // century leap year
        "2024-02-29T12:00:00Z",                // ordinary leap year
        "1900-03-01",                          // day after the century *non*-leap year
        "2099-12-31T23:59:59",
    ]

    @Test(arguments: backendShapes)
    func fastPathAgreesWithTheFormatterChain(raw: String) throws {
        let parsed = try #require(DateParser.parse(raw), "\(raw) failed to parse")
        let reference = try #require(DateParser.legacyParse(raw), "\(raw) has no reference")
        // Sub-millisecond, not exact: the old `.SSSSSS` formatter truncated fractional
        // seconds to milliseconds, where the scanner keeps every digit sent.
        #expect(abs(parsed.timeIntervalSince1970 - reference.timeIntervalSince1970) < 0.001)
    }

    @Test func dateOnlyIsReadAtUTCMidnight() throws {
        // Not local midnight: backend dates mean a calendar date, and reading "2026-07-19"
        // at UTC+8 midnight would file it under the 18th everywhere the app formats in UTC.
        let parsed = try #require(DateParser.parse("2026-07-19"))
        #expect(parsed.timeIntervalSince1970 == 1_784_419_200)
    }

    @Test func naiveDatetimeIsTreatedAsUTC() throws {
        let parsed = try #require(DateParser.parse("2026-07-19T00:00:00"))
        #expect(parsed.timeIntervalSince1970 == 1_784_419_200)
    }

    @Test func offsetIsRemovedToReachUTC() throws {
        // 01:53:01+08:00 is 17:53:01 UTC on the previous day.
        let plus = try #require(DateParser.parse("2026-07-19T01:53:01+08:00"))
        let utc = try #require(DateParser.parse("2026-07-18T17:53:01Z"))
        #expect(plus == utc)
    }

    @Test func fractionalSecondsSurviveAtFullPrecision() throws {
        let parsed = try #require(DateParser.parse("2026-07-19T01:53:01.787071Z"))
        #expect(abs(parsed.timeIntervalSince1970 - 1_784_425_981.787071) < 0.000_001)
    }

    @Test(arguments: [
        "",
        "nonsense",
        "2026-13-01",          // month 13
        "2026-07-32",          // day 32
        "2026-07-19T25:00:00", // hour 25
        "2026-07-19T01:60:00", // minute 60
        "2026-07-",            // truncated
    ])
    func rejectsGarbageInsteadOfGuessing(raw: String) {
        #expect(DateParser.parse(raw) == nil)
    }

    /// The scanner rejects these, but the formatter fallback behind it accepts them, and
    /// it did before this change too — pinned so the fallback isn't quietly dropped.
    @Test(arguments: ["2026/07/19", "2026-07-19T01:53:01+8"])
    func unusualShapesStillFallBackToTheFormatterChain(raw: String) {
        #expect(DateParser.parse(raw) != nil)
    }
}
