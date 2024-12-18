import { LoaderFunctionArgs } from "@remix-run/node";
import { requireUserSession } from "~/utils/auth.server";
import { getBankInfo } from "~/bank/bank";
import { Await, useLoaderData } from "@remix-run/react";
import { DataTable } from "~/components/dataTable";
import { bankColumns } from "~/bank/bankColumns";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import SuspenseCard from "~/components/suspenseCard";
import { Suspense } from "react";
import { defer } from "@vercel/remix";
import { getUserByRequest } from "~/user/user";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    await requireUserSession(request);
    const bankData = getBankInfo(request);
    const userData = await getUserByRequest(request);
    const result = {
        bankData: bankData,
        userData: userData,
    };
    return defer(result);
};

export default function Bank() {
    const { bankData, userData } = useLoaderData<typeof loader>();
    return (
        <Card className="flex flex-col w-fit flex-grow basis-auto p-2 gap-4">
            <CardHeader className="text-xl font-bold">Banks</CardHeader>
            <CardContent className="flex w-fit flex-grow basis-auto p-2 gap-4">
                <Suspense
                    fallback={
                        <DataTable
                            columns={bankColumns}
                            data={[
                                {
                                    bankName: "Loading...",
                                    balance: 0,
                                    latestDate: "Loading...",
                                },
                            ]}
                        />
                    }
                >
                    <Await resolve={bankData}>
                        {(bankData) => <DataTable columns={bankColumns} data={bankData} />}
                    </Await>
                </Suspense>
                <SuspenseCard
                    title="Total Cash"
                    loadingMessage="Loading Total Cash"
                    resolvePromise={bankData}
                    className="w-fit h-fit"
                    renderContent={(data) =>
                        userData.homeCurrencySymbol +
                        data.reduce((acc, bank) => acc + bank.homeCurrentBalance, 0).toFixed(2)
                    }
                />
            </CardContent>
        </Card>
    );
}
