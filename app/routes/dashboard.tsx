import {LoaderFunctionArgs, MetaFunction, redirect} from "@remix-run/node";
import {getUserSession} from "~/utils/session.server";
import React from "react";
import {requireUserSession} from "~/utils/auth.server";

export const meta: MetaFunction = () => {
    return [
        { title: "Finance Tracker" },
        { name: "Finance Tracker", content: "Finance Tracker" },
    ];
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
    await requireUserSession(request);


    return null;
};

export default function Index({ children }: { children: React.ReactNode }) {
    return (
        <div className="text-center text-9xl">
            Hi i am
        </div>
    );
}
