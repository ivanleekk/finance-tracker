import { ActionFunctionArgs, redirect } from "@remix-run/node";
import { signOut } from "~/utils/session.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    if (request.method === "POST" && request.url.endsWith("/api/logout")) {
        await signOut(request);
        return redirect("/");
    }
    return new Response("Method Not Allowed", { status: 405 });
};

export default function Index() {
    return (
        <div>
            <h1 className="text-lg text-red-500">404 - Not Found</h1>
        </div>
    );
}