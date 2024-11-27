import { LoaderFunctionArgs } from "@remix-run/node";
import { requireUserSession } from "~/utils/auth.server";
import { getBankInfo } from "~/bank/bank";
import { useLoaderData } from "@remix-run/react";
import { DataTable } from "~/components/dataTable";
import { bankColumns } from "~/bank/bankColumns";
import { Card, CardContent, CardHeader } from "~/components/ui/card";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    await requireUserSession(request);

    return await getBankInfo(request);
};

export default function Bank() {
    const bankData = useLoaderData();
    return (
        <div className="flex flex-row space-x-4">
            <DataTable columns={bankColumns} data={bankData} />
            <Card className="h-fit">
                <CardHeader>Total Cash</CardHeader>
                <CardContent>
                    <div className="text-3xl font-bold text-center">
                        ${bankData.reduce((acc, bank) => acc + bank.currentBalance, 0)}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
