import { ActionFunctionArgs, redirect } from "@remix-run/node";
import { signOut } from "~/utils/session.server";

export default function Index() {
    return (
        <div>
            <h1 className="text-lg text-red-500">404 - Not Found</h1>
        </div>
    );
}