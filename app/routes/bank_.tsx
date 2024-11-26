import { LoaderFunctionArgs } from "@remix-run/node";
import { requireUserSession } from "~/utils/auth.server";
import { getBankInfo } from "~/bank/bank";
import { useLoaderData } from "@remix-run/react";
import { DataTable } from "~/components/dataTable";
import { bankColumns } from "~/bank/bankColumns";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    await requireUserSession(request);

    return await getBankInfo(request);
};

export default function Bank() {
    const bankData = useLoaderData();
    return (
        <div>
            <DataTable columns={bankColumns} data={bankData} />
        </div>
    );
}
