import { getSSRContext } from "../../lib/ssr-helpers";
import type { LoaderFunctionArgs } from "react-router";
import type { HouseholdResponse, CurrencyResponse, CountryResponse } from "../../types/types";

export type HouseholdsLoaderData = {
    households: HouseholdResponse[];
    currencies: CurrencyResponse[];
    countries: CountryResponse[];
};

export async function householdsLoader({ request }: LoaderFunctionArgs): Promise<HouseholdsLoaderData> {
    const { ssrFetch } = await getSSRContext(request);

    try {
        const [householdsRes, currenciesRes, countriesRes] = await Promise.all([
            ssrFetch("/users/households"),
            ssrFetch("/reference/currencies"),
            ssrFetch("/reference/countries")
        ]);

        const households: HouseholdResponse[] = householdsRes.ok ? await householdsRes.json() : [];
        const currencies: CurrencyResponse[] = currenciesRes.ok ? await currenciesRes.json() : [];
        const countries: CountryResponse[] = countriesRes.ok ? await countriesRes.json() : [];

        return { households, currencies, countries };
    } catch (error) {
        if (error instanceof Response) throw error; // Handle redirect
        console.error("Failed to load households", error);
        return { households: [], currencies: [], countries: [] };
    }
}
