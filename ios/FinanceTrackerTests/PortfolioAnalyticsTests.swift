import Foundation
import Testing
@testable import FinanceTracker

/// `Support/PortfolioAnalytics.swift` backs both the household-wide Portfolio tab and the
/// per-sub-portfolio detail screen, so a mistake here misstates money on two screens at
/// once. All of it is pure given snapshots + assets, so it's exercised directly.
struct PortfolioAnalyticsTests {

    // MARK: Fixtures

    /// UTC, matching the calendar the analytics bin with, so a test never depends on where
    /// the machine running it happens to be.
    private static let utc: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return calendar
    }()

    private func day(_ year: Int, _ month: Int, _ day: Int) -> Date {
        Self.utc.date(from: DateComponents(year: year, month: month, day: day))!
    }

    private func snapshot(
        sub: String = "sp-1",
        asset: String = "a-1",
        date: Date,
        quantity: Double = 1,
        price: Double = 1,
        value: Double,
        costBasis: Double = 0
    ) -> PortfolioSnapshotResponse {
        PortfolioSnapshotResponse(
            id: UUID().uuidString,
            householdId: "hh-1",
            subPortfolioId: sub,
            assetId: asset,
            date: date,
            quantity: quantity,
            price: price,
            exchangeRateUsed: 1,
            currentValueHomeCurrency: value,
            averageCostBasis: costBasis,
            averageCostBasisHomeCurrency: costBasis
        )
    }

    private func asset(_ id: String, type: String, currency: String = "USD") -> AssetResponse {
        AssetResponse(id: id, ticker: id.uppercased(), name: id, type: type, currency: currency, pricingMode: "market")
    }

    // MARK: equityCurve — aggregation

    @Test func sumsAssetsWithinADateAndSortsAscending() {
        let curve = equityCurve(snapshots: [
            snapshot(asset: "a-2", date: day(2026, 3, 2), value: 40),
            snapshot(asset: "a-1", date: day(2026, 3, 1), value: 100),
            snapshot(asset: "a-2", date: day(2026, 3, 1), value: 50),
        ])
        #expect(curve.map(\.value) == [150, 40])
        #expect(curve[0].date < curve[1].date)
    }

    @Test func scopesToOneSubPortfolioWhenAsked() {
        let snapshots = [
            snapshot(sub: "sp-1", date: day(2026, 3, 1), value: 100),
            snapshot(sub: "sp-2", date: day(2026, 3, 1), value: 900),
        ]
        #expect(equityCurve(snapshots: snapshots, subPortfolioId: "sp-1").map(\.value) == [100])
        // Omitting the id keeps everything — that's how the household-wide chart is built.
        #expect(equityCurve(snapshots: snapshots).map(\.value) == [1000])
    }

    @Test func nonFiniteValuesCoerceToZeroRatherThanPoisoningTheCurve() {
        let curve = equityCurve(snapshots: [
            snapshot(asset: "a-1", date: day(2026, 3, 1), value: .nan),
            snapshot(asset: "a-2", date: day(2026, 3, 1), value: 25),
        ])
        #expect(curve.map(\.value) == [25])
    }

    @Test func emptySnapshotsGiveAnEmptyCurve() {
        #expect(equityCurve(snapshots: [PortfolioSnapshotResponse]()).isEmpty)
    }

    // MARK: equityCurve — range window

    @Test func rangeDropsPointsOlderThanTheWindow() {
        let now = day(2026, 6, 15)
        let snapshots = [
            snapshot(date: day(2026, 1, 10), value: 10),
            snapshot(date: day(2026, 6, 1), value: 20),
            snapshot(date: day(2026, 6, 14), value: 30),
        ]
        #expect(equityCurve(snapshots: snapshots, range: .oneMonth, now: now).map(\.value) == [20, 30])
        #expect(equityCurve(snapshots: snapshots, range: .sixMonths, now: now).map(\.value) == [10, 20, 30])
        #expect(equityCurve(snapshots: snapshots, range: .all, now: now).map(\.value) == [10, 20, 30])
    }

    @Test func allRangeHasNoCutoff() {
        #expect(GrowthRange.all.months == nil)
        #expect(GrowthRange.oneMonth.months == 1)
        #expect(GrowthRange.sixMonths.months == 6)
        #expect(GrowthRange.oneYear.months == 12)
    }

    // MARK: Binning

    @Test func binThresholds() {
        #expect(growthBin(forSpanDays: 0) == .daily)
        #expect(growthBin(forSpanDays: 92) == .daily)
        #expect(growthBin(forSpanDays: 93) == .weekly)
        #expect(growthBin(forSpanDays: 550) == .weekly)
        #expect(growthBin(forSpanDays: 551) == .monthly)
    }

    @Test func shortSpansStayDaily() {
        // 30 consecutive days: span 29 → under the daily threshold, nothing collapses.
        let snapshots = (0..<30).map {
            snapshot(date: day(2026, 3, 1).addingTimeInterval(Double($0) * 86_400), value: Double($0))
        }
        let curve = equityCurve(snapshots: snapshots)
        #expect(curve.count == 30)
        #expect(curve.last?.value == 29)
    }

    @Test func mediumSpansCollapseToMondayWeeksKeepingTheLatestInEachWeek() {
        // 2026-01-01 .. 2026-05-01 inclusive = 121 points spanning 120 days → weekly.
        let start = day(2026, 1, 1)
        let snapshots = (0..<121).map {
            snapshot(date: start.addingTimeInterval(Double($0) * 86_400), value: Double($0))
        }
        let curve = equityCurve(snapshots: snapshots)
        #expect(curve.count == 18)
        // Jan 1 2026 is a Thursday, so its Monday-start week begins in the prior year.
        #expect(curve.first?.date == day(2025, 12, 29))
        // A running balance is a level, not a total: the last reading in the week wins.
        #expect(curve.first?.value == 3)   // Sun 2026-01-04 is index 3
        #expect(curve.last?.value == 120)  // the final point is always preserved
    }

    @Test func longSpansCollapseToMonths() {
        // 701 points spanning 700 days → past the weekly threshold.
        let start = day(2026, 1, 1)
        let snapshots = (0..<701).map {
            snapshot(date: start.addingTimeInterval(Double($0) * 86_400), value: Double($0))
        }
        let curve = equityCurve(snapshots: snapshots)
        #expect(curve.count == 24)
        #expect(curve.first?.date == day(2026, 1, 1))
        #expect(curve.last?.value == 700)
    }

    // MARK: periodChange

    @Test func periodChangeNeedsTwoPoints() {
        #expect(periodChange(for: []) == nil)
        #expect(periodChange(for: [GoalHistoryPoint(date: day(2026, 3, 1), value: 10)]) == nil)
    }

    @Test func periodChangeIsFirstToLast() throws {
        let curve = [
            GoalHistoryPoint(date: day(2026, 3, 1), value: 200),
            GoalHistoryPoint(date: day(2026, 3, 2), value: 50),   // interior points don't matter
            GoalHistoryPoint(date: day(2026, 3, 3), value: 250),
        ]
        let change = try #require(periodChange(for: curve))
        #expect(change.delta == 50)
        #expect(abs(try #require(change.fraction) - 0.25) < 1e-9)
    }

    @Test func periodChangeFromZeroReportsNoPercentRatherThanInfinity() throws {
        let curve = [
            GoalHistoryPoint(date: day(2026, 3, 1), value: 0),
            GoalHistoryPoint(date: day(2026, 3, 2), value: 500),
        ]
        let change = try #require(periodChange(for: curve))
        #expect(change.delta == 500)
        #expect(change.fraction == nil)
    }

    @Test func periodChangeWithholdsPercentWhenTheWindowOpenedOnNearlyNothing() throws {
        // The real case this guards: a goal funded from $42 to $13,104 is not a +31,100%
        // return, and printing that as one is worse than printing no percentage at all.
        let change = try #require(periodChange(for: [
            GoalHistoryPoint(date: day(2026, 3, 1), value: 42),
            GoalHistoryPoint(date: day(2026, 3, 2), value: 13_104),
        ]))
        #expect(change.delta == 13_062)
        #expect(change.fraction == nil)
    }

    @Test func periodChangeKeepsPercentForASmallButRealStartingPosition() throws {
        // $100 → $200 is a genuine double; the guard must not swallow ordinary returns.
        let change = try #require(periodChange(for: [
            GoalHistoryPoint(date: day(2026, 3, 1), value: 100),
            GoalHistoryPoint(date: day(2026, 3, 2), value: 200),
        ]))
        #expect(abs(try #require(change.fraction) - 1.0) < 1e-9)
    }

    @Test func periodChangeReportsLossesWithAPercent() throws {
        let change = try #require(periodChange(for: [
            GoalHistoryPoint(date: day(2026, 3, 1), value: 1_000),
            GoalHistoryPoint(date: day(2026, 3, 2), value: 800),
        ]))
        #expect(change.delta == -200)
        #expect(abs(try #require(change.fraction) + 0.2) < 1e-9)
    }

    // MARK: Allocation

    @Test func allocationGroupsByAssetTypeLargestFirst() {
        let assets = ["etf": asset("etf", type: "etf"), "bond": asset("bond", type: "bond"), "cash": asset("cash", type: "cash")]
        let slices = allocationSlices(
            holdings: [
                snapshot(asset: "bond", date: day(2026, 3, 1), value: 200),
                snapshot(asset: "etf", date: day(2026, 3, 1), value: 500),
                snapshot(asset: "cash", date: day(2026, 3, 1), value: 300),
            ],
            assetsById: assets
        )
        #expect(slices.map(\.type) == ["etf", "cash", "bond"])
        #expect(slices.map(\.pct) == [50, 30, 20])
        #expect(abs(slices.reduce(0) { $0 + $1.pct } - 100) < 1e-9)
    }

    @Test func allocationCombinesHoldingsOfTheSameType() {
        let assets = ["a": asset("a", type: "stock"), "b": asset("b", type: "stock")]
        let slices = allocationSlices(
            holdings: [
                snapshot(asset: "a", date: day(2026, 3, 1), value: 30),
                snapshot(asset: "b", date: day(2026, 3, 1), value: 70),
            ],
            assetsById: assets
        )
        #expect(slices.count == 1)
        #expect(slices[0].value == 100)
    }

    @Test func allocationFallsBackToOtherForUnknownAssets() {
        let slices = allocationSlices(
            holdings: [snapshot(asset: "ghost", date: day(2026, 3, 1), value: 10)],
            assetsById: [:]
        )
        #expect(slices.map(\.type) == ["other"])
    }

    @Test func allocationIsEmptyWhenThereIsNothingToDivide() {
        #expect(allocationSlices(holdings: [], assetsById: [:]).isEmpty)
        // A zero total would divide by zero rather than produce meaningless wedges.
        #expect(allocationSlices(
            holdings: [snapshot(date: day(2026, 3, 1), value: 0)],
            assetsById: [:]
        ).isEmpty)
    }

    @Test func allocationLabelHumanisesTheBackendType() {
        #expect(AllocationSlice(type: "time_locked", value: 1, pct: 100).label == "Time Locked")
        #expect(AllocationSlice(type: "etf", value: 1, pct: 100).label == "Etf")
    }

    // MARK: FX exposure

    @Test func fxExposureGroupsByAssetCurrency() {
        let assets = [
            "us": asset("us", type: "etf", currency: "USD"),
            "sg": asset("sg", type: "etf", currency: "SGD"),
            "sg2": asset("sg2", type: "bond", currency: "SGD"),
        ]
        let fx = fxExposure(
            holdings: [
                snapshot(asset: "us", date: day(2026, 3, 1), value: 250),
                snapshot(asset: "sg", date: day(2026, 3, 1), value: 500),
                snapshot(asset: "sg2", date: day(2026, 3, 1), value: 250),
            ],
            assetsById: assets,
            fallbackCurrency: "SGD"
        )
        #expect(fx.map(\.currency) == ["SGD", "USD"])
        #expect(fx.map(\.pct) == [75, 25])
    }

    @Test func fxExposureUsesTheFallbackForUnknownAssets() {
        let fx = fxExposure(
            holdings: [snapshot(asset: "ghost", date: day(2026, 3, 1), value: 10)],
            assetsById: [:],
            fallbackCurrency: "EUR"
        )
        #expect(fx.map(\.currency) == ["EUR"])
        #expect(fx[0].pct == 100)
    }

    @Test func fxExposureIsEmptyWithoutValue() {
        #expect(fxExposure(holdings: [], assetsById: [:], fallbackCurrency: "USD").isEmpty)
    }

    /// Matches PortfolioAnalyticsTest.kt: a non-finite span must not fall through to the
    /// coarsest bin, which would silently flatten a chart.
    @Test func growthBinTreatsNonFiniteSpanAsDaily() {
        #expect(growthBin(forSpanDays: .nan) == .daily)
        #expect(growthBin(forSpanDays: .infinity) == .daily)
    }
}
