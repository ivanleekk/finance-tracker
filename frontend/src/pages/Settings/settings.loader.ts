import { redirect } from "react-router";
import { getSSRContext } from "../../lib/ssr-helpers";
import type { UserResponse, CurrencyResponse } from "../../types/types";

export type SettingsLoaderData = {
    user: UserResponse;
    currencies: CurrencyResponse[];
    timezones: { name: string; label: string }[];
};

export async function settingsLoader({ request }: { request: Request }): Promise<SettingsLoaderData | Response> {
    const { ssrFetch } = await getSSRContext(request);

    try {
        const [userRes, currenciesRes, timezonesRes] = await Promise.all([
            ssrFetch("/users"),
            ssrFetch("/reference/currencies"),
            ssrFetch("/reference/timezones"),
        ]);

        if (!userRes.ok) return redirect("/login");

        const [user, currencies, timezones] = await Promise.all([
            userRes.json(),
            currenciesRes.ok ? currenciesRes.json() : [],
            timezonesRes.ok ? timezonesRes.json() : [],
        ]);

        return { user, currencies, timezones };
    } catch (error) {
        if (error instanceof Response) throw error;
        console.error("Settings loader failed:", error);
        return redirect("/login");
    }
}
