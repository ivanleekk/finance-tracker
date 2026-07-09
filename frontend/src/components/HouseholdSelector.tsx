import { useHousehold } from "../lib/HouseholdContext";
import { useViewMode } from "../lib/ViewModeContext";
import { Users, ChevronDown, Plus } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { cn } from "../lib/utils";
import { Link, useRevalidator } from "react-router";

/**
 * Compact active-household switcher for the TopBar. Also carries the one-time
 * "share finances with someone?" discoverability tooltip that used to live on
 * the standalone "+ Household" pill — creating a household now lives inside
 * this dropdown.
 */
export function HouseholdSelector() {
    const { households, activeHousehold, setActiveHousehold, isLoading } = useHousehold();
    const { hasSeenHouseholdTooltip, dismissHouseholdTooltip } = useViewMode();
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const revalidator = useRevalidator();

    // Capture "was this unseen at mount" once, so the tooltip finishes showing on THIS page
    // even though we immediately persist "seen" - future page loads won't show it again.
    const [showTooltipOnce] = useState(!hasSeenHouseholdTooltip);
    useEffect(() => {
        if (!hasSeenHouseholdTooltip) dismissHouseholdTooltip();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }

        function handleEscape(event: KeyboardEvent) {
            if (event.key === "Escape") {
                setIsOpen(false);
            }
        }

        document.addEventListener("mousedown", handleClickOutside);
        document.addEventListener("keydown", handleEscape);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
            document.removeEventListener("keydown", handleEscape);
        };
    }, []);

    if (isLoading) {
        return <div className="h-9 w-36 animate-pulse rounded-xl bg-base-100 dark:bg-base-800" />;
    }

    // Brand-new user with no household yet: fall back to the old dashed "add" pill.
    if (households.length === 0) {
        return (
            <Link
                to="/households"
                className="flex items-center gap-1.5 border border-dashed border-base-300 dark:border-base-700 text-base-500 dark:text-base-400 rounded-xl px-3 py-1.5 text-[12px] font-semibold hover:text-secondary-600 dark:hover:text-secondary-400 hover:border-secondary-400 transition-colors"
            >
                <span className="text-secondary-500">＋</span> Household
            </Link>
        );
    }

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    "flex items-center gap-2 max-w-[200px] bg-base-100 dark:bg-base-900/60 border border-base-200 dark:border-base-800 rounded-xl px-3 py-1.5 text-left transition-colors hover:border-primary-400/60 focus:outline-none focus:ring-2 focus:ring-primary-500/20",
                    isOpen && "border-primary-500 ring-2 ring-primary-500/20"
                )}
            >
                <Users size={14} className="shrink-0 text-primary-600 dark:text-primary-400" />
                <span className="truncate text-[12px] font-semibold text-base-900 dark:text-base-50">
                    {activeHousehold?.name || "Select household"}
                </span>
                <ChevronDown size={14} className={cn("shrink-0 text-base-400 transition-transform", isOpen && "rotate-180")} />
            </button>

            {isOpen && (
                <div className="absolute left-0 top-full z-50 mt-1.5 w-56 rounded-xl border border-base-200 dark:border-base-800 bg-white dark:bg-base-900 p-1 shadow-xl">
                    <p className="px-3 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-base-400 dark:text-base-500">Active household</p>
                    {households.map((household) => (
                        <button
                            key={household.id}
                            onClick={() => {
                                setActiveHousehold(household);
                                setIsOpen(false);
                                revalidator.revalidate();
                            }}
                            className={cn(
                                "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-base-50 dark:hover:bg-base-800",
                                activeHousehold?.id === household.id ? "bg-primary-50 dark:bg-primary-900/20 font-semibold text-primary-700 dark:text-primary-400" : "text-base-700 dark:text-base-300"
                            )}
                        >
                            <span className="truncate">{household.name}</span>
                        </button>
                    ))}
                    <div className="my-1 border-t border-base-100 dark:border-base-800" />
                    <Link
                        to="/households"
                        onClick={() => setIsOpen(false)}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-base-600 dark:text-base-400 transition-colors hover:bg-base-50 dark:hover:bg-base-800 hover:text-secondary-600 dark:hover:text-secondary-400"
                    >
                        <Plus size={14} className="text-secondary-500" /> New household
                    </Link>
                </div>
            )}

            {showTooltipOnce && !isOpen && (
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
