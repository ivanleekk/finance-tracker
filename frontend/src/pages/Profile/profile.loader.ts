import { redirect } from "react-router";
import { getSSRContext } from "../../lib/ssr-helpers";
import type { UserResponse, HouseholdResponse, CurrencyResponse } from "../../types/types";

export async function profileLoader({ request }: { request: Request }) {
    const { ssrFetch } = await getSSRContext(request);

    try {
        // Fetch all required data in parallel using the SSR-safe fetcher
        const [userRes, householdsRes, currenciesRes, timezonesRes] = await Promise.all([
            ssrFetch("/users/"),
            ssrFetch("/users/households"),
            ssrFetch("/reference/currencies"),
            ssrFetch("/reference/timezones")
        ]);

        if (!userRes.ok || !householdsRes.ok || !currenciesRes.ok || !timezonesRes.ok) {
            console.error("Failed to fetch profile data:", {
                user: userRes.status,
                households: householdsRes.status,
                currencies: currenciesRes.status,
                timezones: timezonesRes.status
            });
            return redirect("/login");
        }

        const [user, households, currencies, timezones] = await Promise.all([
            userRes.json(),
            householdsRes.json(),
            currenciesRes.json(),
            timezonesRes.json()
        ]);

        return {
            user: user as UserResponse,
            households: households as HouseholdResponse[],
            currencies: currencies as CurrencyResponse[],
            timezones: timezones as { name: string; label: string }[]
        };
    } catch (error) {
        console.error("Profile loader failed:", error);
        return redirect("/login");
    }
}
