package com.ivanlee.financetracker

import com.ivanlee.financetracker.logic.compactCurrency
import com.ivanlee.financetracker.logic.currency
import com.ivanlee.financetracker.logic.currencyWhole
import com.ivanlee.financetracker.logic.dueMonthYear
import com.ivanlee.financetracker.logic.mediumDate
import com.ivanlee.financetracker.logic.monthYear
import com.ivanlee.financetracker.logic.percentOfHundred
import com.ivanlee.financetracker.logic.shortDay
import com.ivanlee.financetracker.logic.signedPercent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/**
 * Kotlin twin of iOS's `FormattersTests`.
 *
 * Date output is asserted exactly — those formatters are pinned to UTC on purpose, and that
 * is the whole behaviour under test. Currency output gets structural checks only: the digit
 * grouping and symbol placement come from the JVM's locale data, not from us, and asserting
 * on them would make the suite fail on a machine with a different default locale.
 */
class FormattersTest {

    private val summerAfternoon: Instant = Instant.parse("2026-07-19T14:30:00Z")

    /** 23:30 UTC is already "tomorrow" anywhere east of Greenwich. */
    private val lateNight: Instant = Instant.parse("2026-07-19T23:30:00Z")

    // ---- Dates: exact, and UTC ----------------------------------------------------------

    @Test
    fun `short day is day and abbreviated month`() {
        assertEquals("19 Jul", summerAfternoon.shortDay())
    }

    @Test
    fun `medium date includes the year`() {
        assertEquals("19 Jul 2026", summerAfternoon.mediumDate())
    }

    @Test
    fun `month and year are spelled out`() {
        assertEquals("July 2026", summerAfternoon.monthYear())
    }

    @Test
    fun `a goal due date is abbreviated month and year`() {
        assertEquals("Jul 2026", summerAfternoon.dueMonthYear())
    }

    @Test
    fun `late-night UTC does not roll a date forward`() {
        // Rendering in local time would print the 20th east of Greenwich, silently moving a
        // transaction a day. Every date formatter here is UTC to prevent exactly that.
        assertEquals("19 Jul 2026", lateNight.mediumDate())
    }

    // ---- Percentages: exact, they're ours ------------------------------------------------

    @Test
    fun `signed percent carries an explicit plus`() {
        assertTrue(0.042.signedPercent().startsWith("+"))
        assertTrue((-0.042).signedPercent().startsWith("-"))
    }

    @Test
    fun `percent of hundred formats an already-scaled value`() {
        assertEquals("42.0%", 42.0.percentOfHundred())
        assertEquals("3.50%", 3.5.percentOfHundred(2))
    }

    @Test
    fun `non-finite values render as an em dash rather than NaN`() {
        assertEquals("—", Double.NaN.signedPercent())
        assertEquals("—", Double.POSITIVE_INFINITY.percentOfHundred())
        assertEquals("—", Double.NaN.currency("USD"))
        assertEquals("—", Double.NaN.compactCurrency("USD"))
        assertEquals("—", Double.NaN.currencyWhole("USD"))
    }

    // ---- Currency: structural ------------------------------------------------------------

    @Test
    fun `currency keeps two decimal places`() {
        val text = 1234.5.currency("USD")
        assertTrue(text, text.contains("1") && text.contains("50"))
    }

    @Test
    fun `whole currency drops the decimals`() {
        val text = 29_856.4.currencyWhole("USD")
        assertTrue(text, !text.contains(".4"))
    }

    @Test
    fun `compact currency abbreviates by magnitude`() {
        assertTrue(12_300.0.compactCurrency("USD").endsWith("K"))
        assertTrue(4_500_000.0.compactCurrency("USD").endsWith("M"))
        assertTrue(2_100_000_000.0.compactCurrency("USD").endsWith("B"))
        assertTrue(3_400_000_000_000.0.compactCurrency("USD").endsWith("T"))
    }

    @Test
    fun `compact currency below a thousand carries no suffix`() {
        val text = 850.0.compactCurrency("USD")
        assertTrue(text, text.none { it in "KMBT" })
    }

    @Test
    fun `compact currency drops the fraction once the mantissa hits double digits`() {
        // 12.3K keeps a decimal; 123K doesn't — a headline number shouldn't sprawl.
        assertTrue(12_300.0.compactCurrency("USD").contains("."))
        assertTrue(!123_000.0.compactCurrency("USD").contains("."))
    }

    @Test
    fun `negative compact values keep their sign`() {
        assertTrue((-12_300.0).compactCurrency("USD").contains("-"))
    }
}
