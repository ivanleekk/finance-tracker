import { getSSRContext } from "../../lib/ssr-helpers";
import type { LoaderFunctionArgs } from "react-router";
import type { TradeResponse, TransactionResponse, AssetResponse, CategoryResponse, AccountResponse, SubPortfolioResponse, CurrencyResponse, MccResponse } from "../../types/types";

export type HistoryLoaderData = {
    trades: TradeResponse[];
    transactions: TransactionResponse[];
    assets: AssetResponse[];
    categories: CategoryResponse[];
    accounts: AccountResponse[];
    subportfolios: SubPortfolioResponse[];
    currencies: CurrencyResponse[];
    // Static reference data. Empty is a valid state — the field is hidden unless the
    // user opted in anyway, so a failure here must not take the page down.
    mccs: MccResponse[];
};

export async function transactionsLoader({ request }: LoaderFunctionArgs): Promise<HistoryLoaderData> {
    const { householdId, ssrFetch } = await getSSRContext(request);

    try {
        const [trRes, txRes, asRes, catRes, accRes, spRes, curRes, mccRes] = await Promise.all([
            ssrFetch(`/portfolio/trades/household/${householdId}`),
            ssrFetch(`/cashflow/transactions/household/${householdId}`),
            ssrFetch(`/portfolio/assets`),
            ssrFetch(`/cashflow/categories/household/${householdId}`),
            ssrFetch(`/accounts/household/${householdId}`),
            ssrFetch(`/portfolio/subportfolios/household/${householdId}`),
            ssrFetch(`/reference/currencies`),
            ssrFetch(`/reference/mccs`)
        ]);

        if (!trRes.ok || !txRes.ok || !asRes.ok || !catRes.ok || !accRes.ok || !spRes.ok || !curRes.ok) {
            throw new Error("One or more requests failed");
        }

        const [trades, transactions, assets, categories, accounts, subportfolios, currencies] = await Promise.all([
            trRes.json(),
            txRes.json(),
            asRes.json(),
            catRes.json(),
            accRes.json(),
            spRes.json(),
            curRes.json()
        ]);

        // Deliberately outside the ok-guard above: reference data is supplementary.
        const mccs: MccResponse[] = mccRes.ok ? await mccRes.json() : [];

        return {
            trades,
            transactions,
            assets,
            categories,
            accounts,
            subportfolios,
            currencies,
            mccs
        };
    } catch (error) {
        if (error instanceof Response) throw error; // Handle redirect
        console.error("Failed to load history data", error);
        return { trades: [], transactions: [], assets: [], categories: [], accounts: [], subportfolios: [], currencies: [], mccs: [] };
    }
}
