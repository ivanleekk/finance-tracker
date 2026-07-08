import { type ReactNode, useState, useEffect } from "react";
import { Link } from "react-router";
import { useViewMode } from "../lib/ViewModeContext";
import { useCommandBar } from "../lib/CommandBarContext";
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

function HouseholdDiscoverabilityPill() {
    const { hasSeenHouseholdTooltip, dismissHouseholdTooltip } = useViewMode();
    // Capture "was this unseen at mount" once, so the tooltip finishes showing on THIS page
    // even though we immediately persist "seen" - future page loads won't show it again.
    const [showOnce] = useState(!hasSeenHouseholdTooltip);
    const [hovered, setHovered] = useState(false);
    const showTooltip = showOnce || hovered;

    useEffect(() => {
        if (!hasSeenHouseholdTooltip) dismissHouseholdTooltip();
    }, []);

    return (
        <div className="relative">
            <Link
                to="/households"
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
                className="flex items-center gap-1.5 border border-dashed border-base-300 dark:border-base-700 text-base-500 dark:text-base-400 rounded-lg px-3 py-1.5 text-[12px] font-semibold hover:text-secondary-600 dark:hover:text-secondary-400 hover:border-secondary-400 transition-colors"
            >
                <span className="text-secondary-500">＋</span> Household
            </Link>
            {showTooltip && (
                <div className="absolute top-11 left-0 z-40 w-60 bg-base-50 dark:bg-base-900 border border-base-200 dark:border-base-800 rounded-xl p-3.5 shadow-xl">
                    <div className="text-[12px] font-bold text-secondary-600 dark:text-secondary-400 mb-1">Share finances with someone?</div>
                    <p className="text-[11px] leading-relaxed text-base-500 dark:text-base-400">
                        Create a household to track shared money with a partner or family — kept separate from your private accounts. You can do this anytime.
                    </p>
                </div>
            )}
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
        <div className="h-16 flex-none border-b border-base-200 dark:border-base-800 flex items-center px-6 gap-4">
            <h1 className="font-display text-lg font-extrabold tracking-tight text-base-900 dark:text-base-50 whitespace-nowrap">
                {title}
            </h1>
            {hasHousehold ? <ViewModeSwitch /> : <HouseholdDiscoverabilityPill />}
            <div className="ml-auto flex items-center gap-3">
                <CommandBarTrigger placeholder={commandPlaceholder} />
                {cta}
            </div>
        </div>
    );
}
