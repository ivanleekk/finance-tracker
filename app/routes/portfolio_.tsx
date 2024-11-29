import {LoaderFunctionArgs} from "@remix-run/node";
import {getPortfolio} from "~/portfolio/portfolio";
import {Await, useLoaderData} from "@remix-run/react";
import {DataTable} from "~/components/dataTable";
import {portfolioColumns} from "~/portfolio/portfolioColumns";
import {requireUserSession} from "~/utils/auth.server";
import {defer} from "@vercel/remix";
import {Suspense} from "react";
import {Card, CardHeader} from "~/components/ui/card";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    await requireUserSession(request);
    const portfolioData = getPortfolio(request);
    const result = {
        "portfolio": portfolioData,
    }
    return defer(result);
};

export default function Portfolio() {
    const {portfolio} = useLoaderData<typeof loader>();
    return (
        <Card className="w-fit flex-grow basis-auto p-2">
            <CardHeader className="text-xl font-bold">
                Portfolio
            </CardHeader>
            <Suspense
                fallback={
                    <DataTable
                        columns={portfolioColumns}
                        data={[
                            {
                                id: 'abc',
                                symbol: 'Loading...',
                                quantity: 0,
                                averagePrice: 0,
                                totalInitialValue: 0,
                                currentPrice: 0,
                                totalCurrentValue: 0,
                                percentageGainLoss: 0,
                                totalGainLoss: 0,
                                beta: 0,
                                currencySymbol: '$',
                                currency: 'USD',
                                homeCurrentPrice: 0,
                                homeTotalCurrentValue: 0
                            },
                        ]
                        }/>}
            >
                <Await resolve={portfolio}>
                    {(portfolio) => <DataTable columns={portfolioColumns} data={portfolio}/>}

                </Await>
            </Suspense>
        </Card>
    );
}