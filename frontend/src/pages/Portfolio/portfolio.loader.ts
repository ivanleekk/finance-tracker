import { getSSRContext } from "../../lib/ssr-helpers";
import type { LoaderFunctionArgs } from "react-router";
import type { SubPortfolioResponse, TradeResponse, AssetResponse } from "../../types/types";

export type PortfolioLoaderData = {
    subportfolios: SubPortfolioResponse[];
    trades: TradeResponse[];
    assets: AssetResponse[];
};

export async function portfolioLoader({ request }: LoaderFunctionArgs): Promise<PortfolioLoaderData> {
    const { householdId, ssrFetch } = await getSSRContext(request);

    try {
        const [spRes, trRes, asRes] = await Promise.all([
            ssrFetch(`/portfolio/subportfolios/household/${householdId}`),
            ssrFetch(`/portfolio/trades/household/${householdId}`),
            ssrFetch(`/portfolio/assets`)
        ]);

        if (!spRes.ok || !trRes.ok || !asRes.ok) {
             throw new Error("One or more requests failed");
        }

        const [subportfolios, trades, assets] = await Promise.all([
            spRes.json(),
            trRes.json(),
            asRes.json()
        ]);

        return {
            subportfolios,
            trades,
            assets
        };
    } catch (error) {
        if (error instanceof Response) throw error; // Handle redirect
        console.error("Failed to load portfolio data", error);
        return { subportfolios: [], trades: [], assets: [] };
    }
}
