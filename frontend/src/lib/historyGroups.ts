// Grouping and per-group totals for the Transactions page's activity list.
//
// The list is bucketed by day, month or year, and each bucket header carries
// the money that moved inside it. Two judgement calls live here rather than in
// the component so they can be tested and stay honest:
//
//  - Transfers never count. Money moving between the household's own accounts
//    is not income and not spending; counting it would double a day's totals.
//    This matches the budget/runway rollups (see AGENTS.md).
//  - An item with no known home-currency value (`amountHome === null`) is left
//    out of the totals instead of being summed at face value. A day mixing SGD
//    and USD rows would otherwise report a number that means nothing. The
//    count of such rows is reported so the UI can say the total is partial.

export type HistoryGranularity = "day" | "month" | "year";

export type GroupableHistoryItem = {
    date: Date;
    type: string;
    /** Value in the household's base currency, or null when it can't be converted. */
    amountHome: number | null;
};

export type GroupSummary = {
    inflow: number;
    outflow: number;
    net: number;
    /** Rows in the group that carried no home-currency value, so are missing from the totals. */
    unconverted: number;
};

export type HistoryGroup<T extends GroupableHistoryItem> = {
    key: string;
    label: string;
    items: T[];
    summary: GroupSummary;
};

const INFLOW_TYPES = ["deposit", "income", "sell", "transfer_in"];

export function isInflowType(type: string): boolean {
    return INFLOW_TYPES.includes(type);
}

export function isTransferType(type: string): boolean {
    return type.startsWith("transfer");
}

function startOfDay(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

/**
 * Stable bucket key. Built from local date parts (not an ISO string) so a
 * transaction at 23:00 local time lands on the day the user filed it.
 */
export function groupKey(date: Date, granularity: HistoryGranularity): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    if (granularity === "year") return `${y}`;
    if (granularity === "month") return `${y}-${m}`;
    return `${y}-${m}-${d}`;
}

export function groupLabel(date: Date, granularity: HistoryGranularity, now: Date = new Date()): string {
    if (granularity === "year") {
        return date.toLocaleDateString(undefined, { year: "numeric" });
    }
    if (granularity === "month") {
        return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    }
    const today = startOfDay(now);
    const yesterday = startOfDay(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const d = startOfDay(date);
    const dayLabel = date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
    if (d.getTime() === today.getTime()) return `Today · ${dayLabel}`;
    if (d.getTime() === yesterday.getTime()) return `Yesterday · ${dayLabel}`;
    return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function summarizeGroup(items: GroupableHistoryItem[]): GroupSummary {
    let inflow = 0;
    let outflow = 0;
    let unconverted = 0;
    for (const item of items) {
        if (isTransferType(item.type)) continue;
        if (item.amountHome === null || !Number.isFinite(item.amountHome)) {
            unconverted += 1;
            continue;
        }
        const amount = Math.abs(item.amountHome);
        if (isInflowType(item.type)) inflow += amount;
        else outflow += amount;
    }
    return { inflow, outflow, net: inflow - outflow, unconverted };
}

/**
 * Buckets an already-sorted list into groups, preserving the incoming order of
 * both the groups and the items inside them.
 */
export function groupHistory<T extends GroupableHistoryItem>(
    items: T[],
    granularity: HistoryGranularity,
    now: Date = new Date(),
): HistoryGroup<T>[] {
    const buckets = new Map<string, { label: string; items: T[] }>();
    for (const item of items) {
        const key = groupKey(item.date, granularity);
        let bucket = buckets.get(key);
        if (!bucket) {
            bucket = { label: groupLabel(item.date, granularity, now), items: [] };
            buckets.set(key, bucket);
        }
        bucket.items.push(item);
    }
    return Array.from(buckets.entries()).map(([key, bucket]) => ({
        key,
        label: bucket.label,
        items: bucket.items,
        summary: summarizeGroup(bucket.items),
    }));
}
