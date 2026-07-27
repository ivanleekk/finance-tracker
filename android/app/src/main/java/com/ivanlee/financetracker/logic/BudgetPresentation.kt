package com.ivanlee.financetracker.logic

import com.ivanlee.financetracker.data.model.BudgetStatusRow
import com.ivanlee.financetracker.data.model.EmergencyFundResponse
import com.ivanlee.financetracker.data.model.RecurringTransactionResponse
import com.ivanlee.financetracker.data.model.TransactionType
import com.ivanlee.financetracker.data.model.UpcomingOccurrence
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Kotlin port of the web's `frontend/src/lib/budgets.ts` and
 * ios/FinanceTracker/Support/BudgetPresentation.swift — keep all three in sync.
 *
 * These are the judgement calls the UI depends on: when a budget counts as "at risk" rather
 * than merely spent, and what to say when the runway is undefined rather than infinite.
 * Keeping them here (not in a composable) makes them testable and keeps every client saying
 * the same thing about the same numbers.
 */
enum class BudgetTone(val label: String) {
    OVER("Over budget"),
    AT_RISK("On pace to overspend"),
    OK("On track"),
}

enum class RunwayTone { UNKNOWN, CRITICAL, LOW, OK }

object BudgetPresentation {

    /**
     * A budget is "at risk" when today's pace would blow the limit even though it hasn't yet.
     * Flagging that early is the whole point of the projection — telling someone they
     * overspent on the 30th is useless.
     */
    fun tone(row: BudgetStatusRow): BudgetTone = when {
        row.spent > row.limit -> BudgetTone.OVER
        row.projectedOver -> BudgetTone.AT_RISK
        else -> BudgetTone.OK
    }

    /** Fraction of the limit used, clamped to 0..1 for bar widths. */
    fun barFraction(row: BudgetStatusRow): Float {
        if (!row.percentUsed.isFinite()) return 0f
        return (row.percentUsed / 100).coerceIn(0.0, 1.0).toFloat()
    }

    /** How far through the period we are, 0..1. Drives the pace marker. */
    fun elapsedFraction(row: BudgetStatusRow): Float {
        if (row.daysTotal <= 0) return 0f
        return (row.daysElapsed.toDouble() / row.daysTotal).coerceIn(0.0, 1.0).toFloat()
    }

    /**
     * What to show for the runway headline.
     *
     * A null `monthsCovered` means no spending has been recorded — an undefined runway, not
     * an infinite one. Saying "∞ months" to someone who simply hasn't logged expenses yet is
     * false reassurance.
     */
    fun runwayLabel(fund: EmergencyFundResponse): String {
        val months = fund.monthsCovered
        if (months == null || !months.isFinite()) return "Not enough data"
        if (months >= 99) return "99+ months"
        return String.format(Locale.US, "%.1f months", months)
    }

    /**
     * Under one month is critical, under target is low. Deliberately about absolute survival
     * time, not just progress to target: three months of cash is genuinely fine even against
     * a twelve-month goal.
     */
    fun runwayTone(fund: EmergencyFundResponse): RunwayTone {
        val months = fund.monthsCovered
        if (months == null || !months.isFinite()) return RunwayTone.UNKNOWN
        return when {
            months < 1 -> RunwayTone.CRITICAL
            months < fund.targetMonths -> RunwayTone.LOW
            else -> RunwayTone.OK
        }
    }

    /** Progress toward the target, 0..1, for the runway bar. */
    fun runwayFraction(fund: EmergencyFundResponse): Float {
        val months = fund.monthsCovered
        if (months == null || !months.isFinite() || fund.targetMonths <= 0) return 0f
        return (months / fund.targetMonths).coerceIn(0.0, 1.0).toFloat()
    }

    /**
     * Net effect of the upcoming occurrences: income minus expenses. Tells the user whether
     * the period ahead is already committed to more than it brings in.
     */
    fun netUpcoming(occurrences: List<UpcomingOccurrence>): Double =
        occurrences.fold(0.0) { total, item ->
            if (!item.amount.isFinite()) total
            else total + if (item.transactionType == TransactionType.INCOME) item.amount else -item.amount
        }

    data class MonthlyCommitment(val income: Double, val expense: Double) {
        val net: Double get() = income - expense
    }

    /**
     * Normalize active rules of different cadences into one comparable "per month" figure,
     * split by direction.
     */
    fun monthlyCommitment(
        rules: List<RecurringTransactionResponse>,
        categoryTypes: Map<String, TransactionType>,
    ): MonthlyCommitment {
        var income = 0.0
        var expense = 0.0
        for (rule in rules) {
            if (!rule.isActive) continue
            val value = rule.amount * rule.frequency.occurrencesPerMonth
            if (!value.isFinite()) continue
            if (categoryTypes[rule.categoryId] == TransactionType.INCOME) income += value
            else expense += value
        }
        return MonthlyCommitment(income, expense)
    }

    data class MonthBucket(
        val id: String,
        val label: String,
        val items: List<UpcomingOccurrence>,
    )

    private val monthYear: DateTimeFormatter =
        DateTimeFormatter.ofPattern("MMMM yyyy", Locale.getDefault()).withZone(ZoneOffset.UTC)

    /**
     * Upcoming occurrences bucketed by calendar month, oldest first, for a readable agenda.
     * Bucketing is UTC so an occurrence can't drift into a neighbouring month by timezone
     * (same rule as the growth charts).
     */
    fun groupedByMonth(occurrences: List<UpcomingOccurrence>): List<MonthBucket> {
        val buckets = LinkedHashMap<String, MutableList<UpcomingOccurrence>>()
        for (item in occurrences) {
            val zoned = item.date.atZone(ZoneOffset.UTC)
            val key = String.format(Locale.US, "%04d-%02d", zoned.year, zoned.monthValue)
            buckets.getOrPut(key) { mutableListOf() }.add(item)
        }
        return buckets.keys.sorted().map { key ->
            val items = buckets.getValue(key).sortedBy { it.date }
            MonthBucket(key, monthYear.format(items.first().date), items)
        }
    }
}
