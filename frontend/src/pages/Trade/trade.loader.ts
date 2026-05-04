import { getSSRContext } from "../../lib/ssr-helpers";
import type { LoaderFunctionArgs } from "react-router";
import type { AccountResponse, SubPortfolioResponse } from "../../types/types";

export async function tradeFormLoader({ request }: LoaderFunctionArgs) {
    const { householdId, ssrFetch } = await getSSRContext(request);

    try {
        const [accountsRes, subRes] = await Promise.all([
            ssrFetch(`/accounts/household/${householdId}`),
            ssrFetch(`/portfolio/subportfolios/household/${householdId}`)
        ]);
        
        if (!accountsRes.ok || !subRes.ok) {
            throw new Error("Failed to load trade form data");
        }

        const [accounts, subportfolios] = await Promise.all([
            accountsRes.json(),
            subRes.json()
        ]);

        return {
            accounts,
            subportfolios
        };
    } catch (error) {
        if (error instanceof Response) throw error; // Handle redirect
        console.error("Failed to fetch trade form data", error);
        return { accounts: [], subportfolios: [] };
    }
}
