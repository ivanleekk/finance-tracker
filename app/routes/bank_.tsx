import { LoaderFunctionArgs } from "@remix-run/node";
import { requireUserSession } from "~/utils/auth.server";
import { getBankInfo } from "~/bank/bank";
import { Await, useLoaderData } from "@remix-run/react";
import { DataTable } from "~/components/dataTable";
import { bankColumns } from "~/bank/bankColumns";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import SuspenseCard from "~/components/suspenseCard";
import { Suspense } from "react";
import { portfolioColumns } from "~/portfolio/portfolioColumns";
import { defer } from "@vercel/remix";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireUserSession(request);
  const bankData = getBankInfo(request);
  const result = {
    bankData: bankData,
  };
  return defer(result);
};

export default function Bank() {
  const { bankData } = useLoaderData<typeof loader>();
  return (
    <Card className="flex flex-col w-fit flex-grow basis-auto p-2 gap-4">
      <CardHeader className="text-xl font-bold">Banks</CardHeader>
      <CardContent className="flex w-fit flex-grow basis-auto p-2 gap-4">
        <Suspense
          fallback={
            <DataTable
              columns={portfolioColumns}
              data={[
                {
                  id: "abc",
                  symbol: "Loading...",
                  quantity: 0,
                  averagePrice: 0,
                  totalInitialValue: 0,
                  currentPrice: 0,
                  totalCurrentValue: 0,
                  percentageGainLoss: 0,
                  totalGainLoss: 0,
                  beta: 0,
                  currencySymbol: "$",
                  currency: "USD",
                  homeCurrentPrice: 0,
                  homeTotalCurrentValue: 0,
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
            "$" +
            data.reduce((acc, bank) => acc + bank.currentBalance, 0).toFixed(2)
          }
        />
      </CardContent>
    </Card>
  );
}
