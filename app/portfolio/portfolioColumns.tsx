"use client"

import { ColumnDef } from "@tanstack/react-table"
import { Button } from "~/components/ui/button";
import { ArrowUpDown } from "lucide-react";

// This type is used to define the shape of our data.
export type PortfolioItem = {
    symbol: string;
    quantity: number;
    averagePrice: number;
    totalInitialValue: number;
    currentPrice: number;
    totalCurrentValue: number;
    percentageGainLoss: number;
    totalGainLoss: number;
}

export const portfolioColumns: ColumnDef<PortfolioItem>[] = [
    {
        header: ({ column }) => {
            return (
                <Button
                    variant="tableHead"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Symbol
                    <ArrowUpDown />
                </Button>
            )
        },
        accessorKey: "symbol",
    },
    {
        header: ({ column }) => {
            return (
                <Button
                    variant="tableHead"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Quantity
                    <ArrowUpDown/>
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
                    size="defaultLessPadding"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Average Price
                    <ArrowUpDown />
                </Button>
            )
        },
        accessorKey: "averagePrice",
        cell: ({ row }) => {
            const amount = parseFloat(row.getValue("averagePrice"))
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
                    size="defaultLessPadding"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Total Initial Value
                    <ArrowUpDown />
                </Button>
            )
        },
        accessorKey: "totalInitialValue",
        cell: ({ row }) => {
            const amount = parseFloat(row.getValue("totalInitialValue"))
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
                    size="defaultLessPadding"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Current Price
                    <ArrowUpDown />
                </Button>
            )
        },
        accessorKey: "currentPrice",
        cell: ({ row }) => {
            const amount = parseFloat(row.getValue("currentPrice"))
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
                    size="defaultLessPadding"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Total Current Value
                    <ArrowUpDown />
                </Button>
            )
        },
        accessorKey: "totalCurrentValue",
        cell: ({ row }) => {
            const amount = parseFloat(row.getValue("totalCurrentValue"))
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
                    size="defaultLessPadding"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Percentage Gain/Loss
                    <ArrowUpDown />
                </Button>
            )
        },
        accessorKey: "percentageGainLoss",
        cell: ({ row }) => {
            const amount = parseFloat(row.getValue("percentageGainLoss"))
            const formatted = `${amount.toFixed(2)}%`

            return <div className="text-right font-medium">{formatted}</div>
        },
    },
    {
        header: ({ column }) => {
            return (
                <Button
                    variant="tableHead"
                    size="defaultLessPadding"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Total Gain/Loss
                    <ArrowUpDown />
                </Button>
            )
        },
        accessorKey: "totalGainLoss",
        cell: ({ row }) => {
            const amount = parseFloat(row.getValue("totalGainLoss"))
            const formatted = new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: "USD",
            }).format(amount)

            return <div className="text-right font-medium">{formatted}</div>
        },
    },
]