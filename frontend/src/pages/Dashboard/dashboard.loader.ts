import { getSSRContext } from "../../lib/ssr-helpers";
import type { LoaderFunctionArgs } from "react-router";
import type { 
    AccountResponse, 
    BalanceResponse, 
    SubPortfolioResponse, 
    TransactionResponse, 
    PortfolioSnapshotResponse,
    PortfolioMetricsResponse
} from "../../types/types";

export type DashboardLoaderData = {
    accounts: AccountResponse[];
    balances: Record<string, BalanceResponse[]>;
    subPortfolios: SubPortfolioResponse[];
    transactions: TransactionResponse[];
    snapshots: PortfolioSnapshotResponse[];
    metrics: PortfolioMetricsResponse | null;
};

export async function dashboardLoader({ request }: LoaderFunctionArgs): Promise<DashboardLoaderData> {
    const { householdId, ssrFetch } = await getSSRContext(request);

    try {
        const [accountsRes, subPortfoliosRes, transactionsRes, snapshotsRes, metricsRes] = await Promise.all([
            ssrFetch(`/accounts/household/${householdId}`),
            ssrFetch(`/portfolio/subportfolios/household/${householdId}`),
            ssrFetch(`/cashflow/transactions/household/${householdId}`),
            ssrFetch(`/portfolio/snapshots/household/${householdId}`),
            ssrFetch(`/portfolio/household/${householdId}/metrics`)
        ]);

        const [accounts, subPortfolios, transactions, snapshots, metrics] = await Promise.all([
            accountsRes.ok ? accountsRes.json() : [],
            subPortfoliosRes.ok ? subPortfoliosRes.json() : [],
            transactionsRes.ok ? transactionsRes.json() : [],
            snapshotsRes.ok ? snapshotsRes.json() : [],
            metricsRes.ok ? metricsRes.json() : null
        ]);

        const balanceMap: Record<string, BalanceResponse[]> = {};
        await Promise.all(accounts.map(async (acc: AccountResponse) => {
            const bRes = await ssrFetch(`/accounts/balances/account/${acc.id}`);
            if (bRes.ok) {
                balanceMap[acc.id] = await bRes.json();
            }
        }));

        return {
            accounts,
            balances: balanceMap,
            subPortfolios,
            transactions,
            snapshots,
            metrics
        };
    } catch (error) {
        if (error instanceof Response) throw error; // Handle redirect
        console.error("Dashboard loader failed", error);
        return { 
            accounts: [], 
            balances: {}, 
            subPortfolios: [], 
            transactions: [], 
            snapshots: [],
            metrics: null
        };
    }
}
