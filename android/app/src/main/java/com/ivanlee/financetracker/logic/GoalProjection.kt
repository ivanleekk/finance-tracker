package com.ivanlee.financetracker.logic

import com.ivanlee.financetracker.data.model.SnapshotValuePoint
import java.time.Instant
import java.time.ZoneOffset
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

// Kotlin port of the web's goal projection math (frontend/src/lib/goals.ts), matching
// ios/FinanceTracker/Support/GoalProjection.swift. A "goal" is a sub-portfolio with a target
// amount/date; progress and pace come from its snapshot value history, ETA is extrapolated
// from the trailing ~90 days of contributions. Keep all three in sync.

private const val SECONDS_PER_DAY = 24.0 * 60 * 60
private const val DAYS_PER_MONTH = 30.44

/**
 * Past this many months an ETA stops being a projection and becomes noise — see the clamp in
 * [projectGoal]. 100 years; the Swift twin uses the same figure.
 */
private const val MAX_PROJECTABLE_MONTHS = 1200.0

data class GoalProjection(
    val currentValue: Double,
    val percentComplete: Double,
    val remaining: Double,
    /** Average $/month contributed over the trailing window, from snapshot value deltas. */
    val monthlyPace: Double,
    /** e.g. "Q4 '27", or null with no target/no pace. */
    val etaLabel: String? = null,
    /** null when there isn't enough data to say. */
    val onTrack: Boolean? = null,
    // Target-date-aware fields; null when the goal has no target date.
    val monthsToTarget: Double? = null,
    val requiredPace: Double? = null,
    val projectedAtTarget: Double? = null,
    val shortfallAtTarget: Double? = null,
    /** Positive = ETA lands after the target date (behind), negative = ahead. */
    val etaVsTargetMonths: Int? = null,
)

/**
 * Sums values across all assets in a sub-portfolio, per date, ascending. Generic over
 * [SnapshotValuePoint] so it works with raw snapshots or the pre-aggregated `/timeseries`
 * points.
 */
fun <T : SnapshotValuePoint> valueHistory(
    snapshots: List<T>,
    subPortfolioId: String,
): List<GoalHistoryPoint> {
    val byDate = LinkedHashMap<Instant, Double>()
    for (s in snapshots) {
        if (s.subPortfolioId != subPortfolioId) continue
        byDate[s.date] = (byDate[s.date] ?: 0.0) + s.value
    }
    return byDate.map { GoalHistoryPoint(it.key, it.value) }.sortedBy { it.date }
}

fun projectGoal(
    history: List<GoalHistoryPoint>,
    targetAmount: Double?,
    targetDate: Instant?,
    now: Instant = Instant.now(),
): GoalProjection {
    val rawCurrent = history.lastOrNull()?.value ?: 0.0
    val currentValue = if (rawCurrent.isFinite()) rawCurrent else 0.0

    // A non-finite or non-positive target isn't usable; treat it as "no target".
    val target = targetAmount?.takeIf { it.isFinite() && it > 0 }

    val percentComplete = target?.let { min(100.0, max(0.0, currentValue / it * 100)) } ?: 0.0
    val remaining = target?.let { max(0.0, it - currentValue) } ?: 0.0

    // Estimate monthly contribution pace from the trailing ~90 days of snapshot history.
    var monthlyPace = 0.0
    if (history.size >= 2) {
        val last = history.last()
        val cutoff = last.date.minusSeconds((90 * SECONDS_PER_DAY).toLong())
        val windowStart = history.firstOrNull { !it.date.isBefore(cutoff) } ?: history[0]
        val days = max(1.0, (last.date.epochSecond - windowStart.date.epochSecond) / SECONDS_PER_DAY)
        val delta = last.value - windowStart.value
        monthlyPace = (delta / days) * 30
    }

    var etaLabel: String? = null
    var etaTime: Instant? = null
    if (target != null && monthlyPace > 0 && remaining > 0) {
        val monthsToGo = remaining / monthlyPace
        // A trickle against a large target produces a months count in the millions, which
        // overflows plusMonths' year field and throws DateTimeException — taking the Goals
        // screen down. Even short of that, "Q3 '4718" is noise dressed as an answer, so past
        // the cap we report no ETA at all: the same call periodChange and monthsCovered make.
        if (monthsToGo.isFinite() && monthsToGo <= MAX_PROJECTABLE_MONTHS) {
            val eta = now.atZone(ZoneOffset.UTC).plusMonths(ceil(monthsToGo).toLong()).toInstant()
            val zoned = eta.atZone(ZoneOffset.UTC)
            val quarter = (zoned.monthValue - 1) / 3 + 1
            etaLabel = "Q$quarter '${zoned.year.toString().takeLast(2)}"
            etaTime = eta
        }
    }

    var monthsToTarget: Double? = null
    var requiredPace: Double? = null
    var projectedAtTarget: Double? = null
    var shortfallAtTarget: Double? = null
    var etaVsTargetMonths: Int? = null
    if (targetDate != null) {
        val secondsPerMonth = DAYS_PER_MONTH * SECONDS_PER_DAY
        val months = max(0.0, (targetDate.epochSecond - now.epochSecond) / secondsPerMonth)
        monthsToTarget = months
        if (target != null) {
            requiredPace = when {
                remaining > 0 && months > 0 -> remaining / months
                remaining > 0 -> null
                else -> 0.0
            }
            val projected = currentValue + max(0.0, monthlyPace) * months
            projectedAtTarget = projected
            shortfallAtTarget = max(0.0, target - projected)
        }
        if (etaTime != null) {
            etaVsTargetMonths =
                ((etaTime.epochSecond - targetDate.epochSecond) / secondsPerMonth).roundToInt()
        }
    }

    // On-track: with a target date, compare actual pace against the pace required to land on
    // time; without one, fall back to "is there any positive pace at all".
    var onTrack: Boolean? = null
    if (target != null) {
        onTrack = when {
            remaining == 0.0 -> true
            targetDate != null && monthsToTarget != null -> when {
                monthsToTarget == 0.0 -> false // target date passed with money still to go
                requiredPace != null -> monthlyPace >= requiredPace
                else -> null
            }
            else -> monthlyPace > 0
        }
    }

    return GoalProjection(
        currentValue = currentValue,
        percentComplete = percentComplete,
        remaining = remaining,
        monthlyPace = monthlyPace,
        etaLabel = etaLabel,
        onTrack = onTrack,
        monthsToTarget = monthsToTarget,
        requiredPace = requiredPace,
        projectedAtTarget = projectedAtTarget,
        shortfallAtTarget = shortfallAtTarget,
        etaVsTargetMonths = etaVsTargetMonths,
    )
}
