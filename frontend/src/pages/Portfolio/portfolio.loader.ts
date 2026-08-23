import { getSSRContext } from "../../lib/ssr-helpers";
import type { LoaderFunctionArgs } from "react-router";
import type { SubPortfolioResponse, TradeResponse, AssetResponse, PortfolioSnapshotResponse, PortfolioTimeseriesPoint, PortfolioMetricsResponse, DividendResponse, AccountResponse, CurrencyResponse } from "../../types/types";

export type PortfolioLoaderData = {
    subportfolios: SubPortfolioResponse[];
    trades: TradeResponse[];
    assets: AssetResponse[];
    // Per-asset rows for the *latest* date only (latest_only=true) — the holdings table
    // needs per-asset detail, but never history.
    latestSnapshots: PortfolioSnapshotResponse[];
    // Pre-aggregated (date, sub_portfolio) totals across full history, for the equity curve.
    timeseries: PortfolioTimeseriesPoint[];
    metrics: PortfolioMetricsResponse | null;
    dividends: DividendResponse[];
    accounts: AccountResponse[];
    // For the asset editor's currency picker — a ticker created with the wrong
    // currency is corrected from the holdings table.
    currencies: CurrencyResponse[];
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
        const [spRes, trRes, asRes, snRes, tsRes, meRes, dvRes, accRes, curRes] = await Promise.all([
            ssrFetch(`/portfolio/subportfolios/household/${householdId}`),
            ssrFetch(`/portfolio/trades/household/${householdId}`),
            ssrFetch(`/portfolio/assets`),
            ssrFetch(`/portfolio/snapshots/household/${householdId}?latest_only=true`),
            ssrFetch(`/portfolio/snapshots/household/${householdId}/timeseries`),
            ssrFetch(metricsUrl),
            ssrFetch(`/portfolio/dividends/household/${householdId}`),
            ssrFetch(`/accounts/household/${householdId}`),
            ssrFetch(`/reference/currencies`)
        ]);

        const [subportfolios, trades, assets, latestSnapshots, timeseries, metrics, dividends, accounts, currencies] = await Promise.all([
            spRes.ok ? spRes.json() : [],
            trRes.ok ? trRes.json() : [],
            asRes.ok ? asRes.json() : [],
            snRes.ok ? snRes.json() : [],
            tsRes.ok ? tsRes.json() : [],
            meRes.ok ? meRes.json() : null,
            dvRes.ok ? dvRes.json() : [],
            accRes.ok ? accRes.json() : [],
            curRes.ok ? curRes.json() : []
        ]);

        return {
            subportfolios,
            trades,
            assets,
            latestSnapshots,
            timeseries,
            metrics,
            dividends,
            accounts,
            currencies
        };
    } catch (error) {
        if (error instanceof Response) throw error; // Handle redirect
        console.error("Failed to load portfolio data", error);
        return { subportfolios: [], trades: [], assets: [], latestSnapshots: [], timeseries: [], metrics: null, dividends: [], accounts: [], currencies: [] };
    }
}
