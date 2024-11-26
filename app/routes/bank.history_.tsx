import { LoaderFunctionArgs } from "@remix-run/node";
import React, { useEffect, useState } from "react";
import { requireUserSession } from "~/utils/auth.server";
import { getBankHistory } from "~/bank/bank";
import { useLoaderData } from "@remix-run/react";
import { DataTable } from "~/components/dataTable";
import { bankHistoryColumns } from "~/bank/bankHistoryColumns";
import { Select, SelectItem, SelectValue, SelectContent, SelectTrigger } from "~/components/ui/select";


export const loader = async ({ request }: LoaderFunctionArgs) => {
    await requireUserSession(request);

    return await getBankHistory(request);
};

export default function BankHistory({ children }: { children: React.ReactNode }) {
    const bankHistory = useLoaderData<typeof loader>();
    const [selectedYear, setSelectedYear] = useState<string>(new Date().getFullYear().toString());
    const [bankData, setBankData] = useState<any>(bankHistory);

    const availableYears = Array.from(
        new Set(
            bankHistory.flatMap((record: any) =>
                record.history.map((entry: any) => new Date(entry.date).getFullYear())
            )
        )
    ).sort();


    useEffect(() => {
        const filteredData = bankHistory.map((record: any) => {
            const filteredHistory = record.history.filter((entry: any) => {
                const entryYear = new Date(entry.date).getFullYear().toString();
                return entryYear === selectedYear.toString() || entryYear === (Number(selectedYear) - 1).toString();
            });

            // Return the record with the filtered history
            return {
                ...record,
                history: filteredHistory,
            };
        }).filter((record: any) => record.history.length > 0); // Only include records with non-empty history

        setBankData(filteredData);
    }, [selectedYear]);

    useEffect(() => {
        console.log(bankData);
    }, [bankData]);


    return (
        <div className="text-center text-9xl space-y-4">
            <Select defaultValue={selectedYear} onValueChange={setSelectedYear}>
                <SelectTrigger className="w-1/3">
                    <SelectValue>{selectedYear ? selectedYear : "Select the Year you want to view"} </SelectValue>
                </SelectTrigger>
                <SelectContent>
                    {availableYears.map(year => (
                        <SelectItem key={year} value={year}>
                            {year}
                        </SelectItem>
                    ))}
                </SelectContent>

            </Select>
            <DataTable columns={bankHistoryColumns} data={bankData} />
        </div>
    );
}
