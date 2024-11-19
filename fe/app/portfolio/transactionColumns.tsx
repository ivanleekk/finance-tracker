"use client"

import { ColumnDef } from "@tanstack/react-table"
import {Button} from "~/components/ui/button";
import {ArrowUpDown} from "lucide-react";

// This type is used to define the shape of our data.
// You can use a Zod schema here if you want.
export type Transaction = {
    symbol: string;
    buySell: string;
    quantity: number;
    price: number;
    totalValue: number;
    date: string;
}

export const transactionColumns: ColumnDef<Transaction>[] = [
    {
        header: ({ column }) => {
    return (
        <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
            Symbol
            <ArrowUpDown className="ml-2 h-4 w-4" />
            </Button>
        )
        },
        accessorKey: "symbol",
    },
    {
        header: "Buy/Sell",
        accessorKey: "buySell",
    },
    {
        header: ({ column }) => {
            return (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Quantity
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            )
        },
        accessorKey: "quantity",
    },
    {
        header: ({ column }) => {
            return (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Price
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            )
        },
        accessorKey: "price",
        cell: ({ row }) => {
            const amount = parseFloat(row.getValue("price"))
            const formatted = new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: "USD",
            }).format(amount)

            return <div className="text-right font-medium">{formatted}</div>
        },
    },
    {
        header: ({ column }) => {
            return (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Total Value
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            )
        },
        accessorKey: "totalValue",
        cell: ({ row }) => {
            const amount = parseFloat(row.getValue("totalValue"))
            const formatted = new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: "USD",
            }).format(amount)

            return <div className="text-right font-medium">{formatted}</div>
        },
    },
    {
        header: ({ column }) => {
            return (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Date
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            )
        },
        accessorKey: "date",
        cell: ({ row }) => {
            const date = new Date(row.getValue("date"))
            return <div>{date.toLocaleDateString()} {date.toLocaleTimeString()}</div>
        }
    },
]


