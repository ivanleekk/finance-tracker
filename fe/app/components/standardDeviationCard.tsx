import { Card } from "./ui/card";
import {getPortfolioStandardDeviation, getPortfolio} from "~/portfolio/portfolio";
import {LoaderFunctionArgs, redirect} from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {getUserSession} from "~/utils/session.server";

export const loader = async ({ request }: LoaderFunctionArgs)=> {
    const sessionUser = await getUserSession(request);
    if (!sessionUser) {
        return redirect("/login");
    }
    const portfolioData = await getPortfolio(request)
    return getPortfolioStandardDeviation(request, portfolioData)
}

export default function StandardDeviationCard() {
    const standardDeviation = useLoaderData();
    console.log(standardDeviation)
    return (
        <Card className="w-fit p-2">
            <h2>Portfolio Standard Deviation</h2>
            <p>{standardDeviation.toFixed(4)}</p>
        </Card>
    );
}