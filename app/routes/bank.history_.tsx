import { LoaderFunctionArgs } from "@remix-run/node";
import { requireUserSession } from "~/utils/auth.server";
import { getBankHistoryMonthly } from "~/bank/bank";
import { useLoaderData } from "@remix-run/react";
import { bankHistoryColumns } from "~/bank/bankHistoryColumns";
import { BankHistoryTable } from "~/components/bankHistoryTable";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { ReactNode, useEffect, useState } from "react";


export const loader = async ({ request }: LoaderFunctionArgs) => {
    await requireUserSession(request);

    return await getBankHistoryMonthly(request);
};

export default function BankHistory({ children }: { children: ReactNode }) {
    const bankHistory = useLoaderData<typeof loader>();
    const availableYears: string[] = bankHistory.availableYears;
    const [selectedYear, setSelectedYear] = useState<string | null>(new Date().getFullYear().toString());
    const [data, setData] = useState<typeof bankHistory.data>([]);

    useEffect(() => {
        // on page load
        if (!selectedYear) return;
        const selectedData = [];
        // Filter the data based on the selected year
        for (const bank of bankHistory.data) {
            // except monthlyData
            const newBank = { ...bank, monthlyData: [] };
            for (const monthlyData of bank.monthlyData) {
                if (monthlyData.year === Number(selectedYear)) {
                    newBank.monthlyData.push(monthlyData);
                }
            }
            selectedData.push(newBank);
        }

        setData(selectedData);
    }, []);

    useEffect(() => {
        if (!selectedYear) return;
        const selectedData = [];
        // Filter the data based on the selected year
        for (const bank of bankHistory.data) {
            // except monthlyData
            const newBank = { ...bank, monthlyData: [] };
            for (const monthlyData of bank.monthlyData) {
                if (monthlyData.year === Number(selectedYear)) {
                    newBank.monthlyData.push(monthlyData);
                }
            }
            selectedData.push(newBank);
        }

        setData(selectedData);
    }, [selectedYear, bankHistory.data]);


    return (
        <div className="text-center text-9xl space-y-4">
            <Select onValueChange={setSelectedYear}>
                <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Select Year to view" />
                </SelectTrigger>
                <SelectContent>
                    {availableYears.map((year) => (
                        <SelectItem value={year} className="p-2">
                            {year}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <BankHistoryTable columns={bankHistoryColumns} data={data} />
        </div>
    );
}

export function ErrorBoundary() {
    return (
        <div className="text-center text-9xl space-y-4">
            <h1>Bank History</h1>
            <p>There was an error</p>
        </div>
    );
}
