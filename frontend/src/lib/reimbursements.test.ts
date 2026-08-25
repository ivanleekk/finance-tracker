import { describe, it, expect } from "vitest";
import { assessSplit, counterpartyTotals, countsAsSpending, parseMoney } from "./reimbursements";
import type { CounterpartyBalanceResponse } from "../types/types";

describe("assessSplit", () => {
    it("leaves you the remainder of the bill", () => {
        expect(assessSplit(120, 80)).toEqual({ kind: "valid", yourShare: 40, owed: 80 });
    });

    it("lets you front the whole thing", () => {
        // Paying for someone entirely is a normal thing to do, and it should
        // charge your budget nothing rather than being rejected as a mistake.
        expect(assessSplit(90, 90)).toEqual({ kind: "valid", yourShare: 0, owed: 90 });
    });

    it("refuses a share larger than the bill instead of clamping it", () => {
        // Clamping would hide a typo behind a plausible number.
        const result = assessSplit(120, 200);
        expect(result.kind).toBe("invalid");
    });

    it("says nothing until both numbers are there", () => {
        expect(assessSplit(120, null).kind).toBe("incomplete");
        expect(assessSplit(null, 80).kind).toBe("incomplete");
        expect(assessSplit(120, 0).kind).toBe("incomplete");
    });

    it("treats nonsense as nothing entered", () => {
        expect(assessSplit(NaN, 80).kind).toBe("incomplete");
        expect(assessSplit(120, Infinity).kind).toBe("incomplete");
    });
});

describe("parseMoney", () => {
    it("reads a blank field as nothing rather than zero", () => {
        expect(parseMoney("")).toBeNull();
        expect(parseMoney("   ")).toBeNull();
    });

    it("rejects text", () => {
        expect(parseMoney("abc")).toBeNull();
    });

    it("reads a number", () => {
        expect(parseMoney(" 12.50 ")).toBe(12.5);
    });
});

describe("counterpartyTotals", () => {
    const rows: CounterpartyBalanceResponse[] = [
        { counterparty_name: "Alice", direction: "owed_to_you", amount: 80 },
        { counterparty_name: "Bob", direction: "owed_to_you", amount: 20 },
        { counterparty_name: "Alice", direction: "you_owe", amount: 45 },
    ];

    it("keeps the two directions apart", () => {
        // Netting to 55 would lose the fact that there are two things to settle,
        // with two different people, in two different directions.
        expect(counterpartyTotals(rows)).toEqual({ owedToYou: 100, youOwe: 45 });
    });

    it("is zero for nobody", () => {
        expect(counterpartyTotals([])).toEqual({ owedToYou: 0, youOwe: 0 });
    });
});

describe("countsAsSpending", () => {
    it("keeps a repayment out of the spending breakdown", () => {
        // Otherwise the same dinner is charged twice: once when the bill was
        // paid, and again when the debt was settled.
        expect(countsAsSpending("Reimbursement")).toBe(false);
    });

    it("leaves ordinary categories alone", () => {
        expect(countsAsSpending("Dining")).toBe(true);
        expect(countsAsSpending("Investment")).toBe(true);
        expect(countsAsSpending(undefined)).toBe(true);
    });
});
