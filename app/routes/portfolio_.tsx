import {getUserSession} from "~/utils/session.server";
import {LoaderFunctionArgs, redirect} from "@remix-run/node";
import {getPortfolio} from "~/portfolio/portfolio";
import {useLoaderData} from "@remix-run/react";
import {DataTable} from "~/components/dataTable";
import {portfolioColumns} from "~/portfolio/portfolioColumns";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const sessionUser = await getUserSession(request);
    if (!sessionUser) {
        return redirect("/login");
    }
    return await getPortfolio(request)
};

export default function Portfolio() {
    const portfolioData = useLoaderData();


    return (
        <div>
            <DataTable columns={portfolioColumns} data={portfolioData} />

        </div>
    );
}