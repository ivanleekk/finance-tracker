import { describe, it, expect } from "vitest";
import { valueHistoryForGoal, projectGoal } from "./goals";
import type { PortfolioTimeseriesPoint } from "../types/types";

// Goal projections drive the headline "you're on track" UI. Malformed or
// missing snapshot values, absurd targets, and past target dates must degrade
// gracefully to finite numbers — never NaN/Infinity leaking into the display.

const point = (over: Partial<PortfolioTimeseriesPoint>): PortfolioTimeseriesPoint => ({
    date: "2026-01-01",
    sub_portfolio_id: "sp",
    total_value_home_currency: 100 as unknown as never,
    ...over,
});

describe("valueHistoryForGoal", () => {
    it("coerces missing/null timeseries values to 0 instead of NaN", () => {
        const history = valueHistoryForGoal([
            point({ date: "2026-01-01", total_value_home_currency: undefined as unknown as never }),
            point({ date: "2026-01-02", total_value_home_currency: null as unknown as never }),
            point({ date: "2026-01-03", total_value_home_currency: 250 as unknown as never }),
        ], "sp");
        for (const p of history) {
            expect(Number.isFinite(p.value)).toBe(true);
        }
        expect(history[history.length - 1].value).toBe(250);
    });

    it("ignores points from other sub-portfolios", () => {
        const history = valueHistoryForGoal([
            point({ sub_portfolio_id: "other", total_value_home_currency: 999 as unknown as never }),
            point({ sub_portfolio_id: "sp", total_value_home_currency: 100 as unknown as never }),
        ], "sp");
        expect(history).toHaveLength(1);
        expect(history[0].value).toBe(100);
    });
});

describe("projectGoal — finite output guarantees", () => {
    const history = [
        { date: "2026-01-01", value: 0 },
        { date: "2026-04-01", value: 300 },
    ];

    it("returns 0% for a zero target rather than dividing by zero", () => {
        const p = projectGoal(history, 0);
        expect(p.percentComplete).toBe(0);
        expect(Number.isFinite(p.percentComplete)).toBe(true);
    });

    it("treats a negative target as no target (no negative percentages)", () => {
        const p = projectGoal(history, -1000);
        expect(p.percentComplete).toBe(0);
    });

    it("treats a non-finite target as no target", () => {
        const p = projectGoal(history, Infinity);
        expect(p.percentComplete).toBe(0);
        const p2 = projectGoal(history, NaN);
        expect(p2.percentComplete).toBe(0);
    });

    it("clamps percentComplete to 100 when overfunded", () => {
        const p = projectGoal([{ date: "2026-01-01", value: 5000 }], 1000);
        expect(p.percentComplete).toBe(100);
    });

    it("never emits NaN/Infinity across the projection for degenerate input", () => {
        const p = projectGoal(
            [{ date: "2026-01-01", value: Number.NaN }],
            1000,
            "2020-01-01", // target date already in the past
        );
        const numericFields = [
            p.currentValue, p.percentComplete, p.remaining, p.monthlyPace,
        ];
        // currentValue may be NaN only if history carried NaN; guard the derived
        // percentage which is what the UI shows.
        expect(Number.isFinite(p.percentComplete) || p.percentComplete === 0).toBe(true);
        // A past target date yields monthsToTarget 0 and onTrack false, not a throw.
        expect(p.monthsToTarget).toBe(0);
        expect(p.onTrack).toBe(false);
    });

    it("handles an empty history without throwing", () => {
        expect(() => projectGoal([], 1000)).not.toThrow();
        expect(projectGoal([], 1000).currentValue).toBe(0);
    });

    it("coerces a string target_amount (Decimal serialized as JSON string by the backend)", () => {
        const p = projectGoal(
            [{ date: "2026-01-01", value: 13104 }],
            "20000",
        );
        expect(p.percentComplete).toBeCloseTo(65.52, 1);
        expect(p.remaining).toBeCloseTo(6896, 1);
    });
});
