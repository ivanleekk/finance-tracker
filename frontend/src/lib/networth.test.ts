import { describe, it, expect } from "vitest";
import {
    latestBalanceHome,
    summarizeAccounts,
    cashChartAccountsOf,
    sampleProjection,
    type AccountLike,
} from "./networth";
import { AccountKind, LiquidityStatus } from "../types/types";
import type { BalanceResponse, NetWorthProjectionPoint } from "../types/types";

// The scenario these guard: a household with a 500k home, a 400k mortgage and
// 10k in the bank. Net worth is +110k. Before property existed the same
// household read -390k, which is the bug this feature exists to fix.

const bal = (date: string, amount: number, home?: number): BalanceResponse => ({
    id: `${date}-${amount}`,
    account_id: "a",
    date,
    balance: amount,
    balance_home_currency: home ?? amount,
    is_manual: true,
});

const account = (over: Partial<AccountLike>): AccountLike => ({
    id: Math.random().toString(),
    kind: AccountKind.Asset,
    liquidity: LiquidityStatus.Liquid,
    currency: "USD",
    history: [],
    ...over,
});

describe("latestBalanceHome", () => {
    it("picks the newest checkpoint regardless of array order", () => {
        expect(latestBalanceHome([bal("2026-01-01", 100), bal("2026-06-01", 900), bal("2026-03-01", 500)]))
            .toBe(900);
    });

    it("prefers the home-currency value over the native one", () => {
        expect(latestBalanceHome([bal("2026-01-01", 1000, 750)])).toBe(750);
    });

    it("returns 0 for an empty history instead of NaN", () => {
        expect(latestBalanceHome([])).toBe(0);
    });

    it("coerces a non-numeric balance to 0 rather than poisoning aggregates", () => {
        const broken = { ...bal("2026-01-01", 0), balance: undefined as unknown as number, balance_home_currency: undefined };
        expect(latestBalanceHome([broken])).toBe(0);
    });
});

describe("summarizeAccounts", () => {
    const home = account({
        liquidity: LiquidityStatus.Illiquid,
        history: [bal("2026-01-01", 500_000)],
    });
    const mortgage = account({
        kind: AccountKind.Liability,
        history: [bal("2026-01-01", 400_000)],
    });
    const savings = account({ history: [bal("2026-01-01", 10_000)] });

    it("counts property in net worth alongside the loan against it", () => {
        const totals = summarizeAccounts([home, mortgage, savings]);
        expect(totals.totalAssets).toBe(510_000);
        expect(totals.liabilities).toBe(400_000);
        expect(totals.net).toBe(110_000);
    });

    it("keeps property out of liquid-now", () => {
        const totals = summarizeAccounts([home, savings]);
        expect(totals.property).toBe(500_000);
        expect(totals.liquidNow).toBe(10_000);
    });

    it("subtracts a liability rather than adding it", () => {
        expect(summarizeAccounts([mortgage]).net).toBe(-400_000);
    });

    it("groups time-locked and retirement accounts together", () => {
        const cpf = account({ liquidity: LiquidityStatus.TimeLocked, history: [bal("2026-01-01", 30_000)] });
        const srs = account({ liquidity: LiquidityStatus.Retirement, history: [bal("2026-01-01", 20_000)] });
        expect(summarizeAccounts([cpf, srs]).retirement).toBe(50_000);
    });

    it("reports distinct currencies, sorted", () => {
        const sgd = account({ currency: "SGD" });
        const usd = account({ currency: "USD" });
        expect(summarizeAccounts([usd, sgd, usd]).currencies).toEqual(["SGD", "USD"]);
    });

    it("returns zeroes for an empty household", () => {
        const totals = summarizeAccounts([]);
        expect(totals).toMatchObject({ totalAssets: 0, liabilities: 0, net: 0, property: 0 });
    });
});

describe("cashChartAccountsOf", () => {
    it("excludes property and liabilities, keeping spendable assets", () => {
        const accounts = [
            { id: "cash", kind: AccountKind.Asset, liquidity: LiquidityStatus.Liquid },
            { id: "stocks", kind: AccountKind.Asset, liquidity: LiquidityStatus.MarketLiquid },
            { id: "house", kind: AccountKind.Asset, liquidity: LiquidityStatus.Illiquid },
            { id: "loan", kind: AccountKind.Liability, liquidity: LiquidityStatus.Liquid },
        ];
        expect(cashChartAccountsOf(accounts).map(a => a.id)).toEqual(["cash", "stocks"]);
    });
});

describe("sampleProjection", () => {
    const point = (date: string, net: number, liabilities = 0): NetWorthProjectionPoint => ({
        date,
        assets: net + liabilities,
        liabilities,
        net_worth: net,
    });

    // 25 monthly points: two full years plus one.
    const monthly = (count: number, fn: (i: number) => NetWorthProjectionPoint) =>
        Array.from({ length: count }, (_, i) => fn(i));

    it("thins monthly points down to yearly and keeps the final one", () => {
        const points = monthly(25, i => point(`2026-${String((i % 12) + 1).padStart(2, "0")}-01`, i * 1000, 400_000 - i * 1000));
        const sampled = sampleProjection(points);
        // indices 0, 12, 24 — and 24 is also the last point, not duplicated.
        expect(sampled).toHaveLength(3);
        expect(sampled[sampled.length - 1].netWorth).toBe(24_000);
    });

    it("negates liabilities so debt renders below the zero line", () => {
        const points = monthly(13, i => point("2026-01-01", -100, 400_000 - i));
        expect(sampleProjection(points)[0].liabilities).toBe(-400_000);
    });

    it("says nothing when there is no debt and nothing changes", () => {
        const points = monthly(13, () => point("2026-01-01", 25_000));
        expect(sampleProjection(points)).toEqual([]);
    });

    it("still reports a debt-free household whose assets are growing", () => {
        const points = monthly(13, i => point("2026-01-01", 25_000 + i * 100));
        expect(sampleProjection(points).length).toBeGreaterThan(0);
    });

    it("handles an empty or single-point projection", () => {
        expect(sampleProjection([])).toEqual([]);
        expect(sampleProjection([point("2026-01-01", 100)])).toEqual([]);
    });
});
