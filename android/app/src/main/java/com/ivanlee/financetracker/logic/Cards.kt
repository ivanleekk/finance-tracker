package com.ivanlee.financetracker.logic

import com.ivanlee.financetracker.data.model.CardCategoryResponse
import com.ivanlee.financetracker.data.model.CardLimitStatusRow
import com.ivanlee.financetracker.data.model.CardResponse
import com.ivanlee.financetracker.data.model.CardStatusResponse
import com.ivanlee.financetracker.data.model.LimitDirection
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

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
     * rendering it in the device zone shifts it a day west of Greenwich.
     */
    fun cycleLabel(start: Instant, end: Instant, locale: Locale = Locale.getDefault()): String {
        val formatter = DateTimeFormatter.ofPattern("d MMM", locale).withZone(ZoneOffset.UTC)
        return "${formatter.format(start)} – ${formatter.format(end)}"
    }

    /**
     * Headroom for each of a card's categories, keyed by category id.
     *
     * The status endpoint reports limits, but the picker is a list of
     * *categories* — and several categories can share one limit, so this fans the
     * limit back out over the categories pointing at it. A category with no limit
     * gets no entry rather than a zero, because "unmetered" and "nothing left"
     * must not look the same.
     */
    fun headroomByCategory(
        card: CardResponse,
        status: CardStatusResponse,
    ): Map<String, CardLimitStatusRow> {
        val byLimit = status.limits.associateBy { it.limitId }
        val out = mutableMapOf<String, CardLimitStatusRow>()
        for (category in card.categories) {
            // An unmetered category has no limit id, which matches nothing here
            // and is skipped by the same lookup that skips a limit missing from
            // the payload — no separate guard needed.
            val row = category.limitId?.let { byLimit[it] } ?: continue
            out[category.id] = row
        }
        return out
    }

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

    /** "Dining · $240 left" when metered, otherwise just the name. */
    fun categoryLabel(
        category: CardCategoryResponse,
        headroom: Map<String, CardLimitStatusRow>,
        formatAmount: (Double) -> String,
    ): String {
        val row = headroom[category.id] ?: return category.name
        return "${category.name} · ${headroomLabel(row, formatAmount)}"
    }
}
