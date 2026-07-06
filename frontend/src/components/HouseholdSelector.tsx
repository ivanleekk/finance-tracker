import { useHousehold } from "../lib/HouseholdContext";
import { Users, ChevronDown } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { cn } from "../lib/utils";
import { useRevalidator } from "react-router";

export function HouseholdSelector() {
    const { households, activeHousehold, setActiveHousehold, isLoading } = useHousehold();
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const revalidator = useRevalidator();

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
        return (
            <div className="mx-2 mb-4 h-12 animate-pulse rounded-lg bg-base-100 dark:bg-base-800" />
        );
    }

    if (households.length === 0) return null;

    return (
        <div className="relative mx-2 mb-4" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-lg border border-base-200 dark:border-base-800 bg-white dark:bg-base-900 p-2.5 text-left transition-all hover:bg-base-50 dark:hover:bg-base-800 focus:outline-none focus:ring-2 focus:ring-primary-500/20",
                    isOpen && "border-primary-500 ring-2 ring-primary-500/20"
                )}
            >
                <div className="flex items-center gap-2 overflow-hidden">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-primary-50 dark:bg-primary-950/30 text-primary-600 dark:text-primary-400">
                        <Users size={16} />
                    </div>
                    <div className="overflow-hidden">
                        <p className="truncate text-xs font-medium text-base-500 dark:text-base-400 uppercase tracking-wider">Active Household</p>
                        <p className="truncate text-sm font-semibold text-base-900 dark:text-base-50">
                            {activeHousehold?.name || "Select Household"}
                        </p>
                    </div>
                </div>
                <ChevronDown size={16} className={cn("text-base-400 transition-transform", isOpen && "rotate-180")} />
            </button>

            {isOpen && (
                <div className="absolute left-0 top-full z-50 mt-1 w-full rounded-lg border border-base-200 dark:border-base-800 bg-white dark:bg-base-900 p-1 shadow-lg">
                    {households.map((household) => (
                        <button
                            key={household.id}
                            onClick={() => {
                                setActiveHousehold(household);
                                setIsOpen(false);
                                revalidator.revalidate();
                            }}
                            className={cn(
                                "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-base-50 dark:hover:bg-base-800",
                                activeHousehold?.id === household.id ? "bg-primary-50 dark:bg-primary-900/20 font-semibold text-primary-700 dark:text-primary-400" : "text-base-700 dark:text-base-300"
                            )}
                        >
                            <span className="truncate">{household.name}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
