import {LoaderFunctionArgs} from "@remix-run/node";
import {getTransactions} from "~/portfolio/portfolio";
import {Await, useLoaderData} from "@remix-run/react";
import {DataTable} from "~/components/dataTable";
import {transactionColumns} from "~/portfolio/transactionColumns";
import {requireUserSession} from "~/utils/auth.server";
import {Card, CardHeader} from "~/components/ui/card";
import {Suspense} from "react";
import {portfolioColumns} from "~/portfolio/portfolioColumns";
import {defer} from "@vercel/remix";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    await requireUserSession(request);

    const transactions = getTransactions(request);
    const result = {
        "transactionData": transactions,
    }
    return defer(result);
};

export default function Transactions() {
    const {transactionData} = useLoaderData<typeof loader>();

    return (
        <Card className="w-fit flex-grow basis-auto p-2">
            <CardHeader className="text-xl font-bold">
                Transactions
            </CardHeader>
            <Suspense
                fallback={
                    <DataTable
                        columns={portfolioColumns}
                        data={[
                            {
                                id: 'abc',
                                symbol: 'Loading...',
                                buySell: 'Loading...',
                                quantity: 0,
                                price: 0,
                                totalValue: 0,
                                date: new Date().toISOString(),
                            }
                        ]
                        }/>}
            >
                <Await resolve={transactionData}>
                    {(transactionData) => <DataTable columns={transactionColumns} data={transactionData}/>}

                </Await>
            </Suspense>
        </Card>
    );
}
