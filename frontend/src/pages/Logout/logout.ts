import { redirect, type ActionFunctionArgs } from "react-router";
import { getApiUrl } from "../../lib/api-url";

export async function action({ request }: ActionFunctionArgs) {
    const headers = new Headers();
    const cookie = request.headers.get("Cookie");
    if (cookie) headers.set("Cookie", cookie);

    try {
        // Call backend to invalidate session and clear cookie
        const response = await fetch(getApiUrl("/auth/logout"), { headers });
        
        // We must forward the Set-Cookie (which deletes the cookie) back to the browser
        const authCookie = response.headers.get("Set-Cookie");
        
        return redirect("/login", {
            headers: authCookie ? { "Set-Cookie": authCookie } : undefined,
        });
    } catch (e) {
        console.error("Logout action failed", e);
        return redirect("/login");
    }
}
