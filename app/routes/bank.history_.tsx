import { LoaderFunctionArgs, MetaFunction, redirect } from "@remix-run/node";
import { getUserSession } from "~/utils/session.server";
import React from "react";
import {requireUserSession} from "~/utils/auth.server";


export const loader = async ({ request }: LoaderFunctionArgs) => {
    await requireUserSession(request);

    return null;
};

export default function BankHistory({ children }: { children: React.ReactNode }) {
    return (
        <div className="text-center text-9xl">
            Banks History
        </div>
    );
}
