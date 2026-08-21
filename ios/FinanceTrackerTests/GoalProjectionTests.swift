import Foundation
import Testing
@testable import FinanceTracker

/// Tests for the goal projection math (`Support/GoalProjection.swift`), the Swift port of
/// the web `frontend/src/lib/goals.ts`. These are the app's most logic-dense functions and
/// the easiest to get subtly wrong, so they carry the bulk of the unit coverage.
///
/// Fields derived purely from `history` + `targetAmount` (percent, remaining, pace, and
/// the no-target-date `onTrack`) are fully deterministic. Fields that lean on `Date()` /
/// `timeIntervalSinceNow` (ETA, monthsToTarget, requiredPace) are asserted with tolerance.
struct GoalProjectionTests {

    // Fixed reference clock so history-only fields never depend on the wall clock.
    private static let day: TimeInterval = 24 * 60 * 60
    private let anchor = Date(timeIntervalSince1970: 1_700_000_000) // 2023-11-14

    private func point(_ daysAgo: Double, _ value: Double) -> GoalHistoryPoint {
        GoalHistoryPoint(date: anchor.addingTimeInterval(-daysAgo * Self.day), value: value)
    }

    // MARK: percentComplete / remaining

    @Test func percentAndRemainingWithTarget() {
        let history = [point(90, 0), point(0, 6_000)]
        let p = projectGoal(history: history, targetAmount: 10_000, targetDate: nil)
        #expect(abs(p.currentValue - 6_000) < 0.001)
        #expect(abs(p.percentComplete - 60) < 0.001)
        #expect(abs(p.remaining - 4_000) < 0.001)
    }

    @Test func percentClampsToHundredWhenOverfunded() {
        let history = [point(0, 15_000)]
        let p = projectGoal(history: history, targetAmount: 10_000, targetDate: nil)
        #expect(p.percentComplete == 100)
        #expect(p.remaining == 0)
    }

    @Test func noTargetYieldsZeroPercentAndRemaining() {
        let history = [point(0, 5_000)]
        let p = projectGoal(history: history, targetAmount: nil, targetDate: nil)
        #expect(p.percentComplete == 0)
        #expect(p.remaining == 0)
        #expect(p.onTrack == nil) // no target → can't say
    }

    @Test func nonPositiveTargetTreatedAsNoTarget() {
        let history = [point(0, 5_000)]
        let zero = projectGoal(history: history, targetAmount: 0, targetDate: nil)
        let negative = projectGoal(history: history, targetAmount: -100, targetDate: nil)
        #expect(zero.percentComplete == 0)
        #expect(zero.onTrack == nil)
        #expect(negative.percentComplete == 0)
        #expect(negative.onTrack == nil)
    }

    // MARK: monthlyPace (deterministic — uses absolute history dates)

    @Test func monthlyPaceFromNinetyDayWindow() {
        // 300 gained over exactly 90 days → (300/90)*30 = 100/month.
        let history = [point(90, 0), point(0, 300)]
        let p = projectGoal(history: history, targetAmount: 10_000, targetDate: nil)
        #expect(abs(p.monthlyPace - 100) < 0.001)
    }

    @Test func monthlyPaceUsesOnlyTrailingNinetyDays() {
        // A point older than 90 days must be excluded from the window; the window starts
        // at the first point on/after the cutoff (here the 60-day-ago point at 400).
        let history = [point(200, 0), point(60, 400), point(0, 1_000)]
        let p = projectGoal(history: history, targetAmount: 10_000, targetDate: nil)
        // delta = 1000 - 400 = 600 over 60 days → (600/60)*30 = 300.
        #expect(abs(p.monthlyPace - 300) < 0.001)
    }

    @Test func monthlyPaceZeroWithSinglePoint() {
        let p = projectGoal(history: [point(0, 5_000)], targetAmount: 10_000, targetDate: nil)
        #expect(p.monthlyPace == 0)
    }

    @Test func monthlyPaceCanBeNegativeWhenValueFell() {
        let history = [point(90, 1_000), point(0, 700)]
        let p = projectGoal(history: history, targetAmount: 10_000, targetDate: nil)
        #expect(p.monthlyPace < 0)
        // No target date + non-positive pace → not on track.
        #expect(p.onTrack == false)
    }

    // MARK: onTrack (no target date)

    @Test func onTrackWithPositivePaceAndNoTargetDate() {
        let history = [point(90, 0), point(0, 300)]
        let p = projectGoal(history: history, targetAmount: 10_000, targetDate: nil)
        #expect(p.onTrack == true)
    }

    @Test func alreadyFundedIsOnTrack() {
        let history = [point(0, 12_000)]
        let p = projectGoal(history: history, targetAmount: 10_000, targetDate: Date().addingTimeInterval(30 * Self.day))
        #expect(p.remaining == 0)
        #expect(p.onTrack == true)
    }

    // MARK: NaN / non-finite hardening (mirrors the web coercion-to-0 behaviour)

    @Test func nonFiniteCurrentValueCoercedToZero() {
        let history = [GoalHistoryPoint(date: anchor, value: .nan)]
        let p = projectGoal(history: history, targetAmount: 10_000, targetDate: nil)
        #expect(p.currentValue == 0)
        #expect(p.percentComplete == 0)
    }

    @Test func nonFiniteTargetTreatedAsNoTarget() {
        let history = [point(0, 5_000)]
        let p = projectGoal(history: history, targetAmount: .infinity, targetDate: nil)
        #expect(p.percentComplete == 0)
        #expect(p.onTrack == nil)
    }

    @Test func emptyHistoryIsSafe() {
        let p = projectGoal(history: [], targetAmount: 10_000, targetDate: nil)
        #expect(p.currentValue == 0)
        #expect(p.percentComplete == 0)
        #expect(p.remaining == 10_000)
        #expect(p.monthlyPace == 0)
    }

    // MARK: target-date-aware fields (tolerance-based, relative to now)

    @Test func requiredPaceAndMonthsToTarget() {
        // 6 months out, 6000 remaining → ~1000/month required.
        let targetDate = Date().addingTimeInterval(6 * 30.44 * Self.day)
        let history = [point(90, 0), point(0, 4_000)]
        let p = projectGoal(history: history, targetAmount: 10_000, targetDate: targetDate)
        #expect(p.monthsToTarget != nil)
        #expect(abs((p.monthsToTarget ?? 0) - 6) < 0.2)
        #expect(p.requiredPace != nil)
        #expect(abs((p.requiredPace ?? 0) - 1_000) < 40)
    }

    @Test func behindPaceWhenActualBelowRequired() {
        // Need ~1000/month but only contributing ~100/month → behind.
        let targetDate = Date().addingTimeInterval(6 * 30.44 * Self.day)
        let history = [point(90, 0), point(0, 4_000)] // slow: ~1333/month? recompute below
        // Use a genuinely slow pace: 60 gained over 90 days.
        let slow = [point(90, 3_940), point(0, 4_000)]
        let p = projectGoal(history: slow, targetAmount: 10_000, targetDate: targetDate)
        #expect(p.onTrack == false)
        #expect((p.shortfallAtTarget ?? 0) > 0)
        _ = history
    }

    @Test func onTrackWhenPaceMeetsRequirement() {
        let targetDate = Date().addingTimeInterval(6 * 30.44 * Self.day)
        // ~2000/month pace, only 6000 remaining over 6 months (needs ~1000) → ahead.
        let fast = [point(90, 0), point(0, 6_000)]
        let p = projectGoal(history: fast, targetAmount: 10_000, targetDate: targetDate)
        #expect(p.onTrack == true)
    }

    @Test func passedTargetDateWithRemainingIsNotOnTrack() {
        let targetDate = Date().addingTimeInterval(-30 * Self.day) // a month ago
        let history = [point(90, 0), point(0, 4_000)]
        let p = projectGoal(history: history, targetAmount: 10_000, targetDate: targetDate)
        #expect(p.monthsToTarget == 0)
        #expect(p.onTrack == false)
    }

    @Test func etaLabelPresentWhenProgressing() {
        let history = [point(90, 0), point(0, 3_000)]
        let p = projectGoal(history: history, targetAmount: 10_000, targetDate: nil)
        // Positive pace + remaining → an ETA quarter label like "Q3 '24".
        #expect(p.etaLabel != nil)
        #expect(p.etaLabel?.hasPrefix("Q") == true)
    }

    // MARK: valueHistory aggregation

    @Test func valueHistorySumsByDateAndSortsAscending() {
        let d1 = anchor
        let d2 = anchor.addingTimeInterval(Self.day)
        let snaps = [
            makeSnapshot(sub: "goal-1", date: d2, value: 100),
            makeSnapshot(sub: "goal-1", date: d1, value: 40),
            makeSnapshot(sub: "goal-1", date: d1, value: 60), // same date → summed with 40
            makeSnapshot(sub: "other", date: d1, value: 999), // different sub → excluded
        ]
        let history = valueHistory(for: snaps, subPortfolioId: "goal-1")
        #expect(history.count == 2)
        #expect(history[0].date == d1)
        #expect(abs(history[0].value - 100) < 0.001) // 40 + 60
        #expect(history[1].date == d2)
        #expect(abs(history[1].value - 100) < 0.001)
    }

    @Test func valueHistoryCoercesNonFiniteToZero() {
        let snaps = [
            makeSnapshot(sub: "g", date: anchor, value: .nan),
            makeSnapshot(sub: "g", date: anchor, value: 50),
        ]
        let history = valueHistory(for: snaps, subPortfolioId: "g")
        #expect(history.count == 1)
        #expect(abs(history[0].value - 50) < 0.001)
    }

    // Builds a snapshot with an arbitrary home-currency value; other money fields are 0.
    private func makeSnapshot(sub: String, date: Date, value: Double) -> PortfolioSnapshotResponse {
        PortfolioSnapshotResponse(
            id: UUID().uuidString,
            householdId: "hh",
            subPortfolioId: sub,
            assetId: "a",
            date: date,
            quantity: 1,
            price: 1,
            exchangeRateUsed: 1,
            currentValueHomeCurrency: value,
            averageCostBasis: 0,
            averageCostBasisHomeCurrency: 0
        )
    }

    // MARK: ETA horizon clamp
    //
    // A near-zero pace against a large target produces a months count in the millions.
    // `Int(_:)` traps on a Double that large, so this used to be a crash rather than a bad
    // label. Now injectable, `now` also makes these deterministic.

    @Test func reportsNoETAWhenThePaceWouldTakeLongerThanACentury() {
        // One cent of progress over 90 days against a 1,000,000 target.
        let projection = projectGoal(
            history: [point(90, 0), point(0, 0.01)],
            targetAmount: 1_000_000,
            targetDate: nil,
            now: anchor
        )
        #expect(projection.monthlyPace > 0)
        #expect(projection.etaLabel == nil)
    }

    @Test func stillReportsAnETAWithinTheHorizon() {
        let projection = projectGoal(
            history: [point(90, 0), point(0, 3000)],
            targetAmount: 20000,
            targetDate: nil,
            now: anchor
        )
        let label = try? #require(projection.etaLabel)
        #expect(label?.hasPrefix("Q") == true)
    }

    /// The ETA quarter is derived in UTC, matching the Kotlin twin — a local calendar would
    /// report a different quarter for an ETA landing on a quarter boundary.
    @Test func etaDoesNotCrashOnAnExtremeTargetWithATargetDate() {
        #expect(throws: Never.self) {
            _ = projectGoal(
                history: [point(90, 0), point(0, 0.000001)],
                targetAmount: 5_000_000,
                targetDate: anchor.addingTimeInterval(365 * Self.day),
                now: anchor
            )
        }
    }
}
