import { redirect } from "react-router";
import { getSSRContext } from "../../lib/ssr-helpers";
import type { UserResponse, CurrencyResponse } from "../../types/types";

export type SettingsLoaderData = {
    user: UserResponse;
    currencies: CurrencyResponse[];
};

export async function settingsLoader({ request }: { request: Request }): Promise<SettingsLoaderData | Response> {
    const { ssrFetch } = await getSSRContext(request);

    try {
        const [userRes, currenciesRes] = await Promise.all([
            ssrFetch("/users"),
            ssrFetch("/reference/currencies"),
        ]);

        if (!userRes.ok) return redirect("/login");

        const [user, currencies] = await Promise.all([
            userRes.json(),
            currenciesRes.ok ? currenciesRes.json() : [],
        ]);

        return { user, currencies };
    } catch (error) {
        if (error instanceof Response) throw error;
        console.error("Settings loader failed:", error);
        return redirect("/login");
    }
}
