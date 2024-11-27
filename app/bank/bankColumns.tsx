"use client"

import { ColumnDef } from "@tanstack/react-table"
import { Button } from "~/components/ui/button";
import { ArrowUpDown } from "lucide-react";

// This type is used to define the shape of our data.
// You can use a Zod schema here if you want.
export type Bank = {
    bankName: string,
    balance: number,
}

export const bankColumns: ColumnDef<Bank>[] = [
    {
        header: ({ column }) => {
            return (
                <Button
                    variant="tableHead"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Bank
                    <ArrowUpDown />
                </Button>
            )
        },
        accessorKey: "bankName",
    },
    {
        header: ({ column }) => {
            return (
                <Button
                    variant="tableHead"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Balance
                    <ArrowUpDown />
                </Button>
            )
        },
        accessorKey: "currentBalance",
        cell: ({ row }) => {
            const amount = parseFloat(row.getValue("currentBalance"))
            const formatted = new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: "USD",
            }).format(amount)

            return <div className="text-right font-medium">{formatted}</div>
        },
    },
    {
        header: "Last Updated",
        accessorFn: (row) => new Date(row.latestDate).toLocaleDateString(),
        cell: (info) => {
            return <div className="text-right">{info.getValue()}</div>
        }
    }
]


