import { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { requireUserSession } from "~/utils/auth.server";
import { getPortfolio, getPortfolioBeta, getPortfolioSharpeRatio, getPortfolioStandardDeviation } from "~/portfolio/portfolio";
import { getBankInfo } from "~/bank/bank";
import { Await, useLoaderData } from "@remix-run/react";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Outlet } from "react-router";
import Statistics from "./portfolio.statistics_";
import { Suspense } from "react";
import StandardDeviationCard from "~/components/standardDeviationCard";
import BetaCard from "~/components/betaCard";
import SharpeRatioCard from "~/components/sharpeRatioCard";
import { defer } from "@vercel/remix";
import SuspenseCard from "~/components/suspenseCard";
import { getUserByRequest } from "~/user/user";

export const meta: MetaFunction = () => {
    return [
        { title: "Finance Tracker" },
        { name: "Finance Tracker", content: "Finance Tracker" },
    ];
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
    await requireUserSession(request);
    const standardDeviation = getPortfolioStandardDeviation(request);
    const sharpeRatio = getPortfolioSharpeRatio(request);
    const portfolioBeta = getPortfolioBeta(request);

    const portfolio = getPortfolio(request);
    const bank = getBankInfo(request);
    const user = await getUserByRequest(request);

    const result = {
        "portfolio": {
            portfolio,
            standardDeviation,
            sharpeRatio,
            portfolioBeta,
        },
        "bank": bank,
        "user": user
    };

    return defer(result);
};

export default function Index() {
    const { portfolio, bank, user } = useLoaderData<typeof loader>();
    return (
        <div className="flex flex-wrap gap-4">
            <Card className="w-fit flex-grow basis-auto">
                <CardHeader className="text-xl font-bold">
                    Portfolio
                </CardHeader>
                <CardContent className="flex flex-wrap flex-grow gap-4">
                    <SuspenseCard
                        title="Current Portfolio Value"
                        loadingMessage="Loading Current Portfolio Value"
                        resolvePromise={portfolio.portfolio}
                        renderContent={(data) =>
                            user.homeCurrencySymbol + data.reduce((acc, asset) => acc + asset.homeTotalCurrentValue, 0).toFixed(2)
                        }
                    />
                    <SuspenseCard
                        title="Standard Deviation"
                        loadingMessage="Loading Standard Deviation"
                        resolvePromise={portfolio.standardDeviation}
                        renderContent={(data) => (isNaN(data) ? "N/A" : data.toFixed(4))}
                    />
                    <SuspenseCard
                        title="Beta"
                        loadingMessage="Loading Beta"
                        resolvePromise={portfolio.portfolioBeta}
                        renderContent={(data) => (isNaN(data) ? "N/A" : data.toFixed(2))}
                    />
                    <SuspenseCard
                        title="Sharpe Ratio"
                        loadingMessage="Loading Sharpe Ratio"
                        resolvePromise={portfolio.sharpeRatio}
                        renderContent={(data) => (isNaN(data) ? "N/A" : data.toFixed(4))}
                    />
                </CardContent>
            </Card>
            <Card className="w-fit flex-grow basis-auto">
                <CardHeader className="text-xl font-bold">
                    Bank
                </CardHeader>
                <CardContent className="flex flex-wrap flex-grow gap-4">
                    <SuspenseCard
                        title="Total Cash"
                        loadingMessage="Loading Total Cash"
                        resolvePromise={bank}
                        renderContent={(data) =>
                            user.homeCurrencySymbol + data.reduce((acc, bank) => acc + bank.homeCurrentBalance, 0).toFixed(2)
                        }
                    />
                    <SuspenseCard
                        title="Largest Bank Account"
                        loadingMessage="Loading Largest Bank Account"
                        resolvePromise={bank}
                        renderContent={(data) => {
                            if (data.length === 0) {
                                return "No bank accounts";
                            } else {
                                const largestBank = data.find(
                                    (bank) => bank.homeCurrentBalance === Math.max(...data.map((bank) => bank.homeCurrentBalance))
                                );
                                return (
                                    largestBank?.bankName +
                                    " " +
                                    user.homeCurrencySymbol +
                                    largestBank?.homeCurrentBalance.toFixed(2)
                                );
                            }
                        }}
                    />
                </CardContent>
            </Card>
        </div>

    );
}
