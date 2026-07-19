import { getSSRContext } from "../../lib/ssr-helpers";
import type { LoaderFunctionArgs } from "react-router";
import type { AccountResponse, AssetResponse, DividendResponse, PortfolioSnapshotResponse, ScheduledDividendResponse, SubPortfolioResponse } from "../../types/types";

export type DividendsLoaderData = {
    dividends: DividendResponse[];
    assets: AssetResponse[];
    snapshots: PortfolioSnapshotResponse[];
    scheduled: ScheduledDividendResponse[];
    subportfolios: SubPortfolioResponse[];
    accounts: AccountResponse[];
};

export async function dividendsLoader({ request }: LoaderFunctionArgs): Promise<DividendsLoaderData> {
    const { householdId, ssrFetch } = await getSSRContext(request);

    try {
        const [dvRes, asRes, snRes, scRes, spRes, acRes] = await Promise.all([
            ssrFetch(`/portfolio/dividends/household/${householdId}`),
            ssrFetch(`/portfolio/assets`),
            ssrFetch(`/portfolio/snapshots/household/${householdId}`),
            ssrFetch(`/portfolio/scheduled-dividends/household/${householdId}`),
            ssrFetch(`/portfolio/subportfolios/household/${householdId}`),
            ssrFetch(`/accounts/household/${householdId}`),
        ]);

        const [dividends, assets, snapshots, scheduled, subportfolios, accounts] = await Promise.all([
            dvRes.ok ? dvRes.json() : [],
            asRes.ok ? asRes.json() : [],
            snRes.ok ? snRes.json() : [],
            scRes.ok ? scRes.json() : [],
            spRes.ok ? spRes.json() : [],
            acRes.ok ? acRes.json() : [],
        ]);

        return { dividends, assets, snapshots, scheduled, subportfolios, accounts };
    } catch (error) {
        if (error instanceof Response) throw error;
        console.error("Failed to load dividends", error);
        return { dividends: [], assets: [], snapshots: [], scheduled: [], subportfolios: [], accounts: [] };
    }
}
