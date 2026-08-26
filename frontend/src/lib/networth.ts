import { AccountKind, LiquidityStatus } from "../types/types";
import type { AccountResponse, BalanceResponse, NetWorthProjectionPoint } from "../types/types";

/**
 * Net worth aggregation across accounts of every kind.
 *
 * The distinction that matters here: property (an illiquid asset) belongs in
 * net worth but not in "liquid now" and not on the cash chart. Getting that
 * wrong in either direction is what made a mortgaged household look permanently
 * bankrupt (house missing) or absurdly cash-rich (house counted as spendable).
 */

export type AccountLike = Pick<AccountResponse, "id" | "kind" | "liquidity" | "currency"> & {
    history: BalanceResponse[];
};

/** Latest home-currency balance from a history, or 0 when there is none. */
export function latestBalanceHome(history: BalanceResponse[]): number {
    if (!history || history.length === 0) return 0;
    const last = history.reduce((max, current) => (current.date > max.date ? current : max), history[0]);
    const value = Number(last.balance_home_currency ?? last.balance);
    // A malformed balance must not poison every downstream aggregate.
    return Number.isFinite(value) ? value : 0;
}

export type AccountTotals = {
    totalAssets: number;
    liabilities: number;
    net: number;
    liquidNow: number;
    retirement: number;
    property: number;
    /** Money other people owe the household. An asset, but not a spendable one. */
    receivables: number;
    currencies: string[];
};

/**
 * Outstanding debts either way, from the ledger's counterparty balances.
 *
 * These sit in no `FinancialAccount`, which is the whole reason they need
 * passing in: without them a split bill takes the full amount out of the bank
 * and puts nothing back, so net worth reports money you are still owed as money
 * that simply evaporated.
 */
export type OwedTotals = { owedToYou: number; youOwe: number };

const NOTHING_OWED: OwedTotals = { owedToYou: 0, youOwe: 0 };

export function summarizeAccounts(
    accounts: AccountLike[],
    owed: OwedTotals = NOTHING_OWED,
): AccountTotals {
    let totalAssets = 0, liabilities = 0, liquidNow = 0, retirement = 0, property = 0;
    const currencySet = new Set<string>();

    accounts.forEach(acc => {
        const balance = latestBalanceHome(acc.history);
        if (acc.currency) currencySet.add(acc.currency);

        // Liabilities store their outstanding balance as a positive number and
        // are subtracted, never added.
        if (acc.kind === AccountKind.Liability) {
            liabilities += balance;
            return;
        }

        totalAssets += balance;
        if (acc.liquidity === LiquidityStatus.Liquid) liquidNow += balance;
        if (acc.liquidity === LiquidityStatus.TimeLocked || acc.liquidity === LiquidityStatus.Retirement) {
            retirement += balance;
        }
        if (acc.liquidity === LiquidityStatus.Illiquid) property += balance;
    });

    // A receivable is a real asset — someone owing you $80 is $80 you have a
    // claim on — but it is deliberately kept out of `liquidNow`, for the same
    // reason property is: you cannot spend it this week, and treating it as
    // spendable is how a runway starts lying. A payable is a real debt.
    const receivables = Number.isFinite(owed.owedToYou) ? owed.owedToYou : 0;
    const payables = Number.isFinite(owed.youOwe) ? owed.youOwe : 0;
    totalAssets += receivables;
    liabilities += payables;

    return {
        totalAssets,
        liabilities,
        net: totalAssets - liabilities,
        liquidNow,
        retirement,
        property,
        receivables,
        currencies: Array.from(currencySet).sort(),
    };
}

export type NetWorthSlice = { key: string; label: string; value: number };

export type NetWorthBreakdown = {
    slices: NetWorthSlice[];
    liabilities: number;
    /** Sum of the visible (positive) slices — the right denominator for each
     * slice's share. Not the same as gross assets when a bucket (e.g. cash,
     * for an overdrawn household) is negative and therefore excluded below. */
    sliceTotal: number;
};

/**
 * Composition of net worth for the dashboard split chart: cash-like accounts
 * bucketed by liquidity, plus portfolio holdings (tracked separately from
 * FinancialAccount, so there's no overlap with `accounts`). Liabilities are
 * returned alongside rather than as a slice — a pie can't render a negative
 * wedge, and net worth is "these assets, minus that debt," not one blended
 * bucket. A negative bucket (e.g. overdrawn cash) is dropped the same way —
 * it still reduces net worth, just not through a pie wedge.
 */
export function netWorthBreakdown(
    accounts: AccountLike[],
    portfolioValue: number,
    owed: OwedTotals = NOTHING_OWED,
): NetWorthBreakdown {
    const totals = summarizeAccounts(accounts, owed);
    // Anything not liquid/retirement/property/owed (e.g. market_liquid accounts).
    // Receivables are subtracted out and given their own slice rather than left
    // to fall into "Other assets", where a debt someone owes you would be
    // indistinguishable from an account you forgot to classify.
    const other =
        totals.totalAssets - totals.liquidNow - totals.retirement - totals.property - totals.receivables;

    const slices: NetWorthSlice[] = [
        { key: "cash", label: "Cash", value: totals.liquidNow },
        { key: "investments", label: "Investments", value: portfolioValue },
        { key: "retirement", label: "Retirement & locked", value: totals.retirement },
        { key: "property", label: "Property", value: totals.property },
        { key: "owed", label: "Owed to you", value: totals.receivables },
        { key: "other", label: "Other assets", value: other },
    ].filter(s => s.value > 0.01);

    return {
        slices,
        liabilities: totals.liabilities,
        sliceTotal: slices.reduce((sum, s) => sum + s.value, 0),
    };
}

/** Accounts that belong on the spendable-cash chart: assets, minus property. */
export function cashChartAccountsOf<T extends Pick<AccountResponse, "kind" | "liquidity">>(accounts: T[]): T[] {
    return accounts.filter(
        a => a.kind !== AccountKind.Liability && a.liquidity !== LiquidityStatus.Illiquid
    );
}

export type ProjectionSample = {
    date: string;
    netWorth: number;
    assets: number;
    /** Negative, so debt renders below the zero line. */
    liabilities: number;
};

/**
 * Thin 30 years of monthly points down to something a chart can draw.
 *
 * Returns an empty array when the projection has nothing to say — no debt to
 * amortize and no growth — because a flat line at today's number is noise.
 */
export function sampleProjection(points: NetWorthProjectionPoint[]): ProjectionSample[] {
    if (!points || points.length < 2) return [];

    const hasDebt = points.some(p => Number(p.liabilities) > 0);
    const changes = Number(points[points.length - 1].net_worth) !== Number(points[0].net_worth);
    if (!hasDebt && !changes) return [];

    // Yearly, always keeping the final point so the endpoint stays exact.
    return points
        .filter((_, i) => i % 12 === 0 || i === points.length - 1)
        .map(p => ({
            date: p.date,
            netWorth: Number(p.net_worth),
            assets: Number(p.assets),
            liabilities: -Number(p.liabilities),
        }));
}
