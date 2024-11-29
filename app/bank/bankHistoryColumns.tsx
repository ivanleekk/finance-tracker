import {ColumnDef, createColumnHelper} from "@tanstack/react-table";

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
const futureBalance = '-';

// Helper function to find balance for a specific month
const getMonthBalance = (row: bankHistory, month: number) => {
    if (row.monthlyData.length === 0) {
        return 0;
    }
    if (row.monthlyData[0].year === new Date().getFullYear() && month > new Date().getMonth()) {
        return futureBalance;
    }
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
                    textColor = 'text-pastel-green-600 dark:text-pastel-green-400'; // Increased
                } else if (currentValue < prevMonthBalance) {
                    textColor = 'text-froly-red-600 dark:text-froly-red-400'; // Decreased
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


            // check if the future balance is in total as a string
            if (total.toString().includes(futureBalance)) {
                return futureBalance;
            }
            return total.toLocaleString('en-US', {
                style: 'currency',
                currency: 'USD'
            });
        },
    }))
];