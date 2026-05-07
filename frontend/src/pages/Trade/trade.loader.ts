import { getSSRContext } from "../../lib/ssr-helpers";
import type { LoaderFunctionArgs } from "react-router";
import type { AccountResponse, SubPortfolioResponse, CurrencyResponse } from "../../types/types";

export type TradeLoaderData = {
    accounts: AccountResponse[];
    subportfolios: SubPortfolioResponse[];
    currencies: CurrencyResponse[];
};

export async function tradeFormLoader({ request }: LoaderFunctionArgs): Promise<TradeLoaderData> {
    const { householdId, ssrFetch } = await getSSRContext(request);

    try {
        const [accountsRes, subRes, curRes] = await Promise.all([
            ssrFetch(`/accounts/household/${householdId}`),
            ssrFetch(`/portfolio/subportfolios/household/${householdId}`),
            ssrFetch(`/reference/currencies`)
        ]);
        
        if (!accountsRes.ok || !subRes.ok || !curRes.ok) {
            throw new Error("Failed to load trade form data");
        }

        const [accounts, subportfolios, currencies] = await Promise.all([
            accountsRes.json(),
            subRes.json(),
            curRes.json()
        ]);

        return {
            accounts,
            subportfolios,
            currencies
        };
    } catch (error) {
        if (error instanceof Response) throw error; // Handle redirect
        console.error("Failed to fetch trade form data", error);
        return { accounts: [], subportfolios: [], currencies: [] };
    }
}
