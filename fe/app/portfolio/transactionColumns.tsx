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
            variant="tableHead"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
            Symbol
            <ArrowUpDown  />
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
                    variant="tableHead"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Quantity
                    <ArrowUpDown  />
                </Button>
            )
        },
        accessorKey: "quantity",
    },
    {
        header: ({ column }) => {
            return (
                <Button
                    variant="tableHead"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Price
                    <ArrowUpDown  />
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
                    variant="tableHead"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Total Value
                    <ArrowUpDown  />
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
                    variant="tableHead"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Date
                    <ArrowUpDown  />
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


