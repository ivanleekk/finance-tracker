import { useEffect, useRef, useState } from "react";
import { accountKeyword } from "../../lib/commandParser";
import type { AccountResponse } from "../../types/types";

/**
 * Shapes, formatters and form plumbing shared between the ⌘K command bar's
 * container and its per-command views.
 *
 * These sat above `CommandBar()` in one file with the ten view components that
 * use them. They are React-agnostic apart from `useSyncedField`, and reading the
 * container no longer means scrolling past them first.
 */

export type Phase = "resting" | "typing" | "scanning" | "success";

/** Demo commands for the resting screen's quick-action tiles and "Try it" chips. Balance and
 * transfer only parse correctly if the typed text contains a real account's keyword (see
 * matchAccounts in commandParser.ts) - a hardcoded placeholder bank name would silently fail to
 * match and fall through to the expense branch, so these are built from the household's actual
 * accounts whenever any exist. */
export function getExampleChips(accounts: AccountResponse[]): { label: string; command: string }[] {
    const kw1 = accounts[0] ? accountKeyword(accounts[0]) : "Cash";
    const kw2 = accounts[1] ? accountKeyword(accounts[1]) : kw1;
    return [
        { label: "☕ Coffee", command: "coffee 5.20" },
        { label: "📈 Buy VOO", command: "buy 10 VOO" },
        { label: "🏦 Balance", command: accounts[0] ? `bal ${accounts[0].name} 51200` : "bal 51200" },
        { label: "💵 Dividend", command: "div AAPL 48" },
        { label: "⇄ Transfer", command: `transfer 500 from ${kw1} to ${kw2}` },
    ];
}

export const USD_SGD = 1.34;

export function fmt(n: number, dec = 0) {
    return Number(n).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
export function fmtA(n: number) {
    const dec = Number.isInteger(Number(n)) ? 0 : 2;
    return Number(n).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: 2 });
}

/** Two-way form field: mirrors `upstream` (the value parsed from the command text) while the
 * field isn't focused, so typing in the main input updates the GUI form live. While the user
 * is actively editing the field, local edits are preserved instead of being clobbered by the
 * upstream value on every keystroke; the edit is only pushed back into the command text (via
 * `onCommit`, which re-serializes it into the query string) on blur. */
export function useSyncedField<T>(upstream: T, onCommit: (v: T) => void) {
    const [value, setValue] = useState(upstream);
    const focused = useRef(false);
    useEffect(() => {
        if (!focused.current) setValue(upstream);
    }, [upstream]);
    return {
        value,
        setValue,
        onFocus: () => { focused.current = true; },
        onBlur: () => { focused.current = false; onCommit(value); },
    };
}

export const fieldClass = "w-full bg-base-50 dark:bg-base-950 border border-base-200 dark:border-base-800 rounded-lg px-2.5 py-1.5 text-sm text-base-900 dark:text-base-50 outline-none focus:border-secondary-400";
export const labelClass = "text-[10px] font-mono uppercase tracking-wider text-base-400 mb-1.5";
