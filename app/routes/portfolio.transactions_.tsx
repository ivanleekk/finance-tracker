import {LoaderFunctionArgs, redirect} from "@remix-run/node";
import {getUserSession} from "~/utils/session.server";
import {getTransactions} from "~/portfolio/portfolio";
import {useLoaderData} from "@remix-run/react";
import {DataTable} from "~/components/dataTable";
import {transactionColumns} from "~/portfolio/transactionColumns";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const sessionUser = await getUserSession(request);
    if (!sessionUser) {
        return redirect("/login");
    }

    return await getTransactions(request);
};

export default function Transactions() {
    const transactionData = useLoaderData();

    return (
        <div>
            <DataTable columns={transactionColumns} data={transactionData} />
        </div>
    );
}
