package com.ivanlee.financetracker.logic

import java.text.NumberFormat
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Currency
import java.util.Locale
import kotlin.math.abs

// Kotlin port of ios/FinanceTracker/Support/Formatters.swift.
//
// Deliberately built on java.text/java.time only — no android.icu — so every one of these is
// exercisable from a plain JVM unit test. The compact form is hand-rolled for the same
// reason: CompactDecimalFormat is framework-only, and a money label that can't be tested is
// a money label that quietly regresses.

private val currencyFormatCache = HashMap<String, NumberFormat>()
private val symbolCache = HashMap<String, String>()

private fun currencyFormat(code: String, fractionDigits: Int): NumberFormat {
    val key = "$code/$fractionDigits"
    return currencyFormatCache.getOrPut(key) {
        NumberFormat.getCurrencyInstance(Locale.getDefault()).apply {
            runCatching { currency = Currency.getInstance(code) }
            minimumFractionDigits = fractionDigits
            maximumFractionDigits = fractionDigits
        }
    }
}

/** The currency symbol for an ISO code ("SGD" → "S$"), falling back to the code itself. */
fun currencySymbol(code: String): String = symbolCache.getOrPut(code) {
    runCatching { Currency.getInstance(code).getSymbol(Locale.getDefault()) }.getOrNull() ?: code
}

/** "S$12,345.67" style currency string using the given ISO code. */
fun Double.currency(code: String): String {
    if (!isFinite()) return "—"
    return currencyFormat(code, 2).format(this)
}

/** Whole-dollar currency ("SGD 29,856"), matching the web goal/report pages. */
fun Double.currencyWhole(code: String): String {
    if (!isFinite()) return "—"
    return currencyFormat(code, 0).format(this)
}

/**
 * Compact currency for dashboards: "S$12.3K".
 *
 * Roughly three significant figures — one decimal place until the mantissa reaches three
 * digits, then none — so a headline number stays about six characters wide however large the
 * balance gets. A trailing ".0" is dropped, since "12K" reads better than "12.0K".
 */
fun Double.compactCurrency(code: String): String {
    if (!isFinite()) return "—"
    val symbol = currencySymbol(code)
    val magnitude = abs(this)
    val (scaled, suffix) = when {
        magnitude >= 1_000_000_000_000 -> this / 1_000_000_000_000 to "T"
        magnitude >= 1_000_000_000 -> this / 1_000_000_000 to "B"
        magnitude >= 1_000_000 -> this / 1_000_000 to "M"
        magnitude >= 1_000 -> this / 1_000 to "K"
        else -> this to ""
    }
    val digits = if (suffix.isEmpty() || abs(scaled) >= 100) 0 else 1
    var number = String.format(Locale.getDefault(), "%,.${digits}f", scaled)
    if (digits == 1 && number.endsWith(".0")) number = number.dropLast(2)
    return "$symbol$number$suffix"
}

/** "+4.2%" with sign, from a fraction (0.042). */
fun Double.signedPercent(): String {
    if (!isFinite()) return "—"
    val pct = this * 100
    val sign = if (pct >= 0) "+" else "-"
    return sign + String.format(Locale.getDefault(), "%.1f%%", abs(pct))
}

/** "4.2%" from an already-scaled percentage value (42.0 → "42.0%"). */
fun Double.percentOfHundred(decimals: Int = 1): String {
    if (!isFinite()) return "—"
    return String.format(Locale.getDefault(), "%.${decimals}f%%", this)
}

// ---- Dates ------------------------------------------------------------------------------
//
// Every formatter below renders in UTC, because every date the backend sends means a
// calendar date, not an instant. Rendering "2026-07-19" in a UTC-negative timezone would
// print the 18th — a transaction silently moving a day is not an acceptable rounding error.

private fun formatter(pattern: String): DateTimeFormatter =
    DateTimeFormatter.ofPattern(pattern, Locale.getDefault()).withZone(ZoneOffset.UTC)

private val shortDayFormat by lazy { formatter("d MMM") }
private val mediumDateFormat by lazy { formatter("d MMM yyyy") }
private val monthYearFormat by lazy { formatter("MMMM yyyy") }
private val dueMonthYearFormat by lazy { formatter("MMM yyyy") }

/** "19 Jul" */
fun Instant.shortDay(): String = shortDayFormat.format(this)

/** "19 Jul 2026" */
fun Instant.mediumDate(): String = mediumDateFormat.format(this)

/** "July 2026" */
fun Instant.monthYear(): String = monthYearFormat.format(this)

/** "Dec 2027" style label for a goal's target date (mirrors web formatDueDate). */
fun Instant.dueMonthYear(): String = dueMonthYearFormat.format(this)
