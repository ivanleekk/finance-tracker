package com.ivanlee.financetracker.logic

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

/**
 * The date window the Activity screen's "Top Categories" card is scoped to.
 *
 * Kotlin port of the web's `CategoryPeriodPreset`
 * (`frontend/src/pages/Transactions/Transactions.tsx`) and iOS's `Support/CategoryPeriod.swift`.
 * [wire] matches the web's stored strings so all three clients name the same window the same way.
 */
enum class CategoryPeriod(val wire: String, val label: String) {
    ALL("all", "All time"),
    THIS_MONTH("this_month", "This month"),
    LAST_MONTH("last_month", "Last month"),
    LAST_3_MONTHS("last_3_months", "Last 3 months"),
    LAST_6_MONTHS("last_6_months", "Last 6 months"),
    THIS_YEAR("this_year", "This year"),
    SPECIFIC_MONTH("specific_month", "Specific month"),
    CUSTOM("custom", "Custom range"),
    ;

    /** Whether this case needs the custom start/end dates filled in to mean anything. */
    val usesCustomStart: Boolean get() = this == CUSTOM || this == SPECIFIC_MONTH

    companion object {
        fun fromWire(value: String?): CategoryPeriod =
            entries.firstOrNull { it.wire == value } ?: ALL
    }
}

/**
 * A half-open window: [start] inclusive, [end] **exclusive**. Either side may be null, meaning
 * unbounded in that direction.
 */
data class CategoryPeriodRange(val start: Instant?, val end: Instant?) {
    operator fun contains(date: Instant): Boolean {
        if (start != null && date < start) return false
        if (end != null && date >= end) return false
        return true
    }
}

/**
 * The window to filter by, or null for "no filter at all" ([CategoryPeriod.ALL], or a custom range
 * with neither end filled in).
 *
 * Boundaries are computed in **UTC**, the same rule the rest of this client follows: backend
 * transaction dates are naive and read back as UTC, so a local-calendar month boundary would push
 * the 1st of the month into the previous bucket for anyone west of Greenwich.
 */
fun CategoryPeriod.range(
    customStart: Instant? = null,
    customEnd: Instant? = null,
    now: Instant = Instant.now(),
): CategoryPeriodRange? {
    val today = now.atZone(ZoneOffset.UTC).toLocalDate()
    fun monthStart(offset: Long): Instant =
        today.withDayOfMonth(1).plusMonths(offset).atStartOfDay(ZoneOffset.UTC).toInstant()

    fun startOfDay(instant: Instant): Instant =
        instant.atZone(ZoneOffset.UTC).toLocalDate().atStartOfDay(ZoneOffset.UTC).toInstant()

    return when (this) {
        CategoryPeriod.ALL -> null
        CategoryPeriod.THIS_MONTH -> CategoryPeriodRange(monthStart(0), null)
        CategoryPeriod.LAST_MONTH -> CategoryPeriodRange(monthStart(-1), monthStart(0))
        CategoryPeriod.LAST_3_MONTHS -> CategoryPeriodRange(monthStart(-2), null)
        CategoryPeriod.LAST_6_MONTHS -> CategoryPeriodRange(monthStart(-5), null)
        CategoryPeriod.THIS_YEAR -> CategoryPeriodRange(
            LocalDate.of(today.year, 1, 1).atStartOfDay(ZoneOffset.UTC).toInstant(),
            null,
        )
        CategoryPeriod.SPECIFIC_MONTH -> {
            // `customStart` doubles as the month anchor — only its year/month are read, so any
            // day within the month selects that whole month. Reusing the field keeps the saved
            // preferences one shape rather than adding a third date that's null most of the time.
            if (customStart == null) {
                null
            } else {
                val anchor = customStart.atZone(ZoneOffset.UTC).toLocalDate().withDayOfMonth(1)
                CategoryPeriodRange(
                    anchor.atStartOfDay(ZoneOffset.UTC).toInstant(),
                    anchor.plusMonths(1).atStartOfDay(ZoneOffset.UTC).toInstant(),
                )
            }
        }
        CategoryPeriod.CUSTOM -> {
            val start = customStart?.let { startOfDay(it) }
            // The end date the user picked is inclusive, so the exclusive bound is the next midnight.
            val end = customEnd?.let { startOfDay(it).plus(java.time.Duration.ofDays(1)) }
            if (start == null && end == null) null else CategoryPeriodRange(start, end)
        }
    }
}

/**
 * The user's saved Top-Categories filter for one household: which categories are hidden and which
 * period is selected. Persisted so it survives leaving the tab, matching the web's localStorage.
 */
data class TopCategoryFilterPrefs(
    val hiddenCategoryIds: Set<String> = emptySet(),
    val period: CategoryPeriod = CategoryPeriod.ALL,
    val customStart: Instant? = null,
    val customEnd: Instant? = null,
)
