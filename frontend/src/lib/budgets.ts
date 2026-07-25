import { RecurrenceFrequency } from "../types/types";
import type { BudgetStatusRow, EmergencyFundResponse, UpcomingOccurrence } from "../types/types";

/**
 * Presentation logic for budgets, the emergency-fund runway, and recurring
 * rules. Kept out of the components so the judgement calls — when a budget is
 * "at risk", what an undefined runway should say — are testable.
 */

export type BudgetTone = "over" | "at-risk" | "ok";

/**
 * A budget is "at risk" when today's pace would blow the limit even though it
 * hasn't yet. Flagging that early is the whole point of showing a projection —
 * telling someone they overspent on the 30th is useless.
 */
export function budgetTone(row: Pick<BudgetStatusRow, "spent" | "limit" | "projected_over">): BudgetTone {
    if (Number(row.spent) > Number(row.limit)) return "over";
    if (row.projected_over) return "at-risk";
    return "ok";
}

/** Percentage of the limit used, clamped to 0-100 for bar widths. */
export function budgetBarPercent(row: Pick<BudgetStatusRow, "percent_used">): number {
    const value = Number(row.percent_used);
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, value));
}

/** How far through the period we are, 0-100. Drives the "pace" marker. */
export function periodElapsedPercent(
    row: Pick<BudgetStatusRow, "days_elapsed" | "days_total">
): number {
    const total = Number(row.days_total);
    if (!Number.isFinite(total) || total <= 0) return 0;
    const elapsed = Number(row.days_elapsed);
    return Math.max(0, Math.min(100, (elapsed / total) * 100));
}

/**
 * What to show for the runway headline.
 *
 * `null` months means no spending has been recorded — an undefined runway, not
 * an infinite one. Saying "∞ months" to someone who simply hasn't logged
 * expenses yet is false reassurance.
 */
export function runwayLabel(fund: Pick<EmergencyFundResponse, "months_covered">): string {
    const months = fund.months_covered;
    if (months === null || months === undefined) return "Not enough data";
    const value = Number(months);
    if (!Number.isFinite(value)) return "Not enough data";
    if (value >= 99) return "99+ months";
    return `${value.toFixed(1)} months`;
}

export type RunwayTone = "unknown" | "critical" | "low" | "ok";

/**
 * Under one month is critical, under target is low. The thresholds are
 * deliberately about absolute survival time, not just progress to target: three
 * months of cash is genuinely fine even against a twelve-month goal.
 */
export function runwayTone(
    fund: Pick<EmergencyFundResponse, "months_covered" | "target_months">
): RunwayTone {
    const months = fund.months_covered;
    if (months === null || months === undefined) return "unknown";
    const value = Number(months);
    if (!Number.isFinite(value)) return "unknown";
    if (value < 1) return "critical";
    if (value < Number(fund.target_months)) return "low";
    return "ok";
}

const FREQUENCY_LABELS: Record<string, string> = {
    [RecurrenceFrequency.Weekly]: "Weekly",
    [RecurrenceFrequency.Biweekly]: "Every 2 weeks",
    [RecurrenceFrequency.Monthly]: "Monthly",
    [RecurrenceFrequency.Quarterly]: "Quarterly",
    [RecurrenceFrequency.Yearly]: "Yearly",
};

export function frequencyLabel(frequency: string): string {
    return FREQUENCY_LABELS[frequency] ?? frequency;
}

/** Group upcoming occurrences by month for a readable agenda. */
export function groupOccurrencesByMonth(
    occurrences: UpcomingOccurrence[]
): { month: string; label: string; items: UpcomingOccurrence[] }[] {
    const groups = new Map<string, UpcomingOccurrence[]>();
    occurrences.forEach(item => {
        const month = item.date.slice(0, 7); // YYYY-MM
        const list = groups.get(month) ?? [];
        list.push(item);
        groups.set(month, list);
    });

    return Array.from(groups.entries())
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .map(([month, items]) => ({
            month,
            label: new Date(`${month}-01T00:00:00Z`).toLocaleDateString("default", {
                month: "long",
                year: "numeric",
                timeZone: "UTC",
            }),
            items,
        }));
}

/**
 * Net effect of the upcoming occurrences: income minus expenses. Tells the user
 * whether the month ahead is already committed to more than it brings in.
 */
export function netUpcoming(occurrences: UpcomingOccurrence[]): number {
    return occurrences.reduce((sum, item) => {
        const amount = Number(item.amount);
        if (!Number.isFinite(amount)) return sum;
        return item.transaction_type === "income" ? sum + amount : sum - amount;
    }, 0);
}
