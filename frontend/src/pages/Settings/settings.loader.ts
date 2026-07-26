import { redirect } from "react-router";
import { getSSRContext } from "../../lib/ssr-helpers";
import type { UserResponse, CurrencyResponse, AccountResponse } from "../../types/types";

export type SettingsLoaderData = {
    user: UserResponse;
    currencies: CurrencyResponse[];
    timezones: { name: string; label: string }[];
    accounts: AccountResponse[];
};

export async function settingsLoader({ request }: { request: Request }): Promise<SettingsLoaderData | Response> {
    const { householdId, ssrFetch } = await getSSRContext(request);

    try {
        const [userRes, currenciesRes, timezonesRes, accountsRes] = await Promise.all([
            ssrFetch("/users"),
            ssrFetch("/reference/currencies"),
            ssrFetch("/reference/timezones"),
            householdId ? ssrFetch(`/accounts/household/${householdId}`) : Promise.resolve(null),
        ]);

        if (!userRes.ok) return redirect("/login");

        const [user, currencies, timezones, accounts] = await Promise.all([
            userRes.json(),
            currenciesRes.ok ? currenciesRes.json() : [],
            timezonesRes.ok ? timezonesRes.json() : [],
            accountsRes?.ok ? accountsRes.json() : [],
        ]);

        return { user, currencies, timezones, accounts };
    } catch (error) {
        if (error instanceof Response) throw error;
        console.error("Settings loader failed:", error);
        return redirect("/login");
    }
}
