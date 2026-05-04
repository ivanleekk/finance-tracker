import api from "../../lib/api"
import type { AccountResponse, BalanceResponse } from "../../types/types"

export type AccountWithHistory = AccountResponse & {
    history: BalanceResponse[];
}

export async function accountsLoader(householdId: string): Promise<AccountWithHistory[]> {
    const accountsRes = await api.get<AccountResponse[]>(`/accounts/household/${householdId}`);
    const accountsWithHistory = await Promise.all(accountsRes.data.map(async (acc) => {
        const balancesRes = await api.get<BalanceResponse[]>(`/accounts/balances/account/${acc.id}`);
        return { ...acc, history: balancesRes.data };
    }));
    return accountsWithHistory;
}