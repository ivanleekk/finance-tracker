import { describe, it, expect } from "vitest";
import {
    groupHistory,
    groupKey,
    groupLabel,
    summarizeGroup,
    type GroupableHistoryItem,
} from "./historyGroups";

const item = (over: Partial<GroupableHistoryItem> & { date: Date }): GroupableHistoryItem => ({
    type: "expense",
    amountHome: 10,
    ...over,
});

describe("groupKey", () => {
    it("buckets by local day, month and year", () => {
        const d = new Date(2026, 2, 9, 23, 30);
        expect(groupKey(d, "day")).toBe("2026-03-09");
        expect(groupKey(d, "month")).toBe("2026-03");
        expect(groupKey(d, "year")).toBe("2026");
    });

    it("keeps a late-evening entry on the day the user filed it", () => {
        // A 23:00 local timestamp is the next UTC day in +02:00; keying off
        // local parts keeps it in the bucket the user sees it under.
        const late = new Date(2026, 0, 31, 23, 0);
        expect(groupKey(late, "day")).toBe("2026-01-31");
    });
});

describe("groupLabel", () => {
    const now = new Date(2026, 7, 20, 9, 0);

    it("says Today and Yesterday for day buckets", () => {
        expect(groupLabel(new Date(2026, 7, 20, 18, 0), "day", now)).toMatch(/^Today · /);
        expect(groupLabel(new Date(2026, 7, 19, 1, 0), "day", now)).toMatch(/^Yesterday · /);
        expect(groupLabel(new Date(2026, 7, 18), "day", now)).not.toMatch(/Today|Yesterday/);
    });

    it("does not use Today/Yesterday for month and year buckets", () => {
        expect(groupLabel(new Date(2026, 7, 20), "month", now)).not.toMatch(/Today|Yesterday/);
        expect(groupLabel(new Date(2026, 7, 20), "year", now)).toBe("2026");
    });
});

describe("summarizeGroup", () => {
    it("splits inflow from outflow and nets them", () => {
        const s = summarizeGroup([
            item({ date: new Date(2026, 7, 20), type: "income", amountHome: 3000 }),
            item({ date: new Date(2026, 7, 20), type: "expense", amountHome: 42.5 }),
            item({ date: new Date(2026, 7, 20), type: "buy", amountHome: 500 }),
            item({ date: new Date(2026, 7, 20), type: "sell", amountHome: 100 }),
        ]);
        expect(s.inflow).toBe(3100);
        expect(s.outflow).toBe(542.5);
        expect(s.net).toBe(2557.5);
    });

    it("ignores transfers on both legs", () => {
        // Moving 1000 between your own accounts is neither income nor spending.
        const s = summarizeGroup([
            item({ date: new Date(2026, 7, 20), type: "transfer_out", amountHome: 1000 }),
            item({ date: new Date(2026, 7, 20), type: "transfer_in", amountHome: 1000 }),
            item({ date: new Date(2026, 7, 20), type: "expense", amountHome: 20 }),
        ]);
        expect(s.inflow).toBe(0);
        expect(s.outflow).toBe(20);
        expect(s.net).toBe(-20);
    });

    it("counts rows it cannot convert instead of summing them at face value", () => {
        const s = summarizeGroup([
            item({ date: new Date(2026, 7, 20), type: "expense", amountHome: null }),
            item({ date: new Date(2026, 7, 20), type: "expense", amountHome: 20 }),
        ]);
        expect(s.outflow).toBe(20);
        expect(s.unconverted).toBe(1);
    });

    it("uses magnitudes, so a negative stored amount still reads as spending", () => {
        const s = summarizeGroup([item({ date: new Date(2026, 7, 20), type: "expense", amountHome: -30 })]);
        expect(s.outflow).toBe(30);
        expect(s.net).toBe(-30);
    });

    it("is all zeroes for a group of nothing but transfers", () => {
        const s = summarizeGroup([item({ date: new Date(2026, 7, 20), type: "transfer_in", amountHome: 500 })]);
        expect(s).toEqual({ inflow: 0, outflow: 0, net: 0, unconverted: 0 });
    });
});

describe("groupHistory", () => {
    const items = [
        item({ date: new Date(2026, 7, 20, 10, 0), type: "income", amountHome: 100 }),
        item({ date: new Date(2026, 7, 20, 8, 0), type: "expense", amountHome: 30 }),
        item({ date: new Date(2026, 7, 19, 8, 0), type: "expense", amountHome: 12 }),
        item({ date: new Date(2026, 6, 2, 8, 0), type: "expense", amountHome: 7 }),
        item({ date: new Date(2025, 6, 2, 8, 0), type: "income", amountHome: 5 }),
    ];

    it("buckets by day with a total per day", () => {
        const groups = groupHistory(items, "day", new Date(2026, 7, 20));
        expect(groups.map(g => g.key)).toEqual(["2026-08-20", "2026-08-19", "2026-07-02", "2025-07-02"]);
        expect(groups[0].items).toHaveLength(2);
        expect(groups[0].summary).toMatchObject({ inflow: 100, outflow: 30, net: 70 });
        expect(groups[1].summary).toMatchObject({ outflow: 12, net: -12 });
    });

    it("rolls the same items up by month", () => {
        const groups = groupHistory(items, "month", new Date(2026, 7, 20));
        expect(groups.map(g => g.key)).toEqual(["2026-08", "2026-07", "2025-07"]);
        expect(groups[0].summary).toMatchObject({ inflow: 100, outflow: 42, net: 58 });
    });

    it("rolls the same items up by year", () => {
        const groups = groupHistory(items, "year", new Date(2026, 7, 20));
        expect(groups.map(g => g.key)).toEqual(["2026", "2025"]);
        expect(groups[0].summary).toMatchObject({ inflow: 100, outflow: 49, net: 51 });
        expect(groups[1].summary).toMatchObject({ inflow: 5, outflow: 0, net: 5 });
    });

    it("preserves the incoming order of groups and of items inside them", () => {
        const groups = groupHistory(items, "day", new Date(2026, 7, 20));
        expect(groups[0].items[0].amountHome).toBe(100);
        expect(groups[0].items[1].amountHome).toBe(30);
    });

    it("returns nothing for an empty list", () => {
        expect(groupHistory([], "month")).toEqual([]);
    });
});
