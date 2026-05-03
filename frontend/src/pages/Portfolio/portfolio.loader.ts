import api from "../../lib/api";
import type { SubPortfolioResponse, TradeResponse, AssetResponse } from "../../types/types";

export type PortfolioLoaderData = {
    subportfolios: SubPortfolioResponse[];
    trades: TradeResponse[];
    assets: AssetResponse[];
};

export async function portfolioLoader(): Promise<PortfolioLoaderData> {
    const activeHouseholdId = localStorage.getItem('activeHouseholdId');
    if (!activeHouseholdId) {
        return { subportfolios: [], trades: [], assets: [] };
    }

    try {
        const [spRes, trRes, asRes] = await Promise.all([
            api.get<SubPortfolioResponse[]>(`/portfolio/subportfolios/household/${activeHouseholdId}`),
            api.get<TradeResponse[]>(`/portfolio/trades/household/${activeHouseholdId}`),
            api.get<AssetResponse[]>(`/portfolio/assets`)
        ]);

        return {
            subportfolios: spRes.data,
            trades: trRes.data,
            assets: asRes.data
        };
    } catch (error) {
        console.error("Failed to load portfolio data", error);
        return { subportfolios: [], trades: [], assets: [] };
    }
}
