import api from "../../lib/api";
import type { TradeResponse, TransactionResponse, AssetResponse, CategoryResponse, AccountResponse, SubPortfolioResponse } from "./types/types";

export type HistoryLoaderData = {
    trades: TradeResponse[];
    transactions: TransactionResponse[];
    assets: AssetResponse[];
    categories: CategoryResponse[];
    accounts: AccountResponse[];
    subportfolios: SubPortfolioResponse[];
};

export async function historyLoader(): Promise<HistoryLoaderData> {
    const activeHouseholdId = localStorage.getItem('activeHouseholdId');
    if (!activeHouseholdId) {
        return { trades: [], transactions: [], assets: [], categories: [], accounts: [], subportfolios: [] };
    }

    try {
        const [trRes, txRes, asRes, catRes, accRes, spRes] = await Promise.all([
            api.get<TradeResponse[]>(`/portfolio/trades/household/${activeHouseholdId}`),
            api.get<TransactionResponse[]>(`/cashflow/transactions/household/${activeHouseholdId}`),
            api.get<AssetResponse[]>(`/portfolio/assets`),
            api.get<CategoryResponse[]>(`/cashflow/categories/household/${activeHouseholdId}`),
            api.get<AccountResponse[]>(`/accounts/household/${activeHouseholdId}`),
            api.get<SubPortfolioResponse[]>(`/portfolio/subportfolios/household/${activeHouseholdId}`)
        ]);

        return {
            trades: trRes.data,
            transactions: txRes.data,
            assets: asRes.data,
            categories: catRes.data,
            accounts: accRes.data,
            subportfolios: spRes.data
        };
    } catch (error) {
        console.error("Failed to load history data", error);
        return { trades: [], transactions: [], assets: [], categories: [], accounts: [], subportfolios: [] };
    }
}
