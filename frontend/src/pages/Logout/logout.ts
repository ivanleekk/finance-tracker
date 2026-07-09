import { redirect, type ActionFunctionArgs } from "react-router";
import { getApiUrl } from "../../lib/api-url";

export async function action({ request }: ActionFunctionArgs) {
    const headers = new Headers();
    const cookie = request.headers.get("Cookie");
    if (cookie) headers.set("Cookie", cookie);

    try {
        // Call backend to invalidate session and clear cookie
        const response = await fetch(getApiUrl("/auth/logout"), { headers });

        // Forward every Set-Cookie deletion header back to the browser
        // (both access_token and refresh_token must be cleared).
        const outHeaders = new Headers();
        for (const cookie of response.headers.getSetCookie()) {
            outHeaders.append("Set-Cookie", cookie);
        }

        return redirect("/login", { headers: outHeaders });
    } catch (e) {
        console.error("Logout action failed", e);
        return redirect("/login");
    }
}
