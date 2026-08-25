/**
 * Splitting a bill, and reading back who owes whom.
 *
 * The rule that matters: the amount on a transaction is the whole sum that left
 * the account, because that is what happened. Splitting it does not shrink it —
 * it records how much of it was somebody else's, so the budget charges you for
 * your share while the bank still shows the full payment.
 *
 * Ported to `ios/FinanceTracker/Support/Reimbursements.swift` and
 * `android/.../logic/Reimbursements.kt`; keep the three in step.
 */

import type { CounterpartyBalanceResponse } from "../types/types";

export type SplitAssessment =
    /** Not enough entered yet to say anything. */
    | { kind: "incomplete" }
    /** Entered, but it cannot mean what it says. */
    | { kind: "invalid"; reason: string }
    | { kind: "valid"; yourShare: number; owed: number };

/**
 * What a proposed split works out to.
 *
 * Owing more than the bill is rejected rather than clamped: it is a typo, and
 * silently correcting it would hide the mistake behind a plausible number.
 */
export function assessSplit(amount: number | null, owed: number | null): SplitAssessment {
    if (amount === null || owed === null || !Number.isFinite(amount) || !Number.isFinite(owed)) {
        return { kind: "incomplete" };
    }
    if (owed <= 0) return { kind: "incomplete" };
    if (amount <= 0) return { kind: "incomplete" };
    if (owed > amount) {
        return { kind: "invalid", reason: "They can't owe more than the bill." };
    }
    return { kind: "valid", yourShare: amount - owed, owed };
}

/** Parses a form field that may be blank or nonsense. */
export function parseMoney(raw: string): number | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const value = Number(trimmed);
    return Number.isFinite(value) ? value : null;
}

/**
 * Totals across everyone, for a summary line.
 *
 * The two directions are deliberately not netted. Someone can owe you for last
 * night and be owed for last week; collapsing that to one number loses the fact
 * that there are two things to settle.
 */
export function counterpartyTotals(balances: CounterpartyBalanceResponse[]): {
    owedToYou: number;
    youOwe: number;
} {
    let owedToYou = 0;
    let youOwe = 0;
    for (const row of balances) {
        const amount = Number(row.amount) || 0;
        if (row.direction === "owed_to_you") owedToYou += amount;
        else youOwe += amount;
    }
    return { owedToYou, youOwe };
}

/**
 * The system category settling up is filed under. Matched by name, the same way
 * the backend's `SYSTEM_CATEGORY_NAMES` exclusion is, because that is how the
 * find-or-create sites identify it.
 */
export const REIMBURSEMENT_CATEGORY_NAME = "Reimbursement";

/**
 * Whether a category belongs in a "where did my money go" breakdown.
 *
 * Paying someone back is cash leaving an account, so it is an expense row and
 * shows up in the activity list — but it is not spending. The spending was
 * charged when the bill was paid, and letting a repayment into the breakdown
 * charges the same dinner twice, in the one view whose whole job is to say what
 * you spent money on. The backend excludes it from the burn rate for the same
 * reason.
 */
export function countsAsSpending(categoryName: string | null | undefined): boolean {
    return categoryName !== REIMBURSEMENT_CATEGORY_NAME;
}
