import type { HistoryGranularity } from "../../lib/historyGroups"
import { assessSplit, parseMoney } from "../../lib/reimbursements"

/**
 * Constants, shapes and pure helpers behind the Transactions page.
 *
 * Split out of `Transactions.tsx` so the page component is the page: none of
 * this depends on React or on any of the page's state, and it reads better as a
 * short file you can hold in your head than as a preamble you scroll past.
 */

export const CATEGORY_COLORS = ["var(--chart-cat-1)", "var(--chart-cat-2)", "var(--chart-cat-3)", "var(--chart-cat-4)", "var(--chart-cat-5)"];
// Neutral fallback for buckets that aren't a real household category (the "Other" rollup slice, "Uncategorized").
export const OTHER_SLICE_COLOR = "var(--base-400)";

export type CategoryPeriodPreset = "all" | "this_month" | "last_month" | "last_3_months" | "last_6_months" | "this_year" | "specific_month" | "custom";

export const CATEGORY_PERIOD_OPTIONS: { value: CategoryPeriodPreset; label: string }[] = [
    { value: "all", label: "All time" },
    { value: "this_month", label: "This month" },
    { value: "last_month", label: "Last month" },
    { value: "last_3_months", label: "Last 3 months" },
    { value: "last_6_months", label: "Last 6 months" },
    { value: "this_year", label: "This year" },
    { value: "specific_month", label: "Specific month" },
    { value: "custom", label: "Custom range" },
];

export const categoryFilterStorageKey = (householdId: string) => `ft:tx-category-filter:${householdId}`;

export function categoryIcon(name: string): string {
    const low = name.toLowerCase();
    if (/(food|dining|restaurant|cafe|coffee|lunch|dinner)/.test(low)) return "☕";
    if (/(transport|taxi|grab|uber|mrt|bus|fuel|petrol)/.test(low)) return "🚕";
    if (/(grocery|groceries|supermarket|fairprice)/.test(low)) return "🛒";
    if (/(entertain|movie|netflix|game)/.test(low)) return "🎬";
    if (/(shop|retail)/.test(low)) return "🛍️";
    if (/(hous|rent|mortgage)/.test(low)) return "🏠";
    if (/(salary|income|payroll)/.test(low)) return "💰";
    if (/(invest|dividend)/.test(low)) return "💵";
    return "💳";
}

export const HISTORY_GRANULARITIES: { value: HistoryGranularity; label: string }[] = [
    { value: "day", label: "Day" },
    { value: "month", label: "Month" },
    { value: "year", label: "Year" },
];

export const historyGranularityStorageKey = (householdId: string) => `ft:tx-group-by:${householdId}`;

/**
 * Best guess at a row's value in the household's base currency: the figure the
 * backend already converted, or the row's own amount when it was already booked
 * in the base currency. Anything else stays `null` — a foreign-currency row with
 * no stored conversion is left out of the group totals rather than distorting them.
 * The iOS and Android ports of this rule live in `HistoryGroups.swift` / `HistoryGroups.kt`.
 */
export function homeValueOf(storedHomeAmount: number | null | undefined, nativeAmount: number, nativeCurrency: string | null | undefined, baseCurrency: string): number | null {
    if (storedHomeAmount !== null && storedHomeAmount !== undefined) {
        const n = Math.abs(Number(storedHomeAmount));
        if (Number.isFinite(n)) return n;
    }
    if (nativeCurrency && nativeCurrency === baseCurrency) return Math.abs(nativeAmount);
    return null;
}

export type UnifiedHistoryItem = {
    id: string;
    type: string; // 'buy', 'sell', 'deposit', 'withdrawal', 'income', 'expense'
    categoryType: 'trade' | 'transaction';
    assetOrCategory: string;
    amountNative: number;
    currencyNative: string;
    amountAccount: number;
    currencyAccount: string;
    /** Value in the household's base currency, or null when it can't be converted. */
    amountHome: number | null;
    shares: number | null;
    date: Date;
    status: string;
    accountId: string;
    accountName: string;
    subportfolioId: string | null;
    subportfolioName: string | null;
    householdName: string;
    description: string | null;
    ownerUserId: string | null;
    /** Set where part of this expense was somebody else's; null on trades. */
    split: { owedBy: string; owedAmount: number } | null;
};



/**
 * The sentence under the split fields. It restates the split as the two numbers
 * the user actually cares about, because "they owe 80" on a 120 bill is only
 * meaningful once you can see that leaves you 40.
 */
export function splitHint(amountRaw: string, owedRaw: string, currency: string): string {
    const assessment = assessSplit(parseMoney(amountRaw), parseMoney(owedRaw));
    if (assessment.kind === "incomplete") {
        return "The full amount still leaves your account — only your share counts towards budgets.";
    }
    if (assessment.kind === "invalid") return assessment.reason;
    const money = (value: number) =>
        new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value);
    return `Your share: ${money(assessment.yourShare)}. They owe you ${money(assessment.owed)}.`;
}
