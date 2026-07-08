import { getSSRContext } from "../../lib/ssr-helpers";
import type { LoaderFunctionArgs } from "react-router";
import type { AssetResponse, DividendResponse, PortfolioSnapshotResponse } from "../../types/types";

export type DividendsLoaderData = {
    dividends: DividendResponse[];
    assets: AssetResponse[];
    snapshots: PortfolioSnapshotResponse[];
};

export async function dividendsLoader({ request }: LoaderFunctionArgs): Promise<DividendsLoaderData> {
    const { householdId, ssrFetch } = await getSSRContext(request);

    try {
        const [dvRes, asRes, snRes] = await Promise.all([
            ssrFetch(`/portfolio/dividends/household/${householdId}`),
            ssrFetch(`/portfolio/assets`),
            ssrFetch(`/portfolio/snapshots/household/${householdId}`),
        ]);

        const [dividends, assets, snapshots] = await Promise.all([
            dvRes.ok ? dvRes.json() : [],
            asRes.ok ? asRes.json() : [],
            snRes.ok ? snRes.json() : [],
        ]);

        return { dividends, assets, snapshots };
    } catch (error) {
        if (error instanceof Response) throw error;
        console.error("Failed to load dividends", error);
        return { dividends: [], assets: [], snapshots: [] };
    }
}
