package com.ivanlee.financetracker

import com.ivanlee.financetracker.logic.GoalHistoryPoint
import com.ivanlee.financetracker.logic.projectGoal
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

/**
 * Kotlin twin of iOS's `GoalProjectionTests` — the biggest suite there, and for the same
 * reason: this is the math a user reads as "will I make it?", and it has several branches
 * that only differ by whether a target date exists.
 *
 * Every call passes an explicit `now`, so nothing here drifts with the wall clock.
 */
class GoalProjectionTest {

    private val now: Instant = LocalDate.parse("2026-07-01").atStartOfDay(ZoneOffset.UTC).toInstant()

    private fun day(iso: String): Instant =
        LocalDate.parse(iso).atStartOfDay(ZoneOffset.UTC).toInstant()

    private fun history(vararg pairs: Pair<String, Double>): List<GoalHistoryPoint> =
        pairs.map { (date, value) -> GoalHistoryPoint(day(date), value) }

    // ---- Progress -----------------------------------------------------------------------

    @Test
    fun `percent complete and remaining come from the latest value`() {
        val p = projectGoal(history("2026-06-01" to 2500.0), targetAmount = 10_000.0, targetDate = null, now = now)
        assertEquals(25.0, p.percentComplete, 1e-9)
        assertEquals(7500.0, p.remaining, 1e-9)
        assertEquals(2500.0, p.currentValue, 1e-9)
    }

    @Test
    fun `percent complete is clamped at 100 when overfunded`() {
        val p = projectGoal(history("2026-06-01" to 15_000.0), targetAmount = 10_000.0, targetDate = null, now = now)
        assertEquals(100.0, p.percentComplete, 1e-9)
        assertEquals(0.0, p.remaining, 1e-9)
    }

    @Test
    fun `no target means no percentage and no on-track claim`() {
        val p = projectGoal(history("2026-06-01" to 2500.0), targetAmount = null, targetDate = null, now = now)
        assertEquals(0.0, p.percentComplete, 1e-9)
        assertNull(p.onTrack)
    }

    @Test
    fun `a non-positive target is treated as no target`() {
        val p = projectGoal(history("2026-06-01" to 100.0), targetAmount = 0.0, targetDate = null, now = now)
        assertEquals(0.0, p.percentComplete, 1e-9)
        assertNull(p.onTrack)
    }

    // ---- Pace ---------------------------------------------------------------------------

    @Test
    fun `monthly pace is extrapolated from the trailing window`() {
        // +3000 over 60 days ≈ +1500/month.
        val p = projectGoal(
            history("2026-05-02" to 1000.0, "2026-07-01" to 4000.0),
            targetAmount = 10_000.0,
            targetDate = null,
            now = now,
        )
        assertEquals(1500.0, p.monthlyPace, 1.0)
    }

    @Test
    fun `a single point yields no pace rather than an infinite one`() {
        val p = projectGoal(history("2026-06-01" to 1000.0), targetAmount = 10_000.0, targetDate = null, now = now)
        assertEquals(0.0, p.monthlyPace, 1e-9)
    }

    // ---- On track -----------------------------------------------------------------------

    @Test
    fun `without a target date any positive pace counts as on track`() {
        val p = projectGoal(
            history("2026-05-02" to 1000.0, "2026-07-01" to 2000.0),
            targetAmount = 10_000.0,
            targetDate = null,
            now = now,
        )
        assertTrue(p.onTrack!!)
    }

    @Test
    fun `with a target date on-track compares actual pace against required pace`() {
        // 9000 to go in ~12 months needs ~750/month; actual pace is ~500/month.
        val p = projectGoal(
            history("2026-06-01" to 500.0, "2026-07-01" to 1000.0),
            targetAmount = 10_000.0,
            targetDate = day("2027-07-01"),
            now = now,
        )
        assertFalse(p.onTrack!!)
        assertTrue(p.requiredPace!! > p.monthlyPace)
    }

    @Test
    fun `a fully funded goal is on track regardless of pace`() {
        val p = projectGoal(
            history("2026-06-01" to 10_000.0),
            targetAmount = 10_000.0,
            targetDate = day("2027-01-01"),
            now = now,
        )
        assertTrue(p.onTrack!!)
        assertEquals(0.0, p.requiredPace!!, 1e-9)
    }

    @Test
    fun `a target date already passed with money still to go is not on track`() {
        val p = projectGoal(
            history("2026-06-01" to 100.0),
            targetAmount = 10_000.0,
            targetDate = day("2026-01-01"),
            now = now,
        )
        assertFalse(p.onTrack!!)
        assertEquals(0.0, p.monthsToTarget!!, 1e-9)
    }

    // ---- Target-date projections --------------------------------------------------------

    @Test
    fun `projected value and shortfall at the target date`() {
        val p = projectGoal(
            history("2026-06-01" to 500.0, "2026-07-01" to 1000.0),
            targetAmount = 10_000.0,
            targetDate = day("2027-07-01"),
            now = now,
        )
        // ~1000 now + ~500/month × ~12 months ≈ 7000, leaving roughly 3000 short.
        assertEquals(7000.0, p.projectedAtTarget!!, 300.0)
        assertEquals(3000.0, p.shortfallAtTarget!!, 300.0)
    }

    @Test
    fun `eta label is a quarter and year`() {
        val p = projectGoal(
            history("2026-06-01" to 500.0, "2026-07-01" to 1000.0),
            targetAmount = 3000.0,
            targetDate = null,
            now = now,
        )
        assertTrue("unexpected eta: ${p.etaLabel}", p.etaLabel!!.matches(Regex("Q[1-4] '\\d{2}")))
    }

    @Test
    fun `no eta without a positive pace`() {
        val p = projectGoal(history("2026-06-01" to 500.0), targetAmount = 3000.0, targetDate = null, now = now)
        assertNull(p.etaLabel)
    }

    @Test
    fun `eta versus target is signed - positive means behind`() {
        val p = projectGoal(
            history("2026-06-01" to 500.0, "2026-07-01" to 1000.0),
            targetAmount = 10_000.0,
            targetDate = day("2026-10-01"),
            now = now,
        )
        // At ~500/month, 9000 to go lands far beyond a target three months out.
        assertTrue(p.etaVsTargetMonths!! > 0)
    }

    // ---- Robustness ---------------------------------------------------------------------

    @Test
    fun `a non-finite latest value is coerced to zero`() {
        val p = projectGoal(
            listOf(GoalHistoryPoint(day("2026-06-01"), Double.NaN)),
            targetAmount = 1000.0,
            targetDate = null,
            now = now,
        )
        assertEquals(0.0, p.currentValue, 1e-9)
    }

    @Test
    fun `empty history is a zero-progress goal, not a crash`() {
        val p = projectGoal(emptyList(), targetAmount = 1000.0, targetDate = null, now = now)
        assertEquals(0.0, p.currentValue, 1e-9)
        assertEquals(1000.0, p.remaining, 1e-9)
    }
}
