import type { PortfolioSnapshotResponse } from "../types/types";

export type GoalProjection = {
    currentValue: number;
    percentComplete: number;
    remaining: number;
    monthlyPace: number; // average $/month contributed over the trailing window, from snapshot value deltas
    etaLabel: string | null; // e.g. "Q4 '27" or null if no target/no pace
    onTrack: boolean | null; // null if not enough data to say
};

/** Sums snapshot values across all assets in a sub-portfolio, per date, and returns dates sorted ascending. */
export function valueHistoryForGoal(snapshots: PortfolioSnapshotResponse[], subPortfolioId: string): { date: string; value: number }[] {
    const byDate = new Map<string, number>();
    snapshots
        .filter(s => s.sub_portfolio_id === subPortfolioId)
        .forEach(s => {
            byDate.set(s.date, (byDate.get(s.date) || 0) + Number(s.current_value_home_currency));
        });
    return Array.from(byDate.entries())
        .map(([date, value]) => ({ date, value }))
        .sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function projectGoal(history: { date: string; value: number }[], targetAmount: number | null): GoalProjection {
    const currentValue = history.length > 0 ? history[history.length - 1].value : 0;
    const percentComplete = targetAmount ? Math.min(100, Math.max(0, (currentValue / targetAmount) * 100)) : 0;
    const remaining = targetAmount ? Math.max(0, targetAmount - currentValue) : 0;

    // Estimate monthly contribution pace from the trailing ~90 days of snapshot history.
    let monthlyPace = 0;
    if (history.length >= 2) {
        const last = history[history.length - 1];
        const cutoff = new Date(last.date).getTime() - 90 * 24 * 60 * 60 * 1000;
        const windowStart = history.find(h => new Date(h.date).getTime() >= cutoff) || history[0];
        const days = Math.max(1, (new Date(last.date).getTime() - new Date(windowStart.date).getTime()) / (24 * 60 * 60 * 1000));
        const delta = last.value - windowStart.value;
        monthlyPace = (delta / days) * 30;
    }

    let etaLabel: string | null = null;
    let onTrack: boolean | null = null;
    if (targetAmount && monthlyPace > 0 && remaining > 0) {
        const monthsToGo = remaining / monthlyPace;
        const eta = new Date();
        eta.setMonth(eta.getMonth() + Math.ceil(monthsToGo));
        const quarter = Math.floor(eta.getMonth() / 3) + 1;
        etaLabel = `Q${quarter} '${String(eta.getFullYear()).slice(2)}`;
        onTrack = true;
    } else if (targetAmount && remaining > 0) {
        onTrack = monthlyPace > 0 ? true : false;
    } else if (targetAmount && remaining === 0) {
        onTrack = true;
    }

    return { currentValue, percentComplete, remaining, monthlyPace, etaLabel, onTrack };
}
