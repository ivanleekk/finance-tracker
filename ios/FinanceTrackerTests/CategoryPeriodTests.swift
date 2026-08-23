import Foundation
import Testing
@testable import FinanceTracker

/// The Top-categories period window. Every case passes an explicit `now` so nothing drifts with the
/// wall clock, and dates are built in UTC — the boundaries themselves are UTC by design.
struct CategoryPeriodTests {
    private static func utc(_ year: Int, _ month: Int, _ day: Int, hour: Int = 0) -> Date {
        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = day
        components.hour = hour
        return CategoryPeriod.utcCalendar.date(from: components)!
    }

    /// Mid-March, deliberately not on a boundary.
    private static let now = utc(2026, 3, 17, hour: 11)

    @Test func allTimeIsUnbounded() {
        #expect(CategoryPeriod.all.range(now: Self.now) == nil)
    }

    @Test func thisMonthStartsAtTheFirstAndHasNoEnd() throws {
        let range = try #require(CategoryPeriod.thisMonth.range(now: Self.now))
        #expect(range.start == Self.utc(2026, 3, 1))
        #expect(range.end == nil)
        #expect(range.contains(Self.utc(2026, 3, 1)))
        #expect(!range.contains(Self.utc(2026, 2, 28)))
    }

    @Test func lastMonthEndsExclusivelyAtThisMonthsFirst() throws {
        let range = try #require(CategoryPeriod.lastMonth.range(now: Self.now))
        #expect(range.start == Self.utc(2026, 2, 1))
        #expect(range.end == Self.utc(2026, 3, 1))
        #expect(range.contains(Self.utc(2026, 2, 28)))
        // The 1st of the current month belongs to *this* month, not last.
        #expect(!range.contains(Self.utc(2026, 3, 1)))
        #expect(!range.contains(Self.utc(2026, 1, 31)))
    }

    /// "Last 3 months" is inclusive of the current one — Jan, Feb, Mar from a March `now`.
    @Test func lastNMonthsIncludeTheCurrentMonth() throws {
        let three = try #require(CategoryPeriod.last3Months.range(now: Self.now))
        #expect(three.start == Self.utc(2026, 1, 1))
        #expect(three.end == nil)

        let six = try #require(CategoryPeriod.last6Months.range(now: Self.now))
        #expect(six.start == Self.utc(2025, 10, 1))
    }

    @Test func thisYearStartsAtJanuaryFirst() throws {
        let range = try #require(CategoryPeriod.thisYear.range(now: Self.now))
        #expect(range.start == Self.utc(2026, 1, 1))
        #expect(!range.contains(Self.utc(2025, 12, 31)))
    }

    /// The picked end date is inclusive to the user, so the exclusive bound is the following midnight —
    /// otherwise a transaction dated on the end day would silently drop out of its own range.
    @Test func customRangeIncludesTheWholeEndDay() throws {
        let range = try #require(CategoryPeriod.custom.range(
            customStart: Self.utc(2026, 2, 10, hour: 9),
            customEnd: Self.utc(2026, 2, 20, hour: 15),
            now: Self.now
        ))
        #expect(range.start == Self.utc(2026, 2, 10))
        #expect(range.end == Self.utc(2026, 2, 21))
        #expect(range.contains(Self.utc(2026, 2, 10)))
        #expect(range.contains(Self.utc(2026, 2, 20, hour: 23)))
        #expect(!range.contains(Self.utc(2026, 2, 21)))
        #expect(!range.contains(Self.utc(2026, 2, 9, hour: 23)))
    }

    /// "Choose which month" from the issue: the anchor's day is irrelevant, only its year/month.
    @Test func specificMonthCoversExactlyThatMonth() throws {
        let range = try #require(CategoryPeriod.specificMonth.range(
            customStart: Self.utc(2026, 2, 17, hour: 13), now: Self.now
        ))
        #expect(range.start == Self.utc(2026, 2, 1))
        #expect(range.end == Self.utc(2026, 3, 1))
        #expect(range.contains(Self.utc(2026, 2, 1)))
        #expect(range.contains(Self.utc(2026, 2, 28, hour: 23)))
        #expect(!range.contains(Self.utc(2026, 3, 1)))
        #expect(!range.contains(Self.utc(2026, 1, 31)))
    }

    /// Any day in the month picks the same window — the picker only surfaces month+year.
    @Test func specificMonthIgnoresTheAnchorDay() throws {
        let first = try #require(CategoryPeriod.specificMonth.range(customStart: Self.utc(2025, 12, 1), now: Self.now))
        let last = try #require(CategoryPeriod.specificMonth.range(customStart: Self.utc(2025, 12, 31), now: Self.now))
        #expect(first == last)
        #expect(first.start == Self.utc(2025, 12, 1))
        // December rolls the exclusive end into the next year.
        #expect(first.end == Self.utc(2026, 1, 1))
    }

    @Test func specificMonthWithoutAnAnchorIsUnbounded() {
        #expect(CategoryPeriod.specificMonth.range(now: Self.now) == nil)
    }

    @Test func customRangeWithOneOpenEndStaysOpen() throws {
        let openEnded = try #require(CategoryPeriod.custom.range(customStart: Self.utc(2026, 2, 10), now: Self.now))
        #expect(openEnded.end == nil)
        #expect(openEnded.contains(Self.utc(2030, 1, 1)))

        #expect(CategoryPeriod.custom.range(now: Self.now) == nil)
    }

    @Test func prefsRoundTripThroughDefaults() throws {
        let defaults = try #require(UserDefaults(suiteName: "CategoryPeriodTests"))
        defaults.removePersistentDomain(forName: "CategoryPeriodTests")

        #expect(TopCategoryFilterStore.load(householdId: "h1", defaults: defaults) == .empty)

        let prefs = TopCategoryFilterPrefs(
            hiddenCategoryIds: ["c1", "c2"],
            period: .lastMonth,
            customStart: Self.utc(2026, 2, 1),
            customEnd: nil
        )
        TopCategoryFilterStore.save(prefs, householdId: "h1", defaults: defaults)
        #expect(TopCategoryFilterStore.load(householdId: "h1", defaults: defaults) == prefs)
        // Keyed per household — another household's categories are a different set entirely.
        #expect(TopCategoryFilterStore.load(householdId: "h2", defaults: defaults) == .empty)
    }
}
