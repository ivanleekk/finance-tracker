import { getSSRContext } from "../../lib/ssr-helpers";
import type { LoaderFunctionArgs } from "react-router";
import type { HouseholdResponse, CurrencyResponse, CountryResponse, AccountResponse, BalanceResponse } from "../../types/types";

export type HouseholdsLoaderData = {
    households: HouseholdResponse[];
    currencies: CurrencyResponse[];
    countries: CountryResponse[];
    accounts: AccountResponse[];
    balances: BalanceResponse[];
};

export async function householdsLoader({ request }: LoaderFunctionArgs): Promise<HouseholdsLoaderData> {
    const { ssrFetch, householdId } = await getSSRContext(request);

    try {
        const [householdsRes, currenciesRes, countriesRes, accountsRes, balancesRes] = await Promise.all([
            ssrFetch("/users/households"),
            ssrFetch("/reference/currencies"),
            ssrFetch("/reference/countries"),
            householdId ? ssrFetch(`/accounts/household/${householdId}`) : Promise.resolve(null),
            householdId ? ssrFetch(`/accounts/balances/household/${householdId}`) : Promise.resolve(null),
        ]);

        const households: HouseholdResponse[] = householdsRes.ok ? await householdsRes.json() : [];
        const currencies: CurrencyResponse[] = currenciesRes.ok ? await currenciesRes.json() : [];
        const countries: CountryResponse[] = countriesRes.ok ? await countriesRes.json() : [];
        const accounts: AccountResponse[] = accountsRes && accountsRes.ok ? await accountsRes.json() : [];
        const balances: BalanceResponse[] = balancesRes && balancesRes.ok ? await balancesRes.json() : [];

        return { households, currencies, countries, accounts, balances };
    } catch (error) {
        if (error instanceof Response) throw error; // Handle redirect
        console.error("Failed to load households", error);
        return { households: [], currencies: [], countries: [], accounts: [], balances: [] };
    }
}
