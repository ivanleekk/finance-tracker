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

object Reimbursements {

    /**
     * What a proposed split works out to.
     *
     * Owing more than the bill is rejected rather than clamped: it is a typo, and silently
     * correcting it would hide the mistake behind a plausible number.
     */
    fun assessSplit(amount: Double?, owed: Double?): SplitAssessment {
        if (amount == null || owed == null) return SplitAssessment.Incomplete
        if (!amount.isFinite() || !owed.isFinite()) return SplitAssessment.Incomplete
        if (owed <= 0 || amount <= 0) return SplitAssessment.Incomplete
        if (owed > amount) return SplitAssessment.Invalid("They can't owe more than the bill.")
        return SplitAssessment.Valid(yourShare = amount - owed, owed = owed)
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
     * Whether a category belongs in a "where did my money go" breakdown.
     *
     * Paying someone back is cash leaving an account, so it is an expense row and shows up in the
     * activity list — but it is not spending. The spending was charged when the bill was paid,
     * and letting a repayment into the breakdown charges the same dinner twice, in the one view
     * whose whole job is to say what you spent money on.
     */
    fun countsAsSpending(categoryName: String?): Boolean =
        categoryName != REIMBURSEMENT_CATEGORY_NAME
}
