import { ColumnDef, createColumnHelper, CellContext } from "@tanstack/react-table";
import { Button } from "~/components/ui/button";
import { ArrowUpDown } from "lucide-react";
import { Fragment } from "react/jsx-runtime";

export type bankHistory = {
    bankName: string;
    currentBalance: number;
    latestDate: string;
    monthlyData: bankHistoryColumn[];
};

export type bankHistoryColumn = {
    year: number;
    month: number;
    date: string;
    balance: number;
};

const columnHelper = createColumnHelper<bankHistory>();

// Helper function to find balance for a specific month
const getMonthBalance = (row: bankHistory, month: number) => {
    return row.monthlyData.find((data) => data.month === month)?.balance || 0;
};

// Create an array of month names for easier mapping
const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

// Define columns for the bank history table
export const bankHistoryColumns: ColumnDef<bankHistory>[] = [

    {
        header: "Bank Name",
        accessorKey: "bankName",
        cell: (info) => info.getValue(),
        footer: () => "Total",
    },
    ...monthNames.map((monthName, monthIndex) => ({
        header: monthName,
        accessorFn: (row: bankHistory) => getMonthBalance(row, monthIndex),
        cell: (info) => {
            const currentValue = info.getValue() as number;

            // Get the previous month's balance
            const row = info.row.original;
            const prevMonthBalance = monthIndex > 0
                ? getMonthBalance(row, monthIndex - 1)
                : null;

            // Determine cell style
            let textColor = '';
            if (prevMonthBalance !== null) {
                if (currentValue > prevMonthBalance) {
                    textColor = 'text-green-600'; // Increased
                } else if (currentValue < prevMonthBalance) {
                    textColor = 'text-red-600'; // Decreased
                }
            }

            return (
                <span className={`${textColor}`}>
                    {currentValue.toLocaleString('en-US', {
                        style: 'currency',
                        currency: 'USD'
                    })}
                </span>
            );
        },
        footer: (info) => {
            // Calculate total for this month across all rows
            const total = info.table.getRowModel().rows
                .reduce((sum, row) => sum + getMonthBalance(row.original, monthIndex), 0);

            return total.toLocaleString('en-US', {
                style: 'currency',
                currency: 'USD'
            });
        },
    }))
];