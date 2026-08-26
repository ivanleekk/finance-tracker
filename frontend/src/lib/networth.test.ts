import { describe, it, expect } from "vitest";
import {
    latestBalanceHome,
    summarizeAccounts,
    cashChartAccountsOf,
    sampleProjection,
    netWorthBreakdown,
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

describe("summarizeAccounts with money owed", () => {
    // The hole this fills: splitting a $120 bill takes $120 out of the bank and
    // records $40 of spending. Without the receivable, net worth reports the
    // other $80 as having simply evaporated.
    const savings = account({ history: [bal("2026-01-01", 1_000)] });

    it("counts money owed to you as an asset", () => {
        const totals = summarizeAccounts([savings], { owedToYou: 80, youOwe: 0 });
        expect(totals.totalAssets).toBe(1_080);
        expect(totals.net).toBe(1_080);
        expect(totals.receivables).toBe(80);
    });

    it("keeps money owed to you out of liquid now", () => {
        // You cannot spend it this week. Treating it as spendable is how a
        // runway starts lying — the same reason property is excluded.
        const totals = summarizeAccounts([savings], { owedToYou: 80, youOwe: 0 });
        expect(totals.liquidNow).toBe(1_000);
    });

    it("counts money you owe as a liability", () => {
        const totals = summarizeAccounts([savings], { owedToYou: 0, youOwe: 45 });
        expect(totals.liabilities).toBe(45);
        expect(totals.net).toBe(955);
    });

    it("nets the two directions into net worth without merging them", () => {
        const totals = summarizeAccounts([savings], { owedToYou: 80, youOwe: 45 });
        expect(totals.receivables).toBe(80);
        expect(totals.liabilities).toBe(45);
        expect(totals.net).toBe(1_035);
    });

    it("changes nothing when nobody owes anybody", () => {
        expect(summarizeAccounts([savings])).toEqual(summarizeAccounts([savings], { owedToYou: 0, youOwe: 0 }));
    });

    it("survives a non-finite total rather than poisoning net worth", () => {
        const totals = summarizeAccounts([savings], { owedToYou: NaN, youOwe: 45 });
        expect(totals.totalAssets).toBe(1_000);
        expect(totals.net).toBe(955);
    });
});

describe("netWorthBreakdown with money owed", () => {
    const savings = account({ history: [bal("2026-01-01", 1_000)] });

    it("gives money owed its own slice rather than burying it in Other", () => {
        const breakdown = netWorthBreakdown([savings], 0, { owedToYou: 80, youOwe: 0 });
        const owed = breakdown.slices.find(s => s.key === "owed");
        expect(owed?.value).toBe(80);
        expect(breakdown.slices.find(s => s.key === "other")).toBeUndefined();
    });

    it("omits the slice when nobody owes you", () => {
        const breakdown = netWorthBreakdown([savings], 0);
        expect(breakdown.slices.find(s => s.key === "owed")).toBeUndefined();
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

describe("netWorthBreakdown", () => {
    it("buckets cash, retirement and property, and adds investments as their own slice", () => {
        const savings = account({ history: [bal("2026-01-01", 10_000)] });
        const cpf = account({ liquidity: LiquidityStatus.TimeLocked, history: [bal("2026-01-01", 30_000)] });
        const home = account({ liquidity: LiquidityStatus.Illiquid, history: [bal("2026-01-01", 500_000)] });

        const { slices, sliceTotal } = netWorthBreakdown([savings, cpf, home], 20_000);

        expect(slices).toEqual([
            { key: "cash", label: "Cash", value: 10_000 },
            { key: "investments", label: "Investments", value: 20_000 },
            { key: "retirement", label: "Retirement & locked", value: 30_000 },
            { key: "property", label: "Property", value: 500_000 },
        ]);
        expect(sliceTotal).toBe(560_000);
    });

    it("reports liabilities alongside the slices rather than as a negative wedge", () => {
        const mortgage = account({ kind: AccountKind.Liability, history: [bal("2026-01-01", 400_000)] });
        const home = account({ liquidity: LiquidityStatus.Illiquid, history: [bal("2026-01-01", 500_000)] });

        const { slices, liabilities } = netWorthBreakdown([mortgage, home], 0);

        expect(liabilities).toBe(400_000);
        expect(slices.find(s => s.key === "liabilities")).toBeUndefined();
    });

    it("drops a negative bucket (an overdrawn household) instead of an impossible negative wedge", () => {
        const overdrawn = account({ history: [bal("2026-01-01", -12_000)] });
        const home = account({ liquidity: LiquidityStatus.Illiquid, history: [bal("2026-01-01", 500_000)] });

        const { slices, sliceTotal } = netWorthBreakdown([overdrawn, home], 0);

        expect(slices).toEqual([{ key: "property", label: "Property", value: 500_000 }]);
        // sliceTotal is the denominator for each slice's %, so it must match
        // the visible slices — not gross assets, which the excluded negative
        // cash bucket would otherwise drag below the property total.
        expect(sliceTotal).toBe(500_000);
    });

    it("buckets a market_liquid account as 'other' rather than dropping it", () => {
        const brokerageCash = account({ liquidity: LiquidityStatus.MarketLiquid, history: [bal("2026-01-01", 5_000)] });
        const { slices } = netWorthBreakdown([brokerageCash], 0);
        expect(slices).toEqual([{ key: "other", label: "Other assets", value: 5_000 }]);
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
