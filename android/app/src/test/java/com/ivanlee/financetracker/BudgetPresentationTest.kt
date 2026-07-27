package com.ivanlee.financetracker

import com.ivanlee.financetracker.data.model.BudgetPeriod
import com.ivanlee.financetracker.data.model.BudgetStatusRow
import com.ivanlee.financetracker.data.model.EmergencyFundResponse
import com.ivanlee.financetracker.data.model.RecurrenceFrequency
import com.ivanlee.financetracker.data.model.RecurringTransactionResponse
import com.ivanlee.financetracker.data.model.TransactionType
import com.ivanlee.financetracker.data.model.UpcomingOccurrence
import com.ivanlee.financetracker.logic.BudgetPresentation
import com.ivanlee.financetracker.logic.BudgetTone
import com.ivanlee.financetracker.logic.RunwayTone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

/** Kotlin twin of iOS's BudgetPresentation coverage — the two clients must agree. */
class BudgetPresentationTest {

    private fun day(iso: String): Instant =
        LocalDate.parse(iso).atStartOfDay(ZoneOffset.UTC).toInstant()

    private fun row(
        spent: Double,
        limit: Double,
        projectedOver: Boolean,
        daysElapsed: Int = 10,
        daysTotal: Int = 30,
    ) = BudgetStatusRow(
        budgetId = "b1",
        categoryId = "c1",
        categoryName = "Groceries",
        period = BudgetPeriod.MONTHLY,
        isPrivate = false,
        limit = limit,
        spent = spent,
        remaining = limit - spent,
        percentUsed = spent / limit * 100,
        periodStart = day("2026-07-01"),
        periodEnd = day("2026-07-31"),
        daysElapsed = daysElapsed,
        daysTotal = daysTotal,
        projectedSpend = if (projectedOver) limit * 1.5 else limit * 0.8,
        projectedOver = projectedOver,
    )

    private fun fund(monthsCovered: Double?, target: Double = 6.0) = EmergencyFundResponse(
        householdId = "h1",
        baseCurrency = "SGD",
        asOf = day("2026-07-19"),
        liquidTotal = 10_000.0,
        averageMonthlyExpenses = 2_000.0,
        monthsCovered = monthsCovered,
        targetMonths = target,
        targetAmount = target * 2_000.0,
        shortfall = 0.0,
        monthsOfHistory = 6,
        onTrack = false,
    )

    // ---- Budget tone --------------------------------------------------------------------

    @Test
    fun `spending past the limit is over budget`() {
        assertEquals(BudgetTone.OVER, BudgetPresentation.tone(row(spent = 120.0, limit = 100.0, projectedOver = true)))
    }

    @Test
    fun `today's pace blowing the limit is at risk, even at 30 percent spent`() {
        // Warning on the 10th is the point; warning on the 30th is useless.
        assertEquals(BudgetTone.AT_RISK, BudgetPresentation.tone(row(spent = 30.0, limit = 100.0, projectedOver = true)))
    }

    @Test
    fun `on pace is ok`() {
        assertEquals(BudgetTone.OK, BudgetPresentation.tone(row(spent = 30.0, limit = 100.0, projectedOver = false)))
    }

    @Test
    fun `bar and pace fractions are clamped to 0 to 1`() {
        assertEquals(1f, BudgetPresentation.barFraction(row(200.0, 100.0, true)), 1e-6f)
        assertEquals(0f, BudgetPresentation.elapsedFraction(row(1.0, 100.0, false, daysTotal = 0)), 1e-6f)
        assertEquals(1f / 3f, BudgetPresentation.elapsedFraction(row(1.0, 100.0, false)), 1e-6f)
    }

    // ---- Runway -------------------------------------------------------------------------

    @Test
    fun `an undefined runway says so - never infinity`() {
        assertEquals("Not enough data", BudgetPresentation.runwayLabel(fund(null)))
        assertEquals(RunwayTone.UNKNOWN, BudgetPresentation.runwayTone(fund(null)))
        assertEquals(0f, BudgetPresentation.runwayFraction(fund(null)), 1e-6f)
    }

    @Test
    fun `under one month is critical`() {
        assertEquals(RunwayTone.CRITICAL, BudgetPresentation.runwayTone(fund(0.4)))
    }

    @Test
    fun `under target but over a month is low, not critical`() {
        assertEquals(RunwayTone.LOW, BudgetPresentation.runwayTone(fund(3.0)))
    }

    @Test
    fun `at or past target is ok`() {
        assertEquals(RunwayTone.OK, BudgetPresentation.runwayTone(fund(6.0)))
    }

    @Test
    fun `a very long runway is capped in the label`() {
        assertEquals("99+ months", BudgetPresentation.runwayLabel(fund(240.0)))
    }

    @Test
    fun `runway fraction is progress toward target`() {
        assertEquals(0.5f, BudgetPresentation.runwayFraction(fund(3.0)), 1e-6f)
    }

    // ---- Recurring commitments ----------------------------------------------------------

    private fun rule(amount: Double, frequency: RecurrenceFrequency, categoryId: String, active: Boolean = true) =
        RecurringTransactionResponse(
            id = "r-$categoryId-$frequency",
            householdId = "h1",
            accountId = "a1",
            categoryId = categoryId,
            amount = amount,
            frequency = frequency,
            startDate = day("2026-01-01"),
            nextDueDate = day("2026-08-01"),
            isActive = active,
        )

    @Test
    fun `cadences are normalized to one comparable monthly figure`() {
        val types = mapOf("salary" to TransactionType.INCOME, "rent" to TransactionType.EXPENSE)
        val result = BudgetPresentation.monthlyCommitment(
            listOf(
                rule(6000.0, RecurrenceFrequency.MONTHLY, "salary"),
                rule(2000.0, RecurrenceFrequency.MONTHLY, "rent"),
                rule(120.0, RecurrenceFrequency.WEEKLY, "rent"), // ≈ 520/month
            ),
            types,
        )
        assertEquals(6000.0, result.income, 1e-9)
        assertEquals(2520.0, result.expense, 1.0)
        assertEquals(3480.0, result.net, 1.0)
    }

    @Test
    fun `paused rules are not a commitment`() {
        val result = BudgetPresentation.monthlyCommitment(
            listOf(rule(2000.0, RecurrenceFrequency.MONTHLY, "rent", active = false)),
            mapOf("rent" to TransactionType.EXPENSE),
        )
        assertEquals(0.0, result.expense, 1e-9)
    }

    // ---- Agenda -------------------------------------------------------------------------

    private fun occurrence(date: String, amount: Double, type: TransactionType) = UpcomingOccurrence(
        recurringTransactionId = "r1",
        description = null,
        categoryName = "Rent",
        accountName = "Checking",
        date = day(date),
        amount = amount,
        currency = "SGD",
        transactionType = type,
    )

    @Test
    fun `net upcoming is income minus expenses`() {
        val net = BudgetPresentation.netUpcoming(
            listOf(
                occurrence("2026-08-01", 6000.0, TransactionType.INCOME),
                occurrence("2026-08-02", 2000.0, TransactionType.EXPENSE),
            )
        )
        assertEquals(4000.0, net, 1e-9)
    }

    @Test
    fun `occurrences bucket by calendar month, oldest first`() {
        val buckets = BudgetPresentation.groupedByMonth(
            listOf(
                occurrence("2026-09-03", 1.0, TransactionType.EXPENSE),
                occurrence("2026-08-31", 2.0, TransactionType.EXPENSE),
                occurrence("2026-08-01", 3.0, TransactionType.EXPENSE),
            )
        )
        assertEquals(listOf("2026-08", "2026-09"), buckets.map { it.id })
        assertEquals(2, buckets[0].items.size)
        // The 31st is August in UTC — a local-time bucket would push it into September for
        // anyone east of Greenwich.
        assertTrue(buckets[0].label.startsWith("August"))
    }
}
