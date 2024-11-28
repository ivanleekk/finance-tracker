import { LoaderFunctionArgs, redirect } from "@remix-run/node";
import { getUserSession } from "~/utils/session.server";
import BetaCard from "~/components/betaCard";
import { getPortfolio, getPortfolioBeta, getPortfolioSharpeRatio, getPortfolioStandardDeviation, } from "~/portfolio/portfolio";
import { Await, useLoaderData } from "@remix-run/react";
import StandardDeviationCard from "~/components/standardDeviationCard";
import SharpeRatioCard from "~/components/sharpeRatioCard";
import { Suspense } from "react";
import { Card } from "~/components/ui/card";
import { requireUserSession } from "~/utils/auth.server";
import SuspenseCard from "~/components/suspenseCard";
import { defer } from "@vercel/remix";
import { getUserByRequest } from "~/user/user";


export const loader = async ({ request }: LoaderFunctionArgs) => {
    await requireUserSession(request);


    const standardDeviation = getPortfolioStandardDeviation(request);
    const sharpeRatio = getPortfolioSharpeRatio(request);
    const portfolioBeta = getPortfolioBeta(request);
    const portfolio = getPortfolio(request);
    const user = await getUserByRequest(request);

    const result = {
        portfolio: portfolio,
        standardDeviation: standardDeviation,
        sharpeRatio: sharpeRatio,
        portfolioBeta: portfolioBeta,
        user: user
    };

    return defer(result);

};

export default function Statistics() {
    const { portfolio, standardDeviation, sharpeRatio, portfolioBeta, user } = useLoaderData();
    return (
        <div className="grid grid-cols-2 gap-4">
            <SuspenseCard
                title="Current Portfolio Value"
                loadingMessage="Loading Current Portfolio Value"
                resolvePromise={portfolio}
                renderContent={(data) => (
                    user.homeCurrencySymbol + data.reduce((acc, asset) => acc + asset.homeTotalCurrentValue, 0).toFixed(2)
                )}
            />
            <SuspenseCard
                title="Standard Deviation"
                loadingMessage="Loading Standard Deviation"
                resolvePromise={standardDeviation}
                renderContent={(data) => isNaN(data) ? "N/A" : data.toFixed(4)}
            />
            <SuspenseCard
                title="Sharpe Ratio"
                loadingMessage="Loading Sharpe Ratio"
                resolvePromise={sharpeRatio}
                renderContent={(data) => isNaN(data) ? "N/A" : data.toFixed(4)}
            />
            <SuspenseCard
                title="Beta"
                loadingMessage="Loading Beta"
                resolvePromise={portfolioBeta}
                renderContent={(data) => isNaN(data) ? "N/A" : data.toFixed(4)}
            />
        </div>
    );
}