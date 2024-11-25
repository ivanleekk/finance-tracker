import { Card } from "~/components/ui/card";
import { LoaderFunctionArgs, redirect } from "@remix-run/node";
import { getUserSession } from "~/utils/session.server";
import BetaCard from "~/components/betaCard";
import { getPortfolio, getPortfolioSharpeRatio, getPortfolioStandardDeviation, } from "~/portfolio/portfolio";
import { useLoaderData } from "@remix-run/react";
import StandardDeviationCard from "~/components/standardDeviationCard";
import SharpeRatioCard from "~/components/sharpeRatioCard";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const sessionUser = await getUserSession(request);
    if (!sessionUser) {
        return redirect("/login");
    }

    const portfolioData = await getPortfolio(request);
    const standardDeviation = await getPortfolioStandardDeviation(request, portfolioData);
    const sharpeRatio = await getPortfolioSharpeRatio(request, portfolioData);


    const result = {
        portfolioData: portfolioData,
        standardDeviation: standardDeviation,
        sharpeRatio: sharpeRatio,
    };

    return result;

};

export default function Statistics() {
    const portfolioData = useLoaderData();
    return (
        <div>
            <div className="space-y-2">
                <BetaCard data={portfolioData.portfolioData} />
                <StandardDeviationCard data={portfolioData.standardDeviation} />
                <SharpeRatioCard data={portfolioData.sharpeRatio} />
            </div>
        </div>
    );
}