import {getUserSession} from "~/utils/session.server";
import {LoaderFunctionArgs, redirect} from "@remix-run/node";
import {getPortfolio} from "~/portfolio/portfolio";
import {useLoaderData} from "@remix-run/react";
import {DataTable} from "~/components/dataTable";
import {portfolioColumns} from "~/portfolio/portfolioColumns";
import {requireUserSession} from "~/utils/auth.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    await requireUserSession(request);

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