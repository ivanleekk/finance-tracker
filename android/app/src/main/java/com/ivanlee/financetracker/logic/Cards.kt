package com.ivanlee.financetracker.logic

import com.ivanlee.financetracker.data.model.CardCategoryResponse
import com.ivanlee.financetracker.data.model.CardLimitResponse
import com.ivanlee.financetracker.data.model.CardLimitStatusRow
import com.ivanlee.financetracker.data.model.CardResponse
import com.ivanlee.financetracker.data.model.CardStatusResponse
import com.ivanlee.financetracker.data.model.LimitDirection
import com.ivanlee.financetracker.data.model.LimitResetBasis
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

/** One row of the limit "Resets" picker. */
data class ResetOption(val basis: LimitResetBasis, val label: String, val isAvailable: Boolean)

const val ANNIVERSARY_HINT =
    "Set the card's anniversary first — under Edit card — to reset on the card year or card quarter."

/** Anniversary resets are unavailable until the card has a date; the picker leaves them out. */
fun resetOptions(hasAnniversary: Boolean): List<ResetOption> = listOf(
    ResetOption(LimitResetBasis.CYCLE, "Each statement cycle", true),
    ResetOption(LimitResetBasis.CALENDAR_MONTH, "Each calendar month", true),
    ResetOption(LimitResetBasis.QUARTER, "Each quarter", true),
    ResetOption(LimitResetBasis.YEAR, "Each year", true),
    ResetOption(LimitResetBasis.CARD_YEAR, "Each card year", hasAnniversary),
    ResetOption(LimitResetBasis.CARD_QUARTER, "Each card quarter", hasAnniversary),
)

/**
 * Kotlin port of the web's `frontend/src/lib/cards.ts` and iOS's
 * `Support/Cards.swift` — the three must agree about the same numbers.
 *
 * The bar width and the pace marker are deliberately *not* here:
 * [CardLimitStatusRow] has the same percentUsed / daysElapsed / daysTotal shape
 * as a budget row, so [BudgetPresentation]'s fractions already read it. What is
 * card-specific is the direction — whether the number is a cap to stay under or
 * a minimum to reach — and that changes both the tone and the wording.
 */
object Cards {

    enum class Tone { OVER, AT_RISK, OK }

    /**
     * How a limit should read right now.
     *
     * A ceiling and a floor invert: reaching the number is the failure for a cap
     * and the goal for a minimum, so `settled` means opposite things and only a
     * ceiling can ever be [Tone.OVER]. Both share [Tone.AT_RISK], which is the
     * state worth showing — a warning after the cycle closes is useless.
     */
    fun tone(row: CardLimitStatusRow): Tone {
        if (row.direction == LimitDirection.FLOOR) {
            return if (row.settled) Tone.OK
            else if (row.projectedMissed) Tone.AT_RISK
            else Tone.OK
        }
        if (row.settled) return Tone.OVER
        return if (row.projectedMissed) Tone.AT_RISK else Tone.OK
    }

    /**
     * The short status a person actually reads, e.g. "$240 left" or "$120 to go".
     *
     * This is the string that goes in the category picker at entry, which is the
     * one moment the number can still change a decision.
     */
    fun headroomLabel(row: CardLimitStatusRow, formatAmount: (Double) -> String): String =
        if (row.direction == LimitDirection.FLOOR) {
            if (row.settled) "Minimum met" else "${formatAmount(row.remaining)} to go"
        } else {
            if (row.settled) "Cap reached" else "${formatAmount(row.remaining)} left"
        }

    /**
     * The cycle window, worded for a header: "19 Aug – 18 Sep".
     *
     * Formatted in UTC, like everything else that renders a backend calendar
     * date — a cycle boundary is a fact about the card, not an instant, and
     * rendering it in the device zone shifts it a day west of Greenwich. A window
     * crossing into another year says which years, or a card year reads
     * "14 Sep – 13 Sep" — a window of either one day or one year.
     */
    fun cycleLabel(start: Instant, end: Instant, locale: Locale = Locale.getDefault()): String {
        val crossesYear = start.atZone(ZoneOffset.UTC).year != end.atZone(ZoneOffset.UTC).year
        val formatter = DateTimeFormatter.ofPattern(if (crossesYear) "d MMM yyyy" else "d MMM", locale)
            .withZone(ZoneOffset.UTC)
        return "${formatter.format(start)} – ${formatter.format(end)}"
    }

    /**
     * A limit's own window, worded like the card's cycle — or null when it is the
     * card's cycle.
     *
     * The card header shows the statement cycle, which is right for most limits
     * and wrong for the rest: a monthly minimum and an annual cap on the same
     * category sit side by side, and reading both against the cycle makes the
     * annual one look wildly over pace. Only the ones that differ are labelled.
     */
    fun limitWindowLabel(
        row: CardLimitStatusRow,
        status: CardStatusResponse,
        locale: Locale = Locale.getDefault(),
    ): String? {
        if (row.periodStart == status.cycleStart && row.periodEnd == status.cycleEnd) return null
        return cycleLabel(row.periodStart, row.periodEnd, locale)
    }

    /**
     * Every limit each of a card's categories counts towards, keyed by category id.
     *
     * The status endpoint reports limits, but the picker is a list of
     * *categories* — so this fans each limit back out over the categories
     * counting towards it. A category can count towards several, so each gets a
     * list in the status payload's order, which is most urgent first. A category
     * with no limit gets no entry rather than an empty list, because "unmetered"
     * and "nothing left" must not look the same.
     */
    fun headroomByCategory(status: CardStatusResponse): Map<String, List<CardLimitStatusRow>> {
        val out = linkedMapOf<String, MutableList<CardLimitStatusRow>>()
        for (row in status.limits) {
            for (categoryId in row.categoryIds) {
                out.getOrPut(categoryId) { mutableListOf() }.add(row)
            }
        }
        return out
    }

    /**
     * Whether any limit counts this category. Read from the card's limits rather
     * than the status, so Manage can say "unmetered" without a status fetch.
     */
    fun isMetered(categoryId: String, limits: List<CardLimitResponse>): Boolean =
        limits.any { categoryId in it.categoryIds }

    /**
     * A limit with no categories pointing at it measures nothing.
     *
     * A setup mistake rather than a state worth rendering as a meter: the user
     * made a cap and never said what counts towards it. Left alone it draws a
     * perfectly plausible "0 of $1,000" bar and reads as "nothing spent yet",
     * which is the one thing it must not be mistaken for.
     */
    fun measuresNothing(row: CardLimitStatusRow): Boolean = row.categoryNames.isEmpty()

    /**
     * The limits worth interrupting someone about — burst, or on pace to be.
     *
     * Used for the dashboard's exception row, which shows nothing at all when
     * everything is fine.
     */
    fun needingAttention(rows: List<CardLimitStatusRow>): List<CardLimitStatusRow> =
        rows.filter { tone(it) != Tone.OK }

    /**
     * A card category's picker label: its name, then every limit it counts
     * towards — "Dining · $300 to go · $11,000 left".
     */
    fun categoryLabel(
        category: CardCategoryResponse,
        headroom: Map<String, List<CardLimitStatusRow>>,
        formatAmount: (Double) -> String,
    ): String =
        (listOf(category.name) + headroom[category.id].orEmpty().map { headroomLabel(it, formatAmount) })
            .joinToString(" · ")
}
