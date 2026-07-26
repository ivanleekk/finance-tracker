import { type ReactNode } from "react";
import { useViewMode } from "../lib/ViewModeContext";
import { useCommandBar } from "../lib/CommandBarContext";
import { HouseholdSelector } from "./HouseholdSelector";
import type { ViewMode } from "../types/types";

const MODES: { key: ViewMode; label: string }[] = [
    { key: "private", label: "🔒 Private" },
    { key: "household", label: "Household" },
    { key: "blended", label: "◑ Blended" },
];

function ViewModeSwitch() {
    const { viewMode, setViewMode } = useViewMode();
    return (
        <div className="flex items-center bg-base-100 dark:bg-base-900/60 border border-base-200 dark:border-base-800 rounded-xl p-1 gap-0.5">
            {MODES.map(m => {
                const active = viewMode === m.key;
                const isBlended = m.key === "blended";
                return (
                    <button
                        key={m.key}
                        onClick={() => setViewMode(m.key)}
                        className={
                            "px-3 py-1.5 rounded-lg text-[11.5px] font-semibold transition-colors whitespace-nowrap " +
                            (active
                                ? isBlended
                                    ? "bg-gradient-to-br from-secondary-500 to-secondary-700 text-white"
                                    : "bg-white dark:bg-base-700 text-base-900 dark:text-base-50 shadow-sm"
                                : "text-base-500 dark:text-base-400 hover:text-base-700 dark:hover:text-base-200")
                        }
                    >
                        {m.label}
                    </button>
                );
            })}
        </div>
    );
}

function CommandBarTrigger({ placeholder }: { placeholder: string }) {
    const { open } = useCommandBar();
    return (
        <button
            onClick={open}
            className="flex items-center gap-2 bg-base-100 dark:bg-base-900 border border-base-200 dark:border-base-800 rounded-lg px-3 py-2 w-full max-w-[220px] text-left hover:border-secondary-400/60 transition-colors"
        >
            <span className="text-secondary-500 font-mono text-xs font-semibold">⌘K</span>
            <span className="text-[12px] font-medium text-base-500 dark:text-base-500 truncate">{placeholder}</span>
        </button>
    );
}

export function TopBar({
    title,
    cta,
    commandPlaceholder = "Log or find…",
}: {
    title: string;
    cta?: ReactNode;
    commandPlaceholder?: string;
}) {
    const { hasHousehold } = useViewMode();

    return (
        // Below sm the controls wrap onto their own rows rather than overflowing
        // the viewport; from sm up this is the original single 64px-tall row.
        <div className="flex-none border-b border-base-200 dark:border-base-800 flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:h-16 sm:flex-nowrap sm:px-6 sm:py-0">
            <h1 className="font-display text-lg font-extrabold tracking-tight text-base-900 dark:text-base-50 whitespace-nowrap">
                {title}
            </h1>
            <HouseholdSelector />
            {hasHousehold && <ViewModeSwitch />}
            <div className="ml-auto flex items-center gap-3">
                {/* ⌘K is a keyboard affordance — hide it where there's no keyboard
                    and no room. Everything it reaches is still in the nav. */}
                <div className="hidden lg:block">
                    <CommandBarTrigger placeholder={commandPlaceholder} />
                </div>
                {cta}
            </div>
        </div>
    );
}
