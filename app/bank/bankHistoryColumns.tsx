import { ColumnDef } from "@tanstack/react-table";
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

const MonthHeader = ({ month }: { month: string }) => {
    return <div className="min-w-10 text-center mx-4">{month}</div>;
}

// Define columns for the bank history table
export const bankHistoryColumns: ColumnDef<bankHistory>[] = [
    {
        header: "Bank Name",
        accessorFn: (row) => { return row.bankName; },
        footer: "Total"
    },
    {
        header: "Jan",
        accessorFn: (row) => {
            return row.monthlyData.find((data) => data.month === 0)?.balance || 0;
        },
        // footer: (rows) => {
        //     return rows.reduce((acc, row) => {
        //         return acc + row.monthlyData.find((data) => data.month === 0)?.balance || 0;
        //     }, 0);
        // }
    },
    {
        header: "Feb",
        accessorFn: (row) => {
            return row.monthlyData.find((data) => data.month === 1)?.balance || 0;
        },
    },
    {
        header: "Mar",
        accessorFn: (row) => {
            return row.monthlyData.find((data) => data.month === 2)?.balance || 0;
        },
    },
    {
        header: "Apr",
        accessorFn: (row) => {
            return row.monthlyData.find((data) => data.month === 3)?.balance || 0;
        },
    },
    {
        header: "May",
        accessorFn: (row) => {
            return row.monthlyData.find((data) => data.month === 4)?.balance || 0;
        },
    },
    {
        header: "Jun",
        accessorFn: (row) => {
            return row.monthlyData.find((data) => data.month === 5)?.balance || 0;
        },
    },
    {
        header: "Jul",
        accessorFn: (row) => {
            return row.monthlyData.find((data) => data.month === 6)?.balance || 0;
        },
    },
    {
        header: "Aug",
        accessorFn: (row) => {
            return row.monthlyData.find((data) => data.month === 7)?.balance || 0;
        },
    },
    {
        header: "Sep",
        accessorFn: (row) => {
            return row.monthlyData.find((data) => data.month === 8)?.balance || 0;
        },
    },
    {
        header: "Oct",
        accessorFn: (row) => {
            return row.monthlyData.find((data) => data.month === 9)?.balance || 0;
        },
    },
    {
        header: "Nov",
        accessorFn: (row) => {
            return row.monthlyData.find((data) => data.month === 10)?.balance || 0;
        },
    },
    {
        header: "Dec",
        accessorFn: (row) => {
            return row.monthlyData.find((data) => data.month === 11)?.balance || 0;
        },
    },


];