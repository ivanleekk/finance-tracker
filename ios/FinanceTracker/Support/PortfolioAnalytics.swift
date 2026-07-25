import Foundation

// Pure analytics behind the Portfolio screens: equity curves, allocation and FX exposure.
// Deliberately free of SwiftUI so `PortfolioView` (household-wide) and
// `SubPortfolioDetailView` (one sub-portfolio) share a single implementation, and so the
// maths can be unit-tested without a backend or a simulator.

/// Selectable window for a growth chart. Mirrors the web `TimeframeSelector`, trimmed to
/// the four ranges that fit a phone-width segmented control.
enum GrowthRange: String, CaseIterable, Identifiable {
    case oneMonth = "1M"
    case sixMonths = "6M"
    case oneYear = "1Y"
    case all = "ALL"

    var id: String { rawValue }

    /// Months of history to keep; nil keeps everything.
    var months: Int? {
        switch self {
        case .oneMonth: 1
        case .sixMonths: 6
        case .oneYear: 12
        case .all: nil
        }
    }
}

/// How densely an equity curve is sampled.
///
/// The web exposes this as a manual Daily/Weekly/Monthly/Yearly control sitting next to its
/// range picker. Two adjacent selectors don't fit a phone, so this is derived from the span
/// of the data instead — which is what the control is really for: keeping the line readable
/// however far out you zoom.
enum GrowthBin {
    case daily, weekly, monthly
}

/// UTC, so bucketing matches the backend's date-only semantics (see `Date.apiDateOnly`) and
/// a snapshot can't slide into a neighbouring bucket depending on the device's timezone.
/// Monday-first to match the web's `binHistory`.
private let analyticsCalendar: Calendar = {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    calendar.firstWeekday = 2
    return calendar
}()

/// Sampling density for a curve spanning `days`. Thresholds are roughly a quarter and a
/// year and a half, so 1M/3M stay daily, up to ~18 months goes weekly, and multi-year
/// history collapses to monthly.
func growthBin(forSpanDays days: Double) -> GrowthBin {
    if days <= 92 { return .daily }
    if days <= 550 { return .weekly }
    return .monthly
}

/// Total home-currency value per date for one sub-portfolio — or the whole household when
/// `subPortfolioId` is nil — windowed to `range` and binned so long spans stay readable.
///
/// Within a bucket the latest point wins rather than a sum or mean: an equity curve is a
/// running balance, so adding two days together would double-count and averaging would
/// understate the close. This matches the web's `binHistory`.
func equityCurve(
    snapshots: [PortfolioSnapshotResponse],
    subPortfolioId: String? = nil,
    range: GrowthRange = .all,
    now: Date = Date()
) -> [GoalHistoryPoint] {
    var byDate: [Date: Double] = [:]
    for snapshot in snapshots {
        if let subPortfolioId, snapshot.subPortfolioId != subPortfolioId { continue }
        // Coerce non-finite to 0 so nothing downstream (deltas, percentages) turns NaN.
        let value = snapshot.currentValueHomeCurrency.isFinite ? snapshot.currentValueHomeCurrency : 0
        byDate[snapshot.date, default: 0] += value
    }

    var points = byDate
        .map { GoalHistoryPoint(date: $0.key, value: $0.value) }
        .sorted { $0.date < $1.date }

    if let months = range.months,
       let cutoff = analyticsCalendar.date(byAdding: .month, value: -months, to: now) {
        points = points.filter { $0.date >= cutoff }
    }

    guard let first = points.first?.date, let last = points.last?.date else { return points }

    switch growthBin(forSpanDays: last.timeIntervalSince(first) / 86_400) {
    case .daily: return points
    case .weekly: return bin(points, by: .weekOfYear)
    case .monthly: return bin(points, by: .month)
    }
}

/// Collapses an ascending series into one point per calendar bucket, keeping the last.
private func bin(_ points: [GoalHistoryPoint], by component: Calendar.Component) -> [GoalHistoryPoint] {
    var byBucket: [Date: Double] = [:]
    for point in points {
        guard let start = analyticsCalendar.dateInterval(of: component, for: point.date)?.start else { continue }
        byBucket[start] = point.value
    }
    return byBucket
        .map { GoalHistoryPoint(date: $0.key, value: $0.value) }
        .sorted { $0.date < $1.date }
}

/// Movement across a growth window.
struct PeriodChange {
    let delta: Double
    /// Percentage change, or nil when the opening balance was too small for one to mean
    /// anything. A sub-portfolio that went from $42 to $13,104 didn't return 31,100% — it
    /// got funded, and printing that number as a return is worse than printing nothing.
    let fraction: Double?
}

/// Change between the first and last point of a curve. nil when there aren't two points to
/// compare. The percentage is withheld unless the opening balance is at least 1% of the
/// closing one, i.e. unless the window actually opened on a real position.
func periodChange(for curve: [GoalHistoryPoint]) -> PeriodChange? {
    guard let first = curve.first, let last = curve.last, curve.count > 1 else { return nil }
    let delta = last.value - first.value
    let isMeaningfulBase = first.value > 0 && first.value >= abs(last.value) * 0.01
    return PeriodChange(delta: delta, fraction: isMeaningfulBase ? delta / first.value : nil)
}

// MARK: - Allocation

/// One wedge of the allocation donut: an asset type, its home-currency value, and share.
struct AllocationSlice: Identifiable {
    let type: String
    let value: Double
    let pct: Double
    var id: String { type }

    /// "time_locked" → "Time Locked" for the legend.
    var label: String {
        type.replacingOccurrences(of: "_", with: " ")
            .split(separator: " ")
            .map { $0.prefix(1).uppercased() + $0.dropFirst() }
            .joined(separator: " ")
    }
}

/// One currency's share of a portfolio's value.
struct FXSlice: Identifiable {
    let currency: String
    let pct: Double
    var id: String { currency }
}

/// Holdings sliced by asset type (stock/etf/cash/…), largest first.
///
/// Weighted by home-currency value so cross-currency holdings compare fairly. The web
/// weights by native value, which mixes units in a multi-currency portfolio — a US$1 and a
/// ¥1 position land on the same wedge size there. Deliberate divergence.
func allocationSlices(
    holdings: [PortfolioSnapshotResponse],
    assetsById: [String: AssetResponse]
) -> [AllocationSlice] {
    var byType: [String: Double] = [:]
    var total = 0.0
    for holding in holdings {
        let value = holding.currentValueHomeCurrency
        guard value.isFinite else { continue }
        total += value
        byType[assetsById[holding.assetId]?.type ?? "other", default: 0] += value
    }
    guard total > 0 else { return [] }
    return byType
        .map { AllocationSlice(type: $0.key, value: $0.value, pct: $0.value / total * 100) }
        .sorted { $0.value > $1.value }
}

/// Currency exposure of the given holdings, by each asset's own currency, as % of value.
func fxExposure(
    holdings: [PortfolioSnapshotResponse],
    assetsById: [String: AssetResponse],
    fallbackCurrency: String
) -> [FXSlice] {
    var byCurrency: [String: Double] = [:]
    var total = 0.0
    for holding in holdings {
        let value = holding.currentValueHomeCurrency
        guard value.isFinite else { continue }
        total += value
        byCurrency[assetsById[holding.assetId]?.currency ?? fallbackCurrency, default: 0] += value
    }
    guard total > 0 else { return [] }
    return byCurrency
        .map { FXSlice(currency: $0.key, pct: $0.value / total * 100) }
        .sorted { $0.pct > $1.pct }
}
