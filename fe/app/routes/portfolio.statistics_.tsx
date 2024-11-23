import {Card} from "~/components/ui/card";
import {LoaderFunctionArgs, redirect} from "@remix-run/node";
import {getUserSession} from "~/utils/session.server";
import BetaCard from "~/components/betaCard";
import {getPortfolio,} from "~/portfolio/portfolio";
import {useLoaderData} from "@remix-run/react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const sessionUser = await getUserSession(request);
    if (!sessionUser) {
        return redirect("/login");
    }
    return await getPortfolio(request);

};

export default function Statistics() {
    const portfolioData = useLoaderData();

    return (
        <div>
            <div className="space-y-2">
                <BetaCard data={portfolioData} />
                {/*<StandardDeviationCard />*/}
                <Card className="w-fit p-2">
                    <h2>Portfolio Sharpe Ratio</h2>
                    <p>0.75</p>
                </Card>
            </div>
        </div>
    );
}