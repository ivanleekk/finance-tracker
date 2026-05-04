import api from "../../lib/api"
import type { AccountResponse, SubPortfolioResponse } from "../../types/types"

export async function tradeFormLoader(householdId: string) {
    const [accountsRes, subRes] = await Promise.all([
        api.get<AccountResponse[]>(`/accounts/household/${householdId}`),
        api.get<SubPortfolioResponse[]>(`/portfolio/subportfolios/household/${householdId}`)
    ]);
    
    return {
        accounts: accountsRes.data,
        subportfolios: subRes.data
    };
}

export async function createDefaultAccount(householdId: string, baseCurrency: string) {
    const newAcc = await api.post<AccountResponse>('/accounts/', {
        name: "Default Brokerage",
        liquidity: "market_liquid",
        tax_status: "taxable",
        currency: baseCurrency || "USD",
        household_id: householdId
    });
    return newAcc.data;
}

export async function createDefaultSubportfolio(householdId: string) {
    const newSp = await api.post<SubPortfolioResponse>('/portfolio/subportfolios', {
        name: "Main Portfolio",
        risk_profile: "Moderate",
        household_id: householdId
    });
    return newSp.data;
}