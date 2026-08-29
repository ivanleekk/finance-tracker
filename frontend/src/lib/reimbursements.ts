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

/** One person's share of a bill being split — a counterparty id and an amount. */
export type SplitEntry = { counterpartyId: string; amount: number | null };

export type SplitAssessment =
    /** Not enough entered yet to say anything. */
    | { kind: "incomplete" }
    /** Entered, but it cannot mean what it says. */
    | { kind: "invalid"; reason: string }
    | { kind: "valid"; yourShare: number; owed: number };

/**
 * What a proposed split works out to, across everyone in it.
 *
 * `owed` is the sum of every entry's amount. Owing more than the bill in total
 * is rejected rather than clamped: it is a typo, and silently correcting it
 * would hide the mistake behind a plausible number. The same rejection covers
 * a single entry with no amount yet — a half-filled row is not a valid split.
 */
export function assessSplit(amount: number | null, entries: SplitEntry[]): SplitAssessment {
    if (amount === null || !Number.isFinite(amount) || amount <= 0) {
        return { kind: "incomplete" };
    }
    if (entries.length === 0) return { kind: "incomplete" };
    if (entries.some((e) => e.amount === null || !Number.isFinite(e.amount) || e.amount <= 0)) {
        return { kind: "incomplete" };
    }
    const ids = entries.map((e) => e.counterpartyId);
    if (new Set(ids).size !== ids.length) {
        return { kind: "invalid", reason: "The same person can't appear twice in one split." };
    }
    const owed = entries.reduce((sum, e) => sum + (e.amount ?? 0), 0);
    if (owed > amount) {
        return { kind: "invalid", reason: "They can't owe more than the bill, combined." };
    }
    return { kind: "valid", yourShare: amount - owed, owed };
}

/**
 * Given a bill amount, the entries with an explicit amount already typed, and
 * the entries left to fill in, divide what's left evenly across the rest.
 * Mirrors cashshare's `/add` semantics: specify some people's shares by hand,
 * and everyone else splits the remainder equally.
 */
export function evenSplitRemainder(
    amount: number,
    specified: number[],
    remainingCount: number,
): number | null {
    if (remainingCount <= 0) return null;
    const specifiedTotal = specified.reduce((sum, v) => sum + v, 0);
    const remainder = amount - specifiedTotal;
    if (remainder <= 0) return null;
    return remainder / remainingCount;
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
 * Whether a row belongs in a "where did my money go" breakdown.
 *
 * Two kinds of expense row are cash leaving an account without being spending,
 * and both reach the activity list correctly — the money really did move — while
 * neither belongs in the breakdown:
 *
 * - A **transfer** between your own accounts. You still have the money. This is
 *   the same rule the budget and runway rollups apply server-side, and the same
 *   one `historyGroups` applies to section totals; the breakdown was the one
 *   place that had been left out, so a big transfer could top the chart.
 * - A **settlement**. The spending was charged when the bill was paid, so
 *   counting the repayment charges the same dinner twice. The backend excludes
 *   it from the burn rate for exactly this reason.
 *
 * Both are identified the way the rest of the app identifies them: a transfer by
 * carrying a `transfer_id`, a settlement by its system category name.
 */
export function countsAsSpending(
    categoryName: string | null | undefined,
    isTransfer: boolean,
): boolean {
    if (isTransfer) return false;
    return categoryName !== REIMBURSEMENT_CATEGORY_NAME;
}
