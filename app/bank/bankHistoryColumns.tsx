import { ColumnDef } from "@tanstack/react-table";
import { Button } from "~/components/ui/button";
import { ArrowUpDown } from "lucide-react";
import { Fragment } from "react/jsx-runtime";

// Define the type for bank history
export type bankHistory = {
    bankName: string;
    currentBalance: number;
    latestDate: string;
    history: {
        date: string; // ISO string date
        balance: number; // Balance for the given date
    }[];
};

// Define columns for the bank history table
export const bankHistoryColumns: ColumnDef<bankHistory>[] = [
    // Bank Name Column
    {
        header: ({ column }) => (
            <Button
                variant="tableHead"
                onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            >
                Bank
                <ArrowUpDown />
            </Button>
        ),
        accessorKey: "bankName",
    },

    // Current Balance Column
    {
        header: ({ column }) => (
            <Button
                variant="tableHead"
                onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            >
                Current Balance
                <ArrowUpDown />
            </Button>
        ),
        accessorKey: "currentBalance",
        cell: ({ row }) => {
            const amount = parseFloat(row.getValue("currentBalance"));
            const formatted = new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: "USD",
            }).format(amount);
            return <div className="text-right font-medium">{formatted}</div>;
        },
    },

    // Latest Date Column
    {
        header: "Latest Date",
        accessorKey: "latestDate",
        cell: ({ row }) => {
            const latestDate = new Date(row.getValue("latestDate"));
            return latestDate.toLocaleDateString();
        },
    },

    {
        header: "History",
        accessorKey: "history", // accessorKey for history
        cell: ({ row }) => {
            const history = row.getValue("history"); // Access history array

            // Ensure history exists and is an array
            if (!history || !Array.isArray(history) || history.length === 0) {
                return <div>No history available</div>;
            }

            // Extract all unique dates and sort them in ascending order
            const uniqueDates = [
                ...new Set(history.map(entry => new Date(entry.date).toLocaleDateString())),
            ].sort();

            return (
                <div className="space-y-2">
                    <div className="flex gap-4 ">
                        <>
                            {uniqueDates.map((date, dateIdx) => {
                                // Find the latest balance for the corresponding date
                                const entryForDate = history
                                    .filter(entry => new Date(entry.date).toLocaleDateString() === date)
                                    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];

                                return (
                                    <div key={dateIdx} className="w-full text-right">
                                        {entryForDate
                                            ? <div className="flex-row">
                                                <div>{new Date(entryForDate.date).toLocaleDateString()}</div>
                                                <div>{entryForDate.balance.toLocaleString("en-US", {
                                                    style: "currency",
                                                    currency: "USD",
                                                })}
                                                </div>
                                            </div>
                                            : "-"}
                                    </div>
                                );
                            })}
                        </>
                    </div>
                </div>
            );
        },
    }

];
