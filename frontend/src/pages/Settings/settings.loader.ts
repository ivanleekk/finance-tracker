import { redirect } from "react-router";
import { getSSRContext } from "../../lib/ssr-helpers";
import type { UserResponse, CurrencyResponse, TransactionResponse, TradeResponse } from "../../types/types";

export type SettingsLoaderData = {
    user: UserResponse;
    currencies: CurrencyResponse[];
    transactions: TransactionResponse[];
    trades: TradeResponse[];
};

export async function settingsLoader({ request }: { request: Request }): Promise<SettingsLoaderData | Response> {
    const { householdId, ssrFetch } = await getSSRContext(request);

    try {
        const [userRes, currenciesRes, txRes, trRes] = await Promise.all([
            ssrFetch("/users"),
            ssrFetch("/reference/currencies"),
            householdId ? ssrFetch(`/cashflow/transactions/household/${householdId}`) : Promise.resolve(null),
            householdId ? ssrFetch(`/portfolio/trades/household/${householdId}`) : Promise.resolve(null),
        ]);

        if (!userRes.ok) return redirect("/login");

        const [user, currencies, transactions, trades] = await Promise.all([
            userRes.json(),
            currenciesRes.ok ? currenciesRes.json() : [],
            txRes && txRes.ok ? txRes.json() : [],
            trRes && trRes.ok ? trRes.json() : [],
        ]);

        return { user, currencies, transactions, trades };
    } catch (error) {
        if (error instanceof Response) throw error;
        console.error("Settings loader failed:", error);
        return redirect("/login");
    }
}
