import { describe, it, expect } from "vitest";
import {
    assessSplit,
    counterpartyTotals,
    countsAsSpending,
    evenSplitRemainder,
    parseMoney,
} from "./reimbursements";
import type { CounterpartyBalanceResponse } from "../types/types";

describe("assessSplit", () => {
    it("leaves you the remainder of the bill", () => {
        expect(assessSplit(120, [{ counterpartyId: "alice", amount: 80 }])).toEqual({
            kind: "valid",
            yourShare: 40,
            owed: 80,
        });
    });

    it("sums several people's shares", () => {
        const result = assessSplit(300, [
            { counterpartyId: "alice", amount: 100 },
            { counterpartyId: "bob", amount: 100 },
        ]);
        expect(result).toEqual({ kind: "valid", yourShare: 100, owed: 200 });
    });

    it("lets you front the whole thing", () => {
        // Paying for someone entirely is a normal thing to do, and it should
        // charge your budget nothing rather than being rejected as a mistake.
        expect(assessSplit(90, [{ counterpartyId: "alice", amount: 90 }])).toEqual({
            kind: "valid",
            yourShare: 0,
            owed: 90,
        });
    });

    it("refuses a combined share larger than the bill instead of clamping it", () => {
        // Clamping would hide a typo behind a plausible number.
        const result = assessSplit(120, [
            { counterpartyId: "alice", amount: 100 },
            { counterpartyId: "bob", amount: 100 },
        ]);
        expect(result.kind).toBe("invalid");
    });

    it("refuses the same person appearing twice", () => {
        const result = assessSplit(120, [
            { counterpartyId: "alice", amount: 40 },
            { counterpartyId: "alice", amount: 40 },
        ]);
        expect(result.kind).toBe("invalid");
    });

    it("says nothing until the bill and every entry has an amount", () => {
        expect(assessSplit(120, []).kind).toBe("incomplete");
        expect(assessSplit(null, [{ counterpartyId: "alice", amount: 80 }]).kind).toBe(
            "incomplete",
        );
        expect(assessSplit(120, [{ counterpartyId: "alice", amount: null }]).kind).toBe(
            "incomplete",
        );
        expect(assessSplit(120, [{ counterpartyId: "alice", amount: 0 }]).kind).toBe(
            "incomplete",
        );
    });

    it("treats nonsense as nothing entered", () => {
        expect(assessSplit(NaN, [{ counterpartyId: "alice", amount: 80 }]).kind).toBe(
            "incomplete",
        );
        expect(
            assessSplit(120, [{ counterpartyId: "alice", amount: Infinity }]).kind,
        ).toBe("incomplete");
    });
});

describe("evenSplitRemainder", () => {
    it("divides what's left after specified shares across the rest", () => {
        expect(evenSplitRemainder(300, [100], 2)).toBe(100);
    });

    it("is null when there's nobody left to split the remainder among", () => {
        expect(evenSplitRemainder(300, [100], 0)).toBeNull();
    });

    it("is null when the specified shares already cover the bill", () => {
        expect(evenSplitRemainder(100, [100], 1)).toBeNull();
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
        { counterparty_id: "alice", counterparty_name: "Alice", direction: "owed_to_you", amount: 80, owner_user_id: null },
        { counterparty_id: "bob", counterparty_name: "Bob", direction: "owed_to_you", amount: 20, owner_user_id: null },
        { counterparty_id: "alice", counterparty_name: "Alice", direction: "you_owe", amount: 45, owner_user_id: null },
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
        expect(countsAsSpending("Reimbursement", false)).toBe(false);
    });

    it("keeps a transfer out of the spending breakdown", () => {
        // Moving your own money between your own accounts is not spending — you
        // still have it. A transfer's withdrawal leg is an expense row with a
        // real category, so nothing else would exclude it.
        expect(countsAsSpending("Transfer", true)).toBe(false);
    });

    it("excludes a transfer whatever its category is called", () => {
        // The transfer flag is the signal, not the category name: a household
        // that renamed its Transfer category must not start counting them.
        expect(countsAsSpending("Moving money", true)).toBe(false);
        expect(countsAsSpending(null, true)).toBe(false);
    });

    it("leaves ordinary categories alone", () => {
        expect(countsAsSpending("Dining", false)).toBe(true);
        expect(countsAsSpending("Investment", false)).toBe(true);
        expect(countsAsSpending(undefined, false)).toBe(true);
    });
});
