import { getSSRContext } from "../../lib/ssr-helpers";
import type { LoaderFunctionArgs } from "react-router";
import type { 
    AccountResponse, 
    BalanceResponse, 
    SubPortfolioResponse, 
    TransactionResponse, 
    PortfolioSnapshotResponse 
} from "../../types/types";

export type DashboardLoaderData = {
    accounts: AccountResponse[];
    balances: Record<string, BalanceResponse[]>;
    subPortfolios: SubPortfolioResponse[];
    transactions: TransactionResponse[];
    snapshots: PortfolioSnapshotResponse[];
};

export async function dashboardLoader({ request }: LoaderFunctionArgs): Promise<DashboardLoaderData> {
    const { householdId, ssrFetch } = await getSSRContext(request);

    try {
        const [accountsRes, subPortfoliosRes, transactionsRes, snapshotsRes] = await Promise.all([
            ssrFetch(`/accounts/household/${householdId}`),
            ssrFetch(`/portfolio/subportfolios/household/${householdId}`),
            ssrFetch(`/cashflow/transactions/household/${householdId}`),
            ssrFetch(`/portfolio/snapshots/household/${householdId}`)
        ]);

        if (!accountsRes.ok || !subPortfoliosRes.ok || !transactionsRes.ok || !snapshotsRes.ok) {
            console.error("One or more dashboard requests failed", {
                accounts: accountsRes.status,
                subPortfolios: subPortfoliosRes.status,
                transactions: transactionsRes.status,
                snapshots: snapshotsRes.status
            });
            throw new Error("Failed to fetch dashboard data");
        }

        const [accounts, subPortfolios, transactions, snapshots] = await Promise.all([
            accountsRes.json(),
            subPortfoliosRes.json(),
            transactionsRes.json(),
            snapshotsRes.json()
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
            snapshots
        };
    } catch (error) {
        if (error instanceof Response) throw error; // Handle redirect
        console.error("Dashboard loader failed", error);
        return { 
            accounts: [], 
            balances: {}, 
            subPortfolios: [], 
            transactions: [], 
            snapshots: [] 
        };
    }
}
