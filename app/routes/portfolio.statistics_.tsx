import { defer, LoaderFunctionArgs, redirect } from "@remix-run/node";
import { getUserSession } from "~/utils/session.server";
import BetaCard from "~/components/betaCard";
import { getPortfolioBeta, getPortfolioSharpeRatio, getPortfolioStandardDeviation, } from "~/portfolio/portfolio";
import { Await, useLoaderData } from "@remix-run/react";
import StandardDeviationCard from "~/components/standardDeviationCard";
import SharpeRatioCard from "~/components/sharpeRatioCard";
import { Suspense } from "react";
import { Card } from "~/components/ui/card";
import {requireUserSession} from "~/utils/auth.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    await requireUserSession(request);


    const standardDeviation = getPortfolioStandardDeviation(request);
    const sharpeRatio = getPortfolioSharpeRatio(request);
    const portfolioBeta = getPortfolioBeta(request);

    const result = {
        standardDeviation: standardDeviation,
        sharpeRatio: sharpeRatio,
        portfolioBeta: portfolioBeta,
    };

    return defer(result);

};

export default function Statistics() {
    const { standardDeviation, sharpeRatio, portfolioBeta } = useLoaderData();
    return (
        <div className="space-y-4">
            <Suspense fallback={<Card className="w-fit p-2">Loading Standard Deviation</Card>}>
                <Await resolve={standardDeviation}>
                    {(data) => <StandardDeviationCard data={data} />}
                </Await>
            </Suspense>
            <Suspense fallback={<Card className="w-fit p-2">Loading Sharpe Ratio</Card>}>

                <Await resolve={sharpeRatio}>
                    {(data) => <SharpeRatioCard data={data} />}
                </Await>
            </Suspense>
            <Suspense fallback={<Card className="w-fit p-2">Loading Beta</Card>}>
                <Await resolve={portfolioBeta}>
                    {(data) => <BetaCard data={data} />}
                </Await>
            </Suspense>

        </div>
    );
}