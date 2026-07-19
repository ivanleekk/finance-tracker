import type { AssetResponse, DividendResponse, PortfolioSnapshotResponse } from "../types/types";

export type HoldingDividendSummary = {
    assetId: string;
    ticker: string;
    receivedThisYear: number;
    trailingYield: number; // trailing-12mo income / current value
    yieldOnCost: number; // trailing-12mo income / cost basis
    nextPayment: { date: string; amount: number } | null;
};

export type DividendCalendarMonth = {
    month: number; // 0-11
    received: number;
    projected: number;
};

export type DividendSummary = {
    receivedThisYear: number;
    forwardAnnual: number; // trailing-12mo total, used as a forward-run-rate estimate
    yieldOnCost: number;
    thisMonth: number;
    calendar: DividendCalendarMonth[];
    upcoming: { assetId: string; ticker: string; date: string; amount: number; cadenceDays: number }[];
    holdings: HoldingDividendSummary[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Detects a holding's typical payout cadence (in days) from its last two dividend dates. Falls back to quarterly. */
function detectCadenceDays(datesDesc: string[]): number {
    if (datesDesc.length < 2) return 91;
    const gap = (new Date(datesDesc[0]).getTime() - new Date(datesDesc[1]).getTime()) / DAY_MS;
    if (gap > 300) return 365;
    if (gap > 150) return 182;
    if (gap > 60) return 91;
    return 30;
}

export function summarizeDividends(
    dividends: DividendResponse[],
    assets: AssetResponse[],
    snapshots: PortfolioSnapshotResponse[],
    now: Date = new Date()
): DividendSummary {
    const assetById = new Map(assets.map(a => [a.id, a]));
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const trailing12moStart = new Date(now.getTime() - 365 * DAY_MS);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const byAsset = new Map<string, DividendResponse[]>();
    dividends.forEach(d => {
        const list = byAsset.get(d.asset_id) || [];
        list.push(d);
        byAsset.set(d.asset_id, list);
    });

    // Latest snapshot per asset (for current value + cost basis)
    const latestSnapshotByAsset = new Map<string, PortfolioSnapshotResponse>();
    snapshots.forEach(s => {
        const existing = latestSnapshotByAsset.get(s.asset_id);
        if (!existing || s.date > existing.date) latestSnapshotByAsset.set(s.asset_id, s);
    });

    let receivedThisYear = 0;
    let thisMonth = 0;
    let totalCostBasis = 0;
    let totalTrailingIncome = 0;

    const calendar: DividendCalendarMonth[] = Array.from({ length: 12 }, (_, month) => ({ month, received: 0, projected: 0 }));
    const holdings: HoldingDividendSummary[] = [];
    const upcoming: DividendSummary["upcoming"] = [];

    byAsset.forEach((divs, assetId) => {
        const ticker = assetById.get(assetId)?.ticker || "UNKNOWN";
        const sorted = [...divs].sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first
        const amountOf = (d: DividendResponse) => Number(d.amount_home_currency ?? d.amount);

        let holdingReceivedThisYear = 0;
        let holdingTrailingIncome = 0;

        sorted.forEach(d => {
            const date = new Date(d.date);
            const amt = amountOf(d);
            if (date >= yearStart) {
                holdingReceivedThisYear += amt;
                calendar[date.getMonth()].received += amt;
            }
            if (date >= trailing12moStart) holdingTrailingIncome += amt;
            if (date >= monthStart) thisMonth += amt;
        });

        receivedThisYear += holdingReceivedThisYear;
        totalTrailingIncome += holdingTrailingIncome;

        const snapshot = latestSnapshotByAsset.get(assetId);
        const currentValue = snapshot ? Number(snapshot.current_value_home_currency) : 0;
        const costBasis = snapshot ? Number(snapshot.average_cost_basis_home_currency) * Number(snapshot.quantity) : 0;
        totalCostBasis += costBasis;

        const cadenceDays = detectCadenceDays(sorted.map(d => d.date));
        let nextPayment: HoldingDividendSummary["nextPayment"] = null;
        if (sorted.length > 0) {
            const last = sorted[0];
            const projectedDate = new Date(new Date(last.date).getTime() + cadenceDays * DAY_MS);
            const projectedAmount = amountOf(last);
            if (projectedDate >= now) {
                nextPayment = { date: projectedDate.toISOString(), amount: projectedAmount };
                upcoming.push({ assetId, ticker, date: projectedDate.toISOString(), amount: projectedAmount, cadenceDays });
                if (projectedDate.getFullYear() === now.getFullYear()) {
                    calendar[projectedDate.getMonth()].projected += projectedAmount;
                }
            }
        }

        holdings.push({
            assetId,
            ticker,
            receivedThisYear: holdingReceivedThisYear,
            trailingYield: currentValue > 0 ? holdingTrailingIncome / currentValue : 0,
            yieldOnCost: costBasis > 0 ? holdingTrailingIncome / costBasis : 0,
            nextPayment,
        });
    });

    const forwardAnnual = totalTrailingIncome;
    upcoming.sort((a, b) => (a.date < b.date ? -1 : 1));
    holdings.sort((a, b) => b.receivedThisYear - a.receivedThisYear);

    return {
        receivedThisYear,
        forwardAnnual,
        yieldOnCost: totalCostBasis > 0 ? totalTrailingIncome / totalCostBasis : 0,
        thisMonth,
        calendar,
        upcoming,
        holdings,
    };
}
