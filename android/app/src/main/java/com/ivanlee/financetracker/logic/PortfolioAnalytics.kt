package com.ivanlee.financetracker.logic

import com.ivanlee.financetracker.data.model.AssetResponse
import com.ivanlee.financetracker.data.model.PortfolioSnapshotResponse
import com.ivanlee.financetracker.data.model.SnapshotValuePoint
import java.time.DayOfWeek
import java.time.Instant
import java.time.ZoneOffset
import java.time.temporal.TemporalAdjusters

// Pure analytics behind the Portfolio screens: equity curves, allocation and FX exposure.
// Deliberately free of Compose so the Portfolio tab (household-wide) and the sub-portfolio
// detail screen share one implementation, and so the maths can be unit-tested without a
// backend or an emulator. Kotlin port of ios/FinanceTracker/Support/PortfolioAnalytics.swift
// — keep the two in sync.

/**
 * Selectable window for a growth chart. Mirrors the web `TimeframeSelector`, trimmed to the
 * four ranges that fit a phone-width segmented button row.
 */
enum class GrowthRange(val label: String, val months: Int?) {
    ONE_MONTH("1M", 1),
    SIX_MONTHS("6M", 6),
    ONE_YEAR("1Y", 12),
    ALL("ALL", null),
    ;

    /**
     * The window's opening instant, or null for [ALL] (unbounded). Shared by [equityCurve]
     * (which windows the chart) and the range-scoped `/metrics` fetch (which needs the same
     * cutoff as a `start_date` so the badge's dollar delta and percentage describe the same
     * window) — computing it twice risked the two drifting apart by a day at a month boundary.
     */
    fun cutoffDate(now: Instant = Instant.now()): Instant? =
        months?.let { now.atZone(ZoneOffset.UTC).minusMonths(it.toLong()).toInstant() }
}

/**
 * How densely an equity curve is sampled.
 *
 * The web exposes this as a manual Daily/Weekly/Monthly/Yearly control sitting next to its
 * range picker. Two adjacent selectors don't fit a phone, so this is derived from the span of
 * the data instead — which is what the control is really for: keeping the line readable
 * however far out you zoom.
 */
enum class GrowthBin { DAILY, WEEKLY, MONTHLY }

/**
 * Sampling density for a curve spanning [days]. Thresholds are roughly a quarter and a year
 * and a half, so 1M/3M stay daily, up to ~18 months goes weekly, and multi-year history
 * collapses to monthly.
 */
fun growthBin(spanDays: Double): GrowthBin {
    val days = if (spanDays.isFinite()) spanDays else 0.0
    return when {
        days <= 92 -> GrowthBin.DAILY
        days <= 550 -> GrowthBin.WEEKLY
        else -> GrowthBin.MONTHLY
    }
}

/** A (date, value) point in a value history. */
data class GoalHistoryPoint(val date: Instant, val value: Double)

/**
 * Total home-currency value per date for one sub-portfolio — or the whole household when
 * [subPortfolioId] is null — windowed to [range] and binned so long spans stay readable.
 *
 * Within a bucket the latest point wins rather than a sum or mean: an equity curve is a
 * running balance, so adding two days together would double-count and averaging would
 * understate the close. This matches the web's `binHistory`.
 *
 * All bucketing is UTC and Monday-first, matching the backend's date-only semantics — a
 * snapshot must not slide into a neighbouring bucket depending on the phone's timezone.
 */
fun <T : SnapshotValuePoint> equityCurve(
    snapshots: List<T>,
    subPortfolioId: String? = null,
    range: GrowthRange = GrowthRange.ALL,
    now: Instant = Instant.now(),
): List<GoalHistoryPoint> {
    val byDate = LinkedHashMap<Instant, Double>()
    for (snapshot in snapshots) {
        if (subPortfolioId != null && snapshot.subPortfolioId != subPortfolioId) continue
        byDate[snapshot.date] = (byDate[snapshot.date] ?: 0.0) + snapshot.value
    }

    var points = byDate.map { GoalHistoryPoint(it.key, it.value) }.sortedBy { it.date }

    range.cutoffDate(now)?.let { cutoff ->
        points = points.filter { !it.date.isBefore(cutoff) }
    }

    val first = points.firstOrNull()?.date ?: return points
    val last = points.last().date
    val spanDays = (last.epochSecond - first.epochSecond) / 86_400.0

    return when (growthBin(spanDays)) {
        GrowthBin.DAILY -> points
        GrowthBin.WEEKLY -> bin(points) { instant ->
            instant.atZone(ZoneOffset.UTC).toLocalDate()
                .with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
                .atStartOfDay(ZoneOffset.UTC).toInstant()
        }
        GrowthBin.MONTHLY -> bin(points) { instant ->
            instant.atZone(ZoneOffset.UTC).toLocalDate()
                .withDayOfMonth(1)
                .atStartOfDay(ZoneOffset.UTC).toInstant()
        }
    }
}

/** Collapses an ascending series into one point per calendar bucket, keeping the last. */
private fun bin(
    points: List<GoalHistoryPoint>,
    bucketStart: (Instant) -> Instant,
): List<GoalHistoryPoint> {
    val byBucket = LinkedHashMap<Instant, Double>()
    for (point in points) byBucket[bucketStart(point.date)] = point.value
    return byBucket.map { GoalHistoryPoint(it.key, it.value) }.sortedBy { it.date }
}

/**
 * Movement across a growth window.
 *
 * @property fraction percentage change, or null when the opening balance was too small for
 *   one to mean anything. A sub-portfolio that went from $42 to $13,104 didn't return
 *   31,100% — it got funded, and printing that number as a return is worse than printing
 *   nothing.
 */
data class PeriodChange(val delta: Double, val fraction: Double?)

/**
 * Change between the first and last point of a curve. null when there aren't two points to
 * compare. The percentage is withheld unless the opening balance is at least 1% of the
 * closing one, i.e. unless the window actually opened on a real position.
 */
fun periodChange(curve: List<GoalHistoryPoint>): PeriodChange? {
    if (curve.size < 2) return null
    val first = curve.first()
    val last = curve.last()
    val delta = last.value - first.value
    val meaningfulBase = first.value > 0 && first.value >= kotlin.math.abs(last.value) * 0.01
    return PeriodChange(delta, if (meaningfulBase) delta / first.value else null)
}

// ---- Allocation -------------------------------------------------------------------------

/** One wedge of the allocation donut: an asset type, its home-currency value, and share. */
data class AllocationSlice(val type: String, val value: Double, val pct: Double) {
    /** "time_locked" → "Time Locked" for the legend. */
    val label: String
        get() = type.replace('_', ' ').split(' ')
            .joinToString(" ") { word ->
                word.replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }
            }
}

/** One currency's share of a portfolio's value. */
data class FXSlice(val currency: String, val pct: Double)

/**
 * Holdings sliced by asset type (stock/etf/cash/…), largest first.
 *
 * Weighted by home-currency value so cross-currency holdings compare fairly. The web weights
 * by native value, which mixes units in a multi-currency portfolio — a US$1 and a ¥1 position
 * land on the same wedge size there. Deliberate divergence, shared with iOS.
 */
fun allocationSlices(
    holdings: List<PortfolioSnapshotResponse>,
    assetsById: Map<String, AssetResponse>,
): List<AllocationSlice> {
    val byType = LinkedHashMap<String, Double>()
    var total = 0.0
    for (holding in holdings) {
        val value = holding.currentValueHomeCurrency
        if (!value.isFinite()) continue
        total += value
        val type = assetsById[holding.assetId]?.type ?: "other"
        byType[type] = (byType[type] ?: 0.0) + value
    }
    if (total <= 0) return emptyList()
    return byType
        .map { AllocationSlice(it.key, it.value, it.value / total * 100) }
        .sortedByDescending { it.value }
}

/** Currency exposure of the given holdings, by each asset's own currency, as % of value. */
fun fxExposure(
    holdings: List<PortfolioSnapshotResponse>,
    assetsById: Map<String, AssetResponse>,
    fallbackCurrency: String,
): List<FXSlice> {
    val byCurrency = LinkedHashMap<String, Double>()
    var total = 0.0
    for (holding in holdings) {
        val value = holding.currentValueHomeCurrency
        if (!value.isFinite()) continue
        total += value
        val currency = assetsById[holding.assetId]?.currency ?: fallbackCurrency
        byCurrency[currency] = (byCurrency[currency] ?: 0.0) + value
    }
    if (total <= 0) return emptyList()
    return byCurrency
        .map { FXSlice(it.key, it.value / total * 100) }
        .sortedByDescending { it.pct }
}
