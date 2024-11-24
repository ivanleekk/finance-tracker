import { Card } from "~/components/ui/card";
import { LoaderFunctionArgs, redirect } from "@remix-run/node";
import { getUserSession } from "~/utils/session.server";
import BetaCard from "~/components/betaCard";
import { getPortfolio, getPortfolioStandardDeviation, } from "~/portfolio/portfolio";
import { useLoaderData } from "@remix-run/react";
import StandardDeviationCard from "~/components/standardDeviationCard";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const sessionUser = await getUserSession(request);
    if (!sessionUser) {
        return redirect("/login");
    }

    const portfolioData = await getPortfolio(request);
    const standardDeviation = await getPortfolioStandardDeviation(request, portfolioData);

    const result = {
        portfolioData: portfolioData,
        standardDeviation: standardDeviation
    };

    return result;

};

export default function Statistics() {
    const portfolioData = useLoaderData();
    // console.log(portfolioData);
    return (
        <div>
            <div className="space-y-2">
                <BetaCard data={portfolioData.portfolioData} />
                <StandardDeviationCard data={portfolioData.standardDeviation} />
                <Card className="w-fit p-2">
                    <h2>Portfolio Sharpe Ratio</h2>
                    <p>0.75</p>
                </Card>
            </div>
        </div>
    );
}