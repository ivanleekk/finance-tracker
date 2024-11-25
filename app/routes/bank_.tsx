import { LoaderFunctionArgs, MetaFunction, redirect } from "@remix-run/node";
import { getUserSession } from "~/utils/session.server";
import React from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const sessionUser = await getUserSession(request);
    if (!sessionUser) {
        return redirect("/login");
    }

    return null;
};

export default function Bank({ children }: { children: React.ReactNode }) {
    return (
        <div className="text-center text-9xl">
            Banks home
        </div>
    );
}
