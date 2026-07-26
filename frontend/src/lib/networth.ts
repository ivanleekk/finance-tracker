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
    currencies: string[];
};

export function summarizeAccounts(accounts: AccountLike[]): AccountTotals {
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

    return {
        totalAssets,
        liabilities,
        net: totalAssets - liabilities,
        liquidNow,
        retirement,
        property,
        currencies: Array.from(currencySet).sort(),
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
