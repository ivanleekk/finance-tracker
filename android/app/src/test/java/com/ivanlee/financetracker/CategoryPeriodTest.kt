package com.ivanlee.financetracker

import com.ivanlee.financetracker.logic.CategoryPeriod
import com.ivanlee.financetracker.logic.range
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneOffset

/**
 * The Top-Categories period window. Every case passes an explicit `now` so nothing drifts with the
 * wall clock, and dates are built in UTC — the boundaries themselves are UTC by design.
 *
 * Twin of iOS's `CategoryPeriodTests`; the two must agree case for case.
 */
class CategoryPeriodTest {
    private fun utc(year: Int, month: Int, day: Int, hour: Int = 0): Instant =
        LocalDateTime.of(year, month, day, hour, 0).toInstant(ZoneOffset.UTC)

    /** Mid-March, deliberately not on a boundary. */
    private val now = utc(2026, 3, 17, 11)

    @Test
    fun `all time is unbounded`() {
        assertNull(CategoryPeriod.ALL.range(now = now))
    }

    @Test
    fun `this month starts at the first and has no end`() {
        val range = CategoryPeriod.THIS_MONTH.range(now = now)!!
        assertEquals(utc(2026, 3, 1), range.start)
        assertNull(range.end)
        assertTrue(utc(2026, 3, 1) in range)
        assertFalse(utc(2026, 2, 28) in range)
    }

    @Test
    fun `last month ends exclusively at this month's first`() {
        val range = CategoryPeriod.LAST_MONTH.range(now = now)!!
        assertEquals(utc(2026, 2, 1), range.start)
        assertEquals(utc(2026, 3, 1), range.end)
        assertTrue(utc(2026, 2, 28) in range)
        // The 1st of the current month belongs to *this* month, not last.
        assertFalse(utc(2026, 3, 1) in range)
        assertFalse(utc(2026, 1, 31) in range)
    }

    /** "Last 3 months" is inclusive of the current one — Jan, Feb, Mar from a March `now`. */
    @Test
    fun `last N months include the current month`() {
        assertEquals(utc(2026, 1, 1), CategoryPeriod.LAST_3_MONTHS.range(now = now)!!.start)
        assertNull(CategoryPeriod.LAST_3_MONTHS.range(now = now)!!.end)
        assertEquals(utc(2025, 10, 1), CategoryPeriod.LAST_6_MONTHS.range(now = now)!!.start)
    }

    @Test
    fun `this year starts at January first`() {
        val range = CategoryPeriod.THIS_YEAR.range(now = now)!!
        assertEquals(utc(2026, 1, 1), range.start)
        assertFalse(utc(2025, 12, 31) in range)
    }

    /**
     * The picked end date is inclusive to the user, so the exclusive bound is the following
     * midnight — otherwise a transaction dated on the end day would silently drop out of its own
     * range.
     */
    @Test
    fun `custom range includes the whole end day`() {
        val range = CategoryPeriod.CUSTOM.range(
            customStart = utc(2026, 2, 10, 9),
            customEnd = utc(2026, 2, 20, 15),
            now = now,
        )!!
        assertEquals(utc(2026, 2, 10), range.start)
        assertEquals(utc(2026, 2, 21), range.end)
        assertTrue(utc(2026, 2, 10) in range)
        assertTrue(utc(2026, 2, 20, 23) in range)
        assertFalse(utc(2026, 2, 21) in range)
        assertFalse(utc(2026, 2, 9, 23) in range)
    }

    /** "Choose which month" from the issue: the anchor's day is irrelevant, only its year/month. */
    @Test
    fun `specific month covers exactly that month`() {
        val range = CategoryPeriod.SPECIFIC_MONTH.range(customStart = utc(2026, 2, 17, 13), now = now)!!
        assertEquals(utc(2026, 2, 1), range.start)
        assertEquals(utc(2026, 3, 1), range.end)
        assertTrue(utc(2026, 2, 1) in range)
        assertTrue(utc(2026, 2, 28, 23) in range)
        assertFalse(utc(2026, 3, 1) in range)
        assertFalse(utc(2026, 1, 31) in range)
    }

    /** Any day in the month picks the same window — the picker only surfaces month+year. */
    @Test
    fun `specific month ignores the anchor day`() {
        val first = CategoryPeriod.SPECIFIC_MONTH.range(customStart = utc(2025, 12, 1), now = now)!!
        val last = CategoryPeriod.SPECIFIC_MONTH.range(customStart = utc(2025, 12, 31), now = now)!!
        assertEquals(first, last)
        assertEquals(utc(2025, 12, 1), first.start)
        // December rolls the exclusive end into the next year.
        assertEquals(utc(2026, 1, 1), first.end)
    }

    @Test
    fun `specific month without an anchor is unbounded`() {
        assertNull(CategoryPeriod.SPECIFIC_MONTH.range(now = now))
    }

    @Test
    fun `custom range with one open end stays open`() {
        val openEnded = CategoryPeriod.CUSTOM.range(customStart = utc(2026, 2, 10), now = now)!!
        assertNull(openEnded.end)
        assertTrue(utc(2030, 1, 1) in openEnded)

        assertNull(CategoryPeriod.CUSTOM.range(now = now))
    }

    @Test
    fun `wire values survive an unknown or missing stored value`() {
        assertEquals(CategoryPeriod.LAST_6_MONTHS, CategoryPeriod.fromWire("last_6_months"))
        assertEquals(CategoryPeriod.ALL, CategoryPeriod.fromWire(null))
        assertEquals(CategoryPeriod.ALL, CategoryPeriod.fromWire("since_the_dawn_of_time"))
    }
}
