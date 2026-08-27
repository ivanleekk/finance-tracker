import { getSSRContext } from "../../lib/ssr-helpers";
import type { LoaderFunctionArgs } from "react-router";
import type {
    AccountResponse,
    BalanceResponse,
    SubPortfolioResponse,
    TransactionResponse,
    PortfolioTimeseriesPoint,
    PortfolioMetricsResponse,
    NetWorthProjectionResponse,
    EmergencyFundResponse,
    CounterpartyBalanceResponse,
} from "../../types/types";

export type DashboardLoaderData = {
    accounts: AccountResponse[];
    balances: Record<string, BalanceResponse[]>;
    subPortfolios: SubPortfolioResponse[];
    transactions: TransactionResponse[];
    // Pre-aggregated (date, sub_portfolio) totals — the dashboard only ever charts or
    // sums by date/sub-portfolio, never per-asset, so it doesn't need raw snapshot rows.
    timeseries: PortfolioTimeseriesPoint[];
    metrics: PortfolioMetricsResponse | null;
    // Forward net worth trajectory: loans amortize down, property appreciates.
    // Null when the household has nothing to project (or the call failed).
    projection: NetWorthProjectionResponse | null;
    // Runway: how long liquid cash covers recent spending. Null if unavailable.
    emergencyFund: EmergencyFundResponse | null;
    // Outstanding debts either way. These sit in no account, so without them net
    // worth reports a split bill's unreturned half as money that evaporated.
    owed: CounterpartyBalanceResponse[];
};

export async function dashboardLoader({ request }: LoaderFunctionArgs): Promise<DashboardLoaderData> {
    const { householdId, ssrFetch } = await getSSRContext(request);

    const url = new URL(request.url);
    const startDate = url.searchParams.get("start_date");
    const endDate = url.searchParams.get("end_date");

    const metricsUrl = `/portfolio/household/${householdId}/metrics` + 
        (startDate || endDate ? `?${new URLSearchParams({ 
            ...(startDate && { start_date: startDate }), 
            ...(endDate && { end_date: endDate }) 
        })}` : "");

    try {
        const [accountsRes, subPortfoliosRes, transactionsRes, timeseriesRes, metricsRes, allBalancesRes, projectionRes, emergencyFundRes, owedRes] = await Promise.all([
            ssrFetch(`/accounts/household/${householdId}`),
            ssrFetch(`/portfolio/subportfolios/household/${householdId}`),
            ssrFetch(`/cashflow/transactions/household/${householdId}`),
            ssrFetch(`/portfolio/snapshots/household/${householdId}/timeseries`),
            ssrFetch(metricsUrl),
            ssrFetch(`/accounts/balances/household/${householdId}`),
            ssrFetch(`/accounts/household/${householdId}/projection?months=360`),
            ssrFetch(`/cashflow/household/${householdId}/emergency-fund`),
            ssrFetch(`/cashflow/reimbursements/household/${householdId}`)
        ]);

        const [accounts, subPortfolios, transactions, timeseries, metrics] = await Promise.all([
            accountsRes.ok ? accountsRes.json() : [],
            subPortfoliosRes.ok ? subPortfoliosRes.json() : [],
            transactionsRes.ok ? transactionsRes.json() : [],
            timeseriesRes.ok ? timeseriesRes.json() : [],
            metricsRes.ok ? metricsRes.json() : null
        ]);

        const allBalances: BalanceResponse[] = allBalancesRes.ok ? await allBalancesRes.json() : [];
        // The projection is supplementary — never let it break the dashboard.
        const projection: NetWorthProjectionResponse | null = projectionRes.ok ? await projectionRes.json() : null;
        const emergencyFund: EmergencyFundResponse | null = emergencyFundRes.ok ? await emergencyFundRes.json() : null;
        // Supplementary like the projection — a failure here must not blank the dashboard.
        const owed: CounterpartyBalanceResponse[] = owedRes.ok ? await owedRes.json() : [];

        const balanceMap: Record<string, BalanceResponse[]> = {};
        allBalances.forEach(b => {
            if (!balanceMap[b.account_id]) balanceMap[b.account_id] = [];
            balanceMap[b.account_id].push(b);
        });

        return {
            accounts,
            balances: balanceMap,
            subPortfolios,
            transactions,
            timeseries,
            metrics,
            owed,
            projection,
            emergencyFund
        };
    } catch (error) {
        if (error instanceof Response) throw error; // Handle redirect
        console.error("Dashboard loader failed", error);
        return {
            accounts: [],
            balances: {},
            subPortfolios: [],
            transactions: [],
            timeseries: [],
            metrics: null,
            projection: null,
            emergencyFund: null,
            owed: []
        };
    }
}
