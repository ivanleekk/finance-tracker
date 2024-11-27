import { LoaderFunctionArgs } from "@remix-run/node";
import { requireUserSession } from "~/utils/auth.server";
import { getBankInfo } from "~/bank/bank";
import { useLoaderData } from "@remix-run/react";
import { DataTable } from "~/components/dataTable";
import { bankColumns } from "~/bank/bankColumns";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import SuspenseCard from "~/components/suspenseCard";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    await requireUserSession(request);

    return getBankInfo(request);
};

export default function Bank() {
    const bankData = useLoaderData();
    return (
        <div className="flex flex-row space-x-4">
            <DataTable columns={bankColumns} data={bankData} />
            <SuspenseCard
                title="Total Cash"
                loadingMessage="Loading Total Cash"
                resolvePromise={bankData}
                className="w-fit h-fit"
                renderContent={(data) => (
                    "$" + data.reduce((acc, bank) => acc + bank.currentBalance, 0).toFixed(2)
                )
                }
            />
        </div>
    );
}
