import { cn } from "../../lib/utils";
import { useSearchParams } from "react-router";
import { format, subMonths, subYears, startOfYear } from "date-fns";

export type TimeframeOption = "1M" | "3M" | "6M" | "1Y" | "3Y" | "5Y" | "YTD" | "ALL";

const options: TimeframeOption[] = ["1M", "3M", "6M", "1Y", "3Y", "5Y", "YTD", "ALL"];

export function TimeframeSelector() {
    const [searchParams, setSearchParams] = useSearchParams();
    const activeTimeframe = (searchParams.get("timeframe") as TimeframeOption) || "ALL";

    const handleSelect = (option: TimeframeOption) => {
        const newParams = new URLSearchParams(searchParams);
        newParams.set("timeframe", option);

        let startDate: string | null = null;
        const now = new Date();

        switch (option) {
            case "1M": startDate = format(subMonths(now, 1), "yyyy-MM-dd"); break;
            case "3M": startDate = format(subMonths(now, 3), "yyyy-MM-dd"); break;
            case "6M": startDate = format(subMonths(now, 6), "yyyy-MM-dd"); break;
            case "1Y": startDate = format(subYears(now, 1), "yyyy-MM-dd"); break;
            case "3Y": startDate = format(subYears(now, 3), "yyyy-MM-dd"); break;
            case "5Y": startDate = format(subYears(now, 5), "yyyy-MM-dd"); break;
            case "YTD": startDate = format(startOfYear(now), "yyyy-MM-dd"); break;
            case "ALL": startDate = null; break;
        }

        if (startDate) {
            newParams.set("start_date", startDate);
        } else {
            newParams.delete("start_date");
        }
        
        setSearchParams(newParams);
    };

    return (
        <div className="flex bg-base-100 dark:bg-base-900/50 p-1 rounded-lg border border-base-200 dark:border-base-800">
            {options.map((option) => (
                <button
                    key={option}
                    onClick={() => handleSelect(option)}
                    className={cn(
                        "px-3 py-1 text-xs font-medium rounded-md transition-all",
                        activeTimeframe === option
                            ? "bg-white dark:bg-base-700 text-base-900 dark:text-base-50 shadow-sm"
                            : "text-base-500 dark:text-base-400 hover:text-base-700 dark:hover:text-base-200"
                    )}
                >
                    {option}
                </button>
            ))}
        </div>
    );
}
