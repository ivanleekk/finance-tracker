import { ColumnDef } from "@tanstack/react-table";
import { Button } from "~/components/ui/button";
import { ArrowUpDown } from "lucide-react";
import { Fragment } from "react/jsx-runtime";

// Define the type for bank history
export type bankHistory = {
    bankName: string;
    currentBalance: number;
    latestDate: string;
    history: bankHistoryColumn[];
};

export type bankHistoryColumn = {
    bankName: string;
    history: bankHistory;
};

const MonthHeader = ({ month }: { month: string }) => {
    return <div className="min-w-10 text-center mx-4">{month}</div>;
}

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

    // Jan Column
    {
        header: () => <MonthHeader month="Jan" />,
        accessorKey: "history",
        cell: ({ row }) => {
            // get the latest value for the month
            const monthValue = row.getValue("history").find((entry: any) => {
                return new Date(entry.date).getMonth() === 0;
            });

            // return the balance if it exists
            if (monthValue) {
                return monthValue.balance;
            }
        },
    },

    // Feb Column
    {
        header: () => <MonthHeader month="Feb" />,
        accessorKey: "history",
        cell: ({ row }) => {
            // get the latest value for the month
            const monthValue = row.getValue("history").find((entry: any) => {
                return new Date(entry.date).getMonth() === 1;
            });

            // return the balance if it exists
            if (monthValue) {
                return monthValue.balance;
            }
        },
    },

    // Mar Column
    {
        header: () => <MonthHeader month="Mar" />,
        accessorKey: "history",
        cell: ({ row }) => {
            // get the latest value for the month
            const monthValue = row.getValue("history").find((entry: any) => {
                return new Date(entry.date).getMonth() === 2;
            });

            // return the balance if it exists
            if (monthValue) {
                return monthValue.balance;
            }
        },
    },

    // Apr Column
    {
        header: () => <MonthHeader month="Apr" />,
        accessorKey: "history",
        cell: ({ row }) => {
            // get the latest value for the month
            const monthValue = row.getValue("history").find((entry: any) => {
                return new Date(entry.date).getMonth() === 3;
            });

            // return the balance if it exists
            if (monthValue) {
                return monthValue.balance;
            }
        },
    },

    // May Column
    {
        header: () => <MonthHeader month="May" />,
        accessorKey: "history",
        cell: ({ row }) => {
            // get the latest value for the month
            const monthValue = row.getValue("history").find((entry: any) => {
                return new Date(entry.date).getMonth() === 4;
            });

            // return the balance if it exists
            if (monthValue) {
                return monthValue.balance;
            }
        },
    },

    // Jun Column
    {
        header: () => <MonthHeader month="Jun" />,
        accessorKey: "history",
        cell: ({ row }) => {
            // get the latest value for the month
            const monthValue = row.getValue("history").find((entry: any) => {
                return new Date(entry.date).getMonth() === 5;
            });

            // return the balance if it exists
            if (monthValue) {
                return monthValue.balance;
            }
        },
    },

    // Jul Column
    {
        header: () => <MonthHeader month="Jul" />,
        accessorKey: "history",
        cell: ({ row }) => {
            // get the latest value for the month
            const monthValue = row.getValue("history").find((entry: any) => {
                return new Date(entry.date).getMonth() === 6;
            });

            // return the balance if it exists
            if (monthValue) {
                return monthValue.balance;
            }
        },
    },

    // Aug Column
    {
        header: () => <MonthHeader month="Aug" />,
        accessorKey: "history",
        cell: ({ row }) => {
            // get the latest value for the month
            const monthValue = row.getValue("history").find((entry: any) => {
                return new Date(entry.date).getMonth() === 7;
            });

            // return the balance if it exists
            if (monthValue) {
                return monthValue.balance;
            }
        },
    },

    // Sep Column
    {
        header: () => <MonthHeader month="Sep" />,
        accessorKey: "history",
        cell: ({ row }) => {
            // get the latest value for the month
            const monthValue = row.getValue("history").find((entry: any) => {
                return new Date(entry.date).getMonth() === 8;
            });

            // return the balance if it exists
            if (monthValue) {
                return monthValue.balance;
            }
        },
    },

    // Oct Column
    {
        header: () => <MonthHeader month="Oct" />,
        accessorKey: "history",
        cell: ({ row }) => {
            // get the latest value for the month
            const monthValue = row.getValue("history").find((entry: any) => {
                return new Date(entry.date).getMonth() === 9;
            });

            // return the balance if it exists
            if (monthValue) {
                return monthValue.balance;
            }
        },
    },

    // Nov Column
    {
        header: () => <MonthHeader month="Nov" />,
        accessorKey: "history",
        cell: ({ row }) => {
            // get the latest value for the month
            const monthValue = row.getValue("history").find((entry: any) => {
                return new Date(entry.date).getMonth() === 10;
            });

            // return the balance if it exists
            if (monthValue) {
                return monthValue.balance;
            }
        },
    },

    // Dec Column
    {
        header: () => <MonthHeader month="Dec" />,
        accessorKey: "history",
        cell: ({ row }) => {
            // get the latest value for the month
            const monthValue = row.getValue("history").find((entry: any) => {
                return new Date(entry.date).getMonth() === 11;
            });

            // return the balance if it exists
            if (monthValue) {
                return monthValue.balance;
            }
        },
    },
];
