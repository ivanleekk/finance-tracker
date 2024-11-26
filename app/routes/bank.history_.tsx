import { LoaderFunctionArgs, MetaFunction, redirect } from "@remix-run/node";
import React from "react";
import { requireUserSession } from "~/utils/auth.server";
import { getBankHistory } from "~/bank/bank";
import { useLoaderData } from "@remix-run/react";
import { DataTable } from "~/components/dataTable";
import { bankHistoryColumns } from "~/bank/bankHistoryColumns";


export const loader = async ({ request }: LoaderFunctionArgs) => {
    await requireUserSession(request);

    return await getBankHistory(request);
};

export default function BankHistory({ children }: { children: React.ReactNode }) {
    const bankHistory = useLoaderData();
    return (
        <div className="text-center text-9xl">
            <DataTable columns={bankHistoryColumns} data={bankHistory} />
        </div>
    );
}
