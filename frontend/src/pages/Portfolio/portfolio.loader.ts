import { getSSRContext } from "../../lib/ssr-helpers";
import type { LoaderFunctionArgs } from "react-router";
import type { SubPortfolioResponse, TradeResponse, AssetResponse, PortfolioSnapshotResponse, PortfolioMetricsResponse, DividendResponse, AccountResponse } from "../../types/types";

export type PortfolioLoaderData = {
    subportfolios: SubPortfolioResponse[];
    trades: TradeResponse[];
    assets: AssetResponse[];
    snapshots: PortfolioSnapshotResponse[];
    metrics: PortfolioMetricsResponse | null;
    dividends: DividendResponse[];
    accounts: AccountResponse[];
};

export async function portfolioLoader({ request }: LoaderFunctionArgs): Promise<PortfolioLoaderData> {
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
        const [spRes, trRes, asRes, snRes, meRes, dvRes, accRes] = await Promise.all([
            ssrFetch(`/portfolio/subportfolios/household/${householdId}`),
            ssrFetch(`/portfolio/trades/household/${householdId}`),
            ssrFetch(`/portfolio/assets`),
            ssrFetch(`/portfolio/snapshots/household/${householdId}`),
            ssrFetch(metricsUrl),
            ssrFetch(`/portfolio/dividends/household/${householdId}`),
            ssrFetch(`/accounts/household/${householdId}`)
        ]);

        const [subportfolios, trades, assets, snapshots, metrics, dividends, accounts] = await Promise.all([
            spRes.ok ? spRes.json() : [],
            trRes.ok ? trRes.json() : [],
            asRes.ok ? asRes.json() : [],
            snRes.ok ? snRes.json() : [],
            meRes.ok ? meRes.json() : null,
            dvRes.ok ? dvRes.json() : [],
            accRes.ok ? accRes.json() : []
        ]);

        return {
            subportfolios,
            trades,
            assets,
            snapshots,
            metrics,
            dividends,
            accounts
        };
    } catch (error) {
        if (error instanceof Response) throw error; // Handle redirect
        console.error("Failed to load portfolio data", error);
        return { subportfolios: [], trades: [], assets: [], snapshots: [], metrics: null, dividends: [], accounts: [] };
    }
}
