import { useHousehold } from "../lib/HouseholdContext";
import { Users, ChevronDown } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { cn } from "../lib/utils";

export function HouseholdSelector() {
    const { households, activeHousehold, setActiveHousehold, isLoading } = useHousehold();
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    if (isLoading) {
        return (
            <div className="mx-2 mb-4 h-12 animate-pulse rounded-lg bg-base-100" />
        );
    }

    if (households.length === 0) return null;

    return (
        <div className="relative mx-2 mb-4" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-lg border border-base-200 bg-white p-2.5 text-left transition-all hover:bg-base-50 focus:outline-none focus:ring-2 focus:ring-primary-500/20",
                    isOpen && "border-primary-500 ring-2 ring-primary-500/20"
                )}
            >
                <div className="flex items-center gap-2 overflow-hidden">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-primary-50 text-primary-600">
                        <Users size={16} />
                    </div>
                    <div className="overflow-hidden">
                        <p className="truncate text-xs font-medium text-base-500 uppercase tracking-wider">Active Household</p>
                        <p className="truncate text-sm font-semibold text-base-900">
                            {activeHousehold?.name || "Select Household"}
                        </p>
                    </div>
                </div>
                <ChevronDown size={16} className={cn("text-base-400 transition-transform", isOpen && "rotate-180")} />
            </button>

            {isOpen && (
                <div className="absolute left-0 top-full z-50 mt-1 w-full rounded-lg border border-base-200 bg-white p-1 shadow-lg">
                    {households.map((household) => (
                        <button
                            key={household.id}
                            onClick={() => {
                                setActiveHousehold(household);
                                setIsOpen(false);
                            }}
                            className={cn(
                                "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-base-50",
                                activeHousehold?.id === household.id ? "bg-primary-50 font-semibold text-primary-700" : "text-base-700"
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
