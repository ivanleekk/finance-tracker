import type { CardCategoryResponse, CardLimitStatusRow, CardResponse, CardStatusResponse } from "../types/types";

/**
 * Presentation logic for per-card spend limits.
 *
 * The bar width and the pace marker are deliberately *not* here: a card limit
 * row has the same `percent_used` / `days_elapsed` / `days_total` shape as a
 * budget row, so `budgetBarPercent` and `periodElapsedPercent` already read it.
 * What is card-specific is the direction — whether the number is a cap to stay
 * under or a minimum to reach — and that changes both the tone and the wording.
 */

export type CardLimitTone = "over" | "at-risk" | "ok";

/**
 * How a limit should read right now.
 *
 * A ceiling and a floor invert: reaching the number is the failure for a cap
 * and the goal for a minimum, so `settled` means opposite things and only the
 * ceiling can ever be "over". Both share "at-risk", which is the state worth
 * showing — a warning after the cycle closes is useless, so the pace projection
 * is what earns its place.
 */
/**
 * A limit with no categories pointing at it measures nothing.
 *
 * It is a setup mistake rather than a state worth rendering as a meter: the user
 * made a cap and never said what counts towards it. Left alone it draws a
 * perfectly plausible "0 of $1,000" bar and reads as "nothing spent yet",
 * which is the one thing it must not be mistaken for.
 */
export function limitMeasuresNothing(
    row: Pick<CardLimitStatusRow, "category_names">
): boolean {
    return row.category_names.length === 0;
}

export function cardLimitTone(
    row: Pick<CardLimitStatusRow, "direction" | "settled" | "projected_missed">
): CardLimitTone {
    if (row.direction === "floor") {
        if (row.settled) return "ok";
        return row.projected_missed ? "at-risk" : "ok";
    }
    if (row.settled) return "over";
    return row.projected_missed ? "at-risk" : "ok";
}

/**
 * The short status a person actually reads, e.g. "$240 left" or "$120 to go".
 *
 * This is the string that goes in the category picker at entry, which is the
 * one moment the number can still change a decision. Kept as a pure function so
 * the wording is testable rather than buried in JSX.
 */
export function headroomLabel(
    row: Pick<CardLimitStatusRow, "direction" | "remaining" | "settled">,
    formatAmount: (value: number) => string
): string {
    const remaining = Number(row.remaining);
    if (row.direction === "floor") {
        return row.settled ? "Minimum met" : `${formatAmount(remaining)} to go`;
    }
    return row.settled ? "Cap reached" : `${formatAmount(remaining)} left`;
}

/**
 * The cycle window, worded for a header: "19 Aug – 18 Sep".
 *
 * Dates arrive as plain `YYYY-MM-DD` strings and are formatted without going
 * through a timezone-bearing Date, because a cycle boundary is a calendar fact
 * about the card, not an instant — parsing "2026-08-19" as UTC midnight and
 * rendering it west of Greenwich would show the 18th.
 */
export function cycleLabel(start: string, end: string, locale?: string): string {
    const fmt = (iso: string) => {
        const [year, month, day] = iso.split("-").map(Number);
        if (!year || !month || !day) return iso;
        return new Date(year, month - 1, day).toLocaleDateString(locale, {
            day: "numeric",
            month: "short",
        });
    };
    return `${fmt(start)} – ${fmt(end)}`;
}

/**
 * Headroom for each of a card's categories, keyed by category id.
 *
 * The status endpoint reports limits, but the picker is a list of *categories* —
 * and several categories can share one limit, so this fans the limit back out
 * over the categories pointing at it. A category with no limit gets no entry
 * rather than a zero, because "unmetered" and "nothing left" must not look the
 * same.
 */
export function headroomByCategory(
    card: Pick<CardResponse, "categories">,
    status: Pick<CardStatusResponse, "limits">
): Map<string, CardLimitStatusRow> {
    const byLimit = new Map(status.limits.map(row => [row.limit_id, row]));
    const out = new Map<string, CardLimitStatusRow>();
    for (const category of card.categories) {
        // An unmetered category has a null limit_id, which matches nothing in
        // the map and is skipped by the same check that skips a limit missing
        // from the payload — no separate guard needed for it.
        const row = category.limit_id ? byLimit.get(category.limit_id) : undefined;
        if (row) out.set(category.id, row);
    }
    return out;
}

/**
 * The limits worth interrupting someone about — burst, or on pace to be.
 *
 * Used for the Dashboard's exception row, which shows nothing at all when
 * everything is fine. A permanent card widget would dilute a screen that earns
 * its place by answering questions people arrived with.
 */
export function limitsNeedingAttention(rows: CardLimitStatusRow[]): CardLimitStatusRow[] {
    return rows.filter(row => cardLimitTone(row) !== "ok");
}


/**
 * The card-category picker's options, headroom and all.
 *
 * Shared by the transaction form and the command bar so the two cannot drift
 * into saying different things about the same card. Takes the resource route's
 * payload directly — `{ card: null }` is the ordinary answer for an account
 * that is not a card, and yields no options at all, which is what hides the
 * picker.
 */
export function cardCategoryPickerOptions(
    data: { card: CardResponse | null; status: CardStatusResponse | null } | null,
    fallbackCurrency: string
): { value: string; label: string }[] {
    if (!data?.card) return [];
    const currency = data.card.currency || fallbackCurrency;
    const money = (value: number) =>
        new Intl.NumberFormat(undefined, {
            style: "currency",
            currency,
            maximumFractionDigits: 0,
        }).format(value);
    const headroom = data.status ? headroomByCategory(data.card, data.status) : new Map();
    return [
        { value: "", label: "— Card's default —" },
        ...data.card.categories.map((c: CardCategoryResponse) => {
            const row = headroom.get(c.id);
            return { value: c.id, label: row ? `${c.name} · ${headroomLabel(row, money)}` : c.name };
        }),
    ];
}
