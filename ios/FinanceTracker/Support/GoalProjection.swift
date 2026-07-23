import Foundation

// Swift port of the web's goal projection math (frontend/src/lib/goals.ts). A "goal" is a
// sub-portfolio with a target amount/date; progress and pace come from its snapshot value
// history, ETA is extrapolated from the trailing ~90 days of contributions. Keep this in
// sync with goals.ts when the projection rules change.

private let secondsPerDay: Double = 24 * 60 * 60
private let daysPerMonth: Double = 30.44

/// A (date, value) point in a goal's value history.
struct GoalHistoryPoint: Identifiable {
    let date: Date
    let value: Double
    var id: Date { date }
}

struct GoalProjection {
    var currentValue: Double
    var percentComplete: Double
    var remaining: Double
    /// Average $/month contributed over the trailing window, from snapshot value deltas.
    var monthlyPace: Double
    /// e.g. "Q4 '27", or nil with no target/no pace.
    var etaLabel: String?
    /// nil when there isn't enough data to say.
    var onTrack: Bool?
    // Target-date-aware fields; nil when the goal has no target date.
    var monthsToTarget: Double?
    var requiredPace: Double?
    var projectedAtTarget: Double?
    var shortfallAtTarget: Double?
    /// Positive = ETA lands after the target date (behind), negative = ahead.
    var etaVsTargetMonths: Int?
}

/// Sums snapshot values across all assets in a sub-portfolio, per date, ascending.
func valueHistory(for snapshots: [PortfolioSnapshotResponse], subPortfolioId: String) -> [GoalHistoryPoint] {
    var byDate: [Date: Double] = [:]
    for s in snapshots where s.subPortfolioId == subPortfolioId {
        // Coerce non-finite to 0 so nothing downstream (percentages, pace, ETA) turns NaN.
        let value = s.currentValueHomeCurrency.isFinite ? s.currentValueHomeCurrency : 0
        byDate[s.date, default: 0] += value
    }
    return byDate
        .map { GoalHistoryPoint(date: $0.key, value: $0.value) }
        .sorted { $0.date < $1.date }
}

func projectGoal(history: [GoalHistoryPoint], targetAmount: Double?, targetDate: Date?) -> GoalProjection {
    let rawCurrent = history.last?.value ?? 0
    let currentValue = rawCurrent.isFinite ? rawCurrent : 0

    // A non-finite or non-positive target isn't usable; treat it as "no target".
    var target = targetAmount
    if let t = target, !t.isFinite || t <= 0 { target = nil }

    let percentComplete = target.map { min(100, max(0, currentValue / $0 * 100)) } ?? 0
    let remaining = target.map { max(0, $0 - currentValue) } ?? 0

    // Estimate monthly contribution pace from the trailing ~90 days of snapshot history.
    var monthlyPace = 0.0
    if history.count >= 2 {
        let last = history[history.count - 1]
        let cutoff = last.date.addingTimeInterval(-90 * secondsPerDay)
        let windowStart = history.first { $0.date >= cutoff } ?? history[0]
        let days = max(1, last.date.timeIntervalSince(windowStart.date) / secondsPerDay)
        let delta = last.value - windowStart.value
        monthlyPace = (delta / days) * 30
    }

    var etaLabel: String?
    var etaTime: Date?
    if let target, monthlyPace > 0, remaining > 0 {
        let monthsToGo = remaining / monthlyPace
        let eta = Calendar.current.date(byAdding: .month, value: Int(monthsToGo.rounded(.up)), to: Date()) ?? Date()
        let comps = Calendar.current.dateComponents([.year, .month], from: eta)
        let quarter = ((comps.month ?? 1) - 1) / 3 + 1
        etaLabel = "Q\(quarter) '\(String(comps.year ?? 0).suffix(2))"
        etaTime = eta
    }

    // Target-date projections
    var monthsToTarget: Double?
    var requiredPace: Double?
    var projectedAtTarget: Double?
    var shortfallAtTarget: Double?
    var etaVsTargetMonths: Int?
    if let targetDate {
        let secondsPerMonth = daysPerMonth * secondsPerDay
        let months = max(0, targetDate.timeIntervalSinceNow / secondsPerMonth)
        monthsToTarget = months
        if let target {
            if remaining > 0 && months > 0 {
                requiredPace = remaining / months
            } else if remaining > 0 {
                requiredPace = nil
            } else {
                requiredPace = 0
            }
            let projected = currentValue + max(0, monthlyPace) * months
            projectedAtTarget = projected
            shortfallAtTarget = max(0, target - projected)
        }
        if let etaTime {
            etaVsTargetMonths = Int((etaTime.timeIntervalSince(targetDate) / secondsPerMonth).rounded())
        }
    }

    // On-track: with a target date, compare actual pace against the pace required to land
    // on time; without one, fall back to "is there any positive pace at all".
    var onTrack: Bool?
    if target != nil {
        if remaining == 0 {
            onTrack = true
        } else if targetDate != nil, let months = monthsToTarget {
            if months == 0 {
                onTrack = false // target date has passed with money still to go
            } else if let requiredPace {
                onTrack = monthlyPace >= requiredPace
            }
        } else {
            onTrack = monthlyPace > 0
        }
    }

    return GoalProjection(
        currentValue: currentValue,
        percentComplete: percentComplete,
        remaining: remaining,
        monthlyPace: monthlyPace,
        etaLabel: etaLabel,
        onTrack: onTrack,
        monthsToTarget: monthsToTarget,
        requiredPace: requiredPace,
        projectedAtTarget: projectedAtTarget,
        shortfallAtTarget: shortfallAtTarget,
        etaVsTargetMonths: etaVsTargetMonths
    )
}

extension Date {
    /// "Dec 2027" style label for a goal's target date (mirrors web formatDueDate).
    var dueMonthYear: String {
        formatted(.dateTime.month(.abbreviated).year())
    }
}
