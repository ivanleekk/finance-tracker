package com.ivanlee.financetracker

import com.ivanlee.financetracker.logic.HistoryEntry
import com.ivanlee.financetracker.logic.HistoryGranularity
import com.ivanlee.financetracker.logic.groupHistory
import com.ivanlee.financetracker.logic.historyGroupLabel
import com.ivanlee.financetracker.logic.homeValue
import com.ivanlee.financetracker.logic.summarizeHistory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneOffset

/**
 * Grouping + per-section totals for the Activity list (`logic/HistoryGroups.kt`).
 * Twin of the web `frontend/src/lib/historyGroups.test.ts` and iOS's `HistoryGroupsTests.swift` —
 * the three must agree about the same numbers. Every instant is explicit UTC, since that is what
 * the bucketing means.
 */
class HistoryGroupsTest {

    private fun at(year: Int, month: Int, day: Int, hour: Int = 12): Instant =
        LocalDateTime.of(year, month, day, hour, 0).toInstant(ZoneOffset.UTC)

    private fun entry(
        date: Instant,
        isTransfer: Boolean = false,
        isInflow: Boolean = false,
        homeAmount: Double? = 10.0,
    ) = HistoryEntry(date, isTransfer, isInflow, homeAmount)

    // ---- homeValue ----------------------------------------------------------------------

    @Test
    fun `homeValue prefers the stored conversion`() {
        assertEquals(42.0, homeValue(42.0, 60.0, "USD", "SGD")!!, 0.0001)
    }

    @Test
    fun `homeValue falls back to the amount when already in base currency`() {
        assertEquals(60.0, homeValue(null, 60.0, "SGD", "SGD")!!, 0.0001)
    }

    @Test
    fun `homeValue is null for an unconverted foreign amount`() {
        assertNull(homeValue(null, 60.0, "USD", "SGD"))
        assertNull(homeValue(null, 60.0, null, "SGD"))
    }

    @Test
    fun `homeValue is always a magnitude`() {
        assertEquals(42.0, homeValue(-42.0, 0.0, null, "SGD")!!, 0.0001)
    }

    // ---- summarizeHistory ---------------------------------------------------------------

    @Test
    fun `summary splits inflow from outflow and nets them`() {
        val day = at(2026, 8, 20)
        val summary = summarizeHistory(
            listOf(
                entry(day, isInflow = true, homeAmount = 3000.0),
                entry(day, homeAmount = 42.5),
                entry(day, homeAmount = 500.0),
            ),
        )
        assertEquals(3000.0, summary.inflow, 0.0001)
        assertEquals(542.5, summary.outflow, 0.0001)
        assertEquals(2457.5, summary.net, 0.0001)
        assertTrue(summary.showsNet)
    }

    @Test
    fun `summary ignores both legs of a transfer`() {
        // Moving 1000 between your own accounts is neither income nor spending.
        val day = at(2026, 8, 20)
        val summary = summarizeHistory(
            listOf(
                entry(day, isTransfer = true, isInflow = true, homeAmount = 1000.0),
                entry(day, isTransfer = true, homeAmount = 1000.0),
                entry(day, homeAmount = 20.0),
            ),
        )
        assertEquals(0.0, summary.inflow, 0.0001)
        assertEquals(20.0, summary.outflow, 0.0001)
        assertEquals(-20.0, summary.net, 0.0001)
    }

    @Test
    fun `summary counts rows it cannot convert instead of summing them`() {
        val day = at(2026, 8, 20)
        val summary = summarizeHistory(listOf(entry(day, homeAmount = null), entry(day, homeAmount = 20.0)))
        assertEquals(20.0, summary.outflow, 0.0001)
        assertEquals(1, summary.unconverted)
    }

    @Test
    fun `summary hides the net when only one side moved`() {
        val day = at(2026, 8, 20)
        assertFalse(summarizeHistory(listOf(entry(day, homeAmount = 20.0))).showsNet)
        assertFalse(summarizeHistory(listOf(entry(day, isInflow = true, homeAmount = 20.0))).showsNet)
    }

    @Test
    fun `summary of nothing but transfers is all zeroes`() {
        val summary = summarizeHistory(listOf(entry(at(2026, 8, 20), isTransfer = true, homeAmount = 500.0)))
        assertEquals(0.0, summary.inflow, 0.0001)
        assertEquals(0.0, summary.outflow, 0.0001)
        assertEquals(0, summary.unconverted)
    }

    // ---- groupHistory -------------------------------------------------------------------

    private val sample
        get() = listOf(
            entry(at(2026, 8, 20, 10), isInflow = true, homeAmount = 100.0),
            entry(at(2026, 8, 20, 8), homeAmount = 30.0),
            entry(at(2026, 8, 19, 8), homeAmount = 12.0),
            entry(at(2026, 7, 2, 8), homeAmount = 7.0),
            entry(at(2025, 7, 2, 8), isInflow = true, homeAmount = 5.0),
        )

    @Test
    fun `groups by day with a total per day`() {
        val groups = groupHistory(sample, HistoryGranularity.DAY) { it }
        assertEquals(4, groups.size)
        assertEquals(2, groups[0].items.size)
        assertEquals(at(2026, 8, 20, 0), groups[0].start)
        assertEquals(100.0, groups[0].summary.inflow, 0.0001)
        assertEquals(30.0, groups[0].summary.outflow, 0.0001)
        assertEquals(12.0, groups[1].summary.outflow, 0.0001)
    }

    @Test
    fun `rolls the same items up by month`() {
        val groups = groupHistory(sample, HistoryGranularity.MONTH) { it }
        assertEquals(3, groups.size)
        assertEquals(at(2026, 8, 1, 0), groups[0].start)
        assertEquals(100.0, groups[0].summary.inflow, 0.0001)
        assertEquals(42.0, groups[0].summary.outflow, 0.0001)
        assertEquals(58.0, groups[0].summary.net, 0.0001)
    }

    @Test
    fun `rolls the same items up by year`() {
        val groups = groupHistory(sample, HistoryGranularity.YEAR) { it }
        assertEquals(2, groups.size)
        assertEquals(at(2026, 1, 1, 0), groups[0].start)
        assertEquals(49.0, groups[0].summary.outflow, 0.0001)
        assertEquals(51.0, groups[0].summary.net, 0.0001)
        assertEquals(5.0, groups[1].summary.inflow, 0.0001)
    }

    @Test
    fun `preserves the incoming order of groups and items`() {
        val groups = groupHistory(sample, HistoryGranularity.DAY) { it }
        assertEquals(groups.map { it.start }.sortedDescending(), groups.map { it.start })
        assertEquals(100.0, groups[0].items[0].homeAmount!!, 0.0001)
        assertEquals(30.0, groups[0].items[1].homeAmount!!, 0.0001)
    }

    @Test
    fun `groups nothing into nothing`() {
        assertTrue(groupHistory(emptyList<HistoryEntry>(), HistoryGranularity.MONTH) { it }.isEmpty())
    }

    // ---- labels -------------------------------------------------------------------------

    @Test
    fun `day labels say Today and Yesterday relative to the given now`() {
        val now = at(2026, 8, 20, 9)
        assertTrue(historyGroupLabel(at(2026, 8, 20, 0), HistoryGranularity.DAY, now).startsWith("Today · "))
        assertTrue(historyGroupLabel(at(2026, 8, 19, 0), HistoryGranularity.DAY, now).startsWith("Yesterday · "))
        val older = historyGroupLabel(at(2026, 8, 18, 0), HistoryGranularity.DAY, now)
        assertFalse(older.contains("Today"))
        assertFalse(older.contains("Yesterday"))
    }

    @Test
    fun `month and year labels never say Today or Yesterday`() {
        val now = at(2026, 8, 20, 9)
        val month = historyGroupLabel(at(2026, 8, 1, 0), HistoryGranularity.MONTH, now)
        assertFalse(month.contains("Today"))
        assertTrue(month.contains("2026"))
        assertEquals("2026", historyGroupLabel(at(2026, 1, 1, 0), HistoryGranularity.YEAR, now))
    }

    @Test
    fun `a late-evening UTC entry stays on its own day`() {
        // 23:00 UTC is the next day in +02:00; bucketing in UTC keeps it where the backend put it.
        val groups = groupHistory(listOf(entry(at(2026, 1, 31, 23))), HistoryGranularity.DAY) { it }
        assertEquals(at(2026, 1, 31, 0), groups[0].start)
    }
}
