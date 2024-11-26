import { LoaderFunctionArgs, MetaFunction, redirect } from "@remix-run/node";
import React from "react";
import { requireUserSession } from "~/utils/auth.server";
import { getBankHistory } from "~/bank/bank";
import { useLoaderData } from "@remix-run/react";


export const loader = async ({ request }: LoaderFunctionArgs) => {
    await requireUserSession(request);

    return await getBankHistory(request);
};

export default function BankHistory({ children }: { children: React.ReactNode }) {
    const bankHistory = useLoaderData();
    console.log(bankHistory);
    console.log(bankHistory[0].history);
    return (
        <div className="text-center text-9xl">
            Banks History
        </div>
    );
}
