import { describe, it, expect } from "vitest";
import {
    budgetTone,
    budgetBarPercent,
    periodElapsedPercent,
    runwayLabel,
    runwayTone,
    frequencyLabel,
    groupOccurrencesByMonth,
    netUpcoming,
} from "./budgets";
import type { BudgetStatusRow, EmergencyFundResponse, UpcomingOccurrence } from "../types/types";

// These helpers make the judgement calls the UI relies on: when a budget is
// "at risk" rather than merely spent, and what to say when the runway is
// undefined rather than infinite.

const row = (over: Partial<BudgetStatusRow> = {}): BudgetStatusRow => ({
    budget_id: "b",
    category_id: "c",
    category_name: "Dining",
    period: "monthly",
    is_private: false,
    limit: 600,
    spent: 200,
    remaining: 400,
    percent_used: 33.3,
    period_start: "2026-03-01",
    period_end: "2026-03-31",
    days_elapsed: 10,
    days_total: 31,
    projected_spend: 620,
    projected_over: true,
    ...over,
});

const fund = (over: Partial<EmergencyFundResponse> = {}): EmergencyFundResponse => ({
    household_id: "h",
    base_currency: "USD",
    as_of: "2026-07-15",
    liquid_total: 12000,
    average_monthly_expenses: 2000,
    months_covered: 6,
    target_months: 6,
    target_amount: 12000,
    shortfall: 0,
    months_of_history: 6,
    on_track: true,
    ...over,
});

describe("budgetTone", () => {
    it("flags a budget already overspent", () => {
        expect(budgetTone(row({ spent: 700, limit: 600 }))).toBe("over");
    });

    it("flags a budget on pace to overspend before it actually has", () => {
        // The whole point of a projection: warn on the 10th, not the 30th.
        expect(budgetTone(row({ spent: 200, limit: 600, projected_over: true }))).toBe("at-risk");
    });

    it("leaves a budget within pace alone", () => {
        expect(budgetTone(row({ spent: 100, limit: 600, projected_over: false }))).toBe("ok");
    });

    it("treats spending exactly the limit as not yet over", () => {
        expect(budgetTone(row({ spent: 600, limit: 600, projected_over: false }))).toBe("ok");
    });
});

describe("budgetBarPercent", () => {
    it("passes through a normal percentage", () => {
        expect(budgetBarPercent(row({ percent_used: 42.5 }))).toBe(42.5);
    });

    it("clamps an overspent budget to a full bar", () => {
        expect(budgetBarPercent(row({ percent_used: 250 }))).toBe(100);
    });

    it("coerces any non-finite percentage to zero rather than rendering a broken bar", () => {
        expect(budgetBarPercent(row({ percent_used: NaN }))).toBe(0);
        expect(budgetBarPercent(row({ percent_used: Infinity }))).toBe(0);
    });
});

describe("periodElapsedPercent", () => {
    it("reports how far through the period we are", () => {
        expect(periodElapsedPercent(row({ days_elapsed: 10, days_total: 20 }))).toBe(50);
    });

    it("survives a zero-length period without dividing by zero", () => {
        expect(periodElapsedPercent(row({ days_elapsed: 5, days_total: 0 }))).toBe(0);
    });

    it("clamps beyond the end of the period", () => {
        expect(periodElapsedPercent(row({ days_elapsed: 40, days_total: 31 }))).toBe(100);
    });
});

describe("runwayLabel", () => {
    it("formats months to one decimal", () => {
        expect(runwayLabel(fund({ months_covered: 6 }))).toBe("6.0 months");
        expect(runwayLabel(fund({ months_covered: 2.35 }))).toBe("2.4 months");
    });

    it("says 'not enough data' rather than implying an infinite runway", () => {
        // A household that hasn't logged expenses has an undefined runway. Saying
        // "∞" would be false reassurance.
        expect(runwayLabel(fund({ months_covered: null }))).toBe("Not enough data");
        expect(runwayLabel(fund({ months_covered: undefined }))).toBe("Not enough data");
    });

    it("caps the display at the backend's ceiling", () => {
        expect(runwayLabel(fund({ months_covered: 99 }))).toBe("99+ months");
    });
});

describe("runwayTone", () => {
    it("treats under a month as critical", () => {
        expect(runwayTone(fund({ months_covered: 0.5, target_months: 6 }))).toBe("critical");
    });

    it("treats under target as low", () => {
        expect(runwayTone(fund({ months_covered: 3, target_months: 6 }))).toBe("low");
    });

    it("treats at or above target as ok", () => {
        expect(runwayTone(fund({ months_covered: 6, target_months: 6 }))).toBe("ok");
        expect(runwayTone(fund({ months_covered: 9, target_months: 6 }))).toBe("ok");
    });

    it("reports unknown when there is no burn rate", () => {
        expect(runwayTone(fund({ months_covered: null }))).toBe("unknown");
    });
});

describe("frequencyLabel", () => {
    it("renders each frequency readably", () => {
        expect(frequencyLabel("monthly")).toBe("Monthly");
        expect(frequencyLabel("biweekly")).toBe("Every 2 weeks");
    });

    it("falls back to the raw value for anything unrecognised", () => {
        expect(frequencyLabel("fortnightly")).toBe("fortnightly");
    });
});

describe("groupOccurrencesByMonth", () => {
    const occurrence = (date: string, over: Partial<UpcomingOccurrence> = {}): UpcomingOccurrence => ({
        recurring_transaction_id: "r",
        description: "Rent",
        category_name: "Rent",
        account_name: "Checking",
        date,
        amount: 1800,
        currency: "USD",
        transaction_type: "expense",
        ...over,
    });

    it("groups by calendar month in chronological order", () => {
        const groups = groupOccurrencesByMonth([
            occurrence("2026-03-01"),
            occurrence("2026-01-01"),
            occurrence("2026-02-01"),
            occurrence("2026-01-15"),
        ]);

        expect(groups.map(g => g.month)).toEqual(["2026-01", "2026-02", "2026-03"]);
        expect(groups[0].items).toHaveLength(2);
        expect(groups[0].label).toBe("January 2026");
    });

    it("returns nothing for an empty schedule", () => {
        expect(groupOccurrencesByMonth([])).toEqual([]);
    });
});

describe("netUpcoming", () => {
    const item = (amount: number, type: "income" | "expense"): UpcomingOccurrence => ({
        recurring_transaction_id: "r",
        description: null,
        category_name: "x",
        account_name: "y",
        date: "2026-03-01",
        amount,
        currency: "USD",
        transaction_type: type,
    });

    it("nets income against expenses", () => {
        expect(netUpcoming([item(5000, "income"), item(1800, "expense"), item(200, "expense")]))
            .toBe(3000);
    });

    it("returns a negative figure when commitments exceed income", () => {
        expect(netUpcoming([item(1000, "income"), item(2500, "expense")])).toBe(-1500);
    });

    it("ignores a malformed amount rather than returning NaN", () => {
        const broken = { ...item(0, "expense"), amount: undefined as unknown as number };
        expect(netUpcoming([item(1000, "income"), broken])).toBe(1000);
    });

    it("is zero for an empty schedule", () => {
        expect(netUpcoming([])).toBe(0);
    });
});
