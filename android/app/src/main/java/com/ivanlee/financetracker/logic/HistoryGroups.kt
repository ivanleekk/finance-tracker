package com.ivanlee.financetracker.logic

import java.time.Instant
import java.time.ZoneOffset
import kotlin.math.abs

/**
 * Grouping and per-group totals for the Activity list.
 *
 * Kotlin port of the web's `frontend/src/lib/historyGroups.ts` and
 * ios/FinanceTracker/Support/HistoryGroups.swift — keep all three in sync.
 *
 * The list is bucketed by day, month or year, and each section header carries the money that
 * moved inside it. Two judgement calls live here rather than in the composable, and they are
 * the same in all three clients:
 *
 *  - Transfers never count. Money moving between the household's own accounts is not income
 *    and not spending; counting it would double a day's totals. Same rule as the budget and
 *    runway rollups.
 *  - A row with no known base-currency value is left out of the totals instead of being summed
 *    at face value, and reported through [HistoryGroupSummary.unconverted] so the header can say
 *    the total is partial. A day mixing SGD and USD rows would otherwise show a number that
 *    means nothing.
 *
 * Bucketing is done in UTC, matching how the backend means these dates and how the rest of this
 * client renders them (see Formatters.kt) — a local-time grouping would push a month-end entry
 * into the wrong month for anyone west of Greenwich.
 */
enum class HistoryGranularity(val label: String) {
    DAY("Day"),
    MONTH("Month"),
    YEAR("Year"),
}

/** The four facts summing a row needs, pulled off whatever model the screen holds. */
data class HistoryEntry(
    val date: Instant,
    val isTransfer: Boolean,
    val isInflow: Boolean,
    /** Value in the household's base currency, or null when it can't be converted. */
    val homeAmount: Double?,
)

data class HistoryGroupSummary(
    val inflow: Double = 0.0,
    val outflow: Double = 0.0,
    /** Rows in the group with no base-currency value, so missing from the totals. */
    val unconverted: Int = 0,
) {
    val net: Double get() = inflow - outflow

    /** Both sides moved, so the net is worth spelling out next to them. */
    val showsNet: Boolean get() = inflow > 0 && outflow > 0
}

data class HistoryGroup<T>(
    /** Start of the bucket, in UTC — also its stable key for `LazyColumn` items. */
    val start: Instant,
    val items: List<T>,
    val summary: HistoryGroupSummary,
)

/**
 * Best guess at a row's value in the household's base currency: the figure the backend already
 * converted, or the row's own amount when it was already booked in the base currency. Anything
 * else stays null.
 */
fun homeValue(stored: Double?, nativeAmount: Double, nativeCurrency: String?, baseCurrency: String): Double? {
    if (stored != null && stored.isFinite()) return abs(stored)
    if (nativeCurrency != null && nativeCurrency == baseCurrency) return abs(nativeAmount)
    return null
}

/** Start of the day/month/year [date] falls in, in UTC. */
fun bucketStart(date: Instant, granularity: HistoryGranularity): Instant {
    val day = date.atZone(ZoneOffset.UTC).toLocalDate()
    val start = when (granularity) {
        HistoryGranularity.DAY -> day
        HistoryGranularity.MONTH -> day.withDayOfMonth(1)
        HistoryGranularity.YEAR -> day.withDayOfYear(1)
    }
    return start.atStartOfDay(ZoneOffset.UTC).toInstant()
}

fun summarizeHistory(entries: List<HistoryEntry>): HistoryGroupSummary {
    var inflow = 0.0
    var outflow = 0.0
    var unconverted = 0
    for (entry in entries) {
        if (entry.isTransfer) continue
        val amount = entry.homeAmount
        if (amount == null || !amount.isFinite()) {
            unconverted++
            continue
        }
        if (entry.isInflow) inflow += abs(amount) else outflow += abs(amount)
    }
    return HistoryGroupSummary(inflow, outflow, unconverted)
}

/** The header text for a bucket: "Today · 20 Aug" / "August 2026" / "2026". */
fun historyGroupLabel(
    start: Instant,
    granularity: HistoryGranularity,
    now: Instant = Instant.now(),
): String = when (granularity) {
    HistoryGranularity.YEAR -> start.atZone(ZoneOffset.UTC).year.toString()
    HistoryGranularity.MONTH -> start.monthYear()
    HistoryGranularity.DAY -> {
        val day = start.atZone(ZoneOffset.UTC).toLocalDate()
        val today = now.atZone(ZoneOffset.UTC).toLocalDate()
        when (day) {
            today -> "Today · ${start.shortDay()}"
            today.minusDays(1) -> "Yesterday · ${start.shortDay()}"
            else -> start.mediumDate()
        }
    }
}

/**
 * Buckets [items], keeping the incoming order of the groups and of the items inside each one —
 * feed it an already-sorted (newest-first) list and the sections come out that way too.
 */
fun <T> groupHistory(
    items: List<T>,
    granularity: HistoryGranularity,
    entry: (T) -> HistoryEntry,
): List<HistoryGroup<T>> {
    val buckets = LinkedHashMap<Instant, MutableList<T>>()
    val entries = LinkedHashMap<Instant, MutableList<HistoryEntry>>()
    for (item in items) {
        val itemEntry = entry(item)
        val start = bucketStart(itemEntry.date, granularity)
        buckets.getOrPut(start) { mutableListOf() }.add(item)
        entries.getOrPut(start) { mutableListOf() }.add(itemEntry)
    }
    return buckets.map { (start, groupItems) ->
        HistoryGroup(start, groupItems, summarizeHistory(entries[start].orEmpty()))
    }
}
