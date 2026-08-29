package com.ivanlee.financetracker.logic

import com.ivanlee.financetracker.data.model.CounterpartyBalanceResponse
import com.ivanlee.financetracker.data.model.CounterpartyDirection

/**
 * Splitting a bill, and reading back who owes whom.
 *
 * The rule that matters: the amount on a transaction is the whole sum that left the account,
 * because that is what happened. Splitting it does not shrink it — it records how much of it was
 * somebody else's, so the budget charges you for your share while the bank still shows the full
 * payment.
 *
 * A port of `frontend/src/lib/reimbursements.ts` and
 * `ios/FinanceTracker/Support/Reimbursements.swift`; keep the three in step.
 */
sealed interface SplitAssessment {
    /** Not enough entered yet to say anything. */
    data object Incomplete : SplitAssessment

    /** Entered, but it cannot mean what it says. */
    data class Invalid(val reason: String) : SplitAssessment

    data class Valid(val yourShare: Double, val owed: Double) : SplitAssessment
}

/** One person's share of a bill being split — a counterparty id and an amount. */
data class SplitEntry(val counterpartyId: String, val amount: Double?)

object Reimbursements {

    /**
     * What a proposed split works out to, across everyone in it.
     *
     * `owed` is the sum of every entry's amount. Owing more than the bill in total is rejected
     * rather than clamped: it is a typo, and silently correcting it would hide the mistake
     * behind a plausible number. The same rejection covers a single entry with no amount yet —
     * a half-filled row is not a valid split.
     */
    fun assessSplit(amount: Double?, entries: List<SplitEntry>): SplitAssessment {
        if (amount == null || !amount.isFinite() || amount <= 0) return SplitAssessment.Incomplete
        if (entries.isEmpty()) return SplitAssessment.Incomplete
        if (entries.any { it.amount == null || !it.amount.isFinite() || it.amount <= 0 }) {
            return SplitAssessment.Incomplete
        }
        val ids = entries.map { it.counterpartyId }
        if (ids.toSet().size != ids.size) {
            return SplitAssessment.Invalid("The same person can't appear twice in one split.")
        }
        val owed = entries.sumOf { it.amount ?: 0.0 }
        if (owed > amount) {
            return SplitAssessment.Invalid("They can't owe more than the bill, combined.")
        }
        return SplitAssessment.Valid(yourShare = amount - owed, owed = owed)
    }

    /**
     * Given a bill amount, the entries with an explicit amount already typed, and the entries
     * left to fill in, divides what's left evenly across the rest. Mirrors cashshare's `/add`
     * semantics: specify some people's shares by hand, and everyone else splits the remainder
     * equally.
     */
    fun evenSplitRemainder(amount: Double, specified: List<Double>, remainingCount: Int): Double? {
        if (remainingCount <= 0) return null
        val specifiedTotal = specified.sum()
        val remainder = amount - specifiedTotal
        if (remainder <= 0) return null
        return remainder / remainingCount
    }

    /** Parses a form field that may be blank or nonsense. */
    fun parseMoney(raw: String): Double? {
        val trimmed = raw.trim().replace(",", "")
        if (trimmed.isEmpty()) return null
        val value = trimmed.toDoubleOrNull() ?: return null
        return if (value.isFinite()) value else null
    }

    /**
     * Totals across everyone, for a summary line.
     *
     * The two directions are deliberately not netted. Someone can owe you for last night and be
     * owed for last week; collapsing that to one number loses the fact that there are two things
     * to settle.
     */
    fun totals(balances: List<CounterpartyBalanceResponse>): Totals {
        var owedToYou = 0.0
        var youOwe = 0.0
        for (row in balances) {
            when (row.direction) {
                CounterpartyDirection.OWED_TO_YOU -> owedToYou += row.amount
                CounterpartyDirection.YOU_OWE -> youOwe += row.amount
            }
        }
        return Totals(owedToYou, youOwe)
    }

    data class Totals(val owedToYou: Double, val youOwe: Double)

    /**
     * The system category settling up is filed under. Matched by name, the same way the backend's
     * `SYSTEM_CATEGORY_NAMES` exclusion is, because that is how the find-or-create sites
     * identify it.
     */
    const val REIMBURSEMENT_CATEGORY_NAME = "Reimbursement"

    /**
     * Whether a row belongs in a "where did my money go" breakdown.
     *
     * Two kinds of expense row are cash leaving an account without being spending, and both
     * reach the activity list correctly — the money really did move — while neither belongs in
     * the breakdown:
     *
     * - A **transfer** between your own accounts. You still have the money. This is the same rule
     *   the budget and runway rollups apply server-side, and the same one `HistoryGroups` applies
     *   to section totals; the breakdown was the one place left out, so a big transfer could top
     *   the chart.
     * - A **settlement**. The spending was charged when the bill was paid, so counting the
     *   repayment charges the same dinner twice.
     *
     * Both are identified the way the rest of the app identifies them: a transfer by carrying a
     * transfer id, a settlement by its system category name.
     */
    fun countsAsSpending(categoryName: String?, isTransfer: Boolean): Boolean {
        if (isTransfer) return false
        return categoryName != REIMBURSEMENT_CATEGORY_NAME
    }
}
