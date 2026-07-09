import type { PortfolioSnapshotResponse } from "../types/types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_MONTH = 30.44;

export type GoalProjection = {
    currentValue: number;
    percentComplete: number;
    remaining: number;
    monthlyPace: number; // average $/month contributed over the trailing window, from snapshot value deltas
    etaLabel: string | null; // e.g. "Q4 '27" or null if no target/no pace
    onTrack: boolean | null; // null if not enough data to say
    // Target-date-aware fields; null when the goal has no target date.
    monthsToTarget: number | null; // fractional months from today until the target date (0 if past)
    requiredPace: number | null; // $/month needed from today to hit the target on time
    projectedAtTarget: number | null; // value expected on the target date at the current pace
    shortfallAtTarget: number | null; // how far projectedAtTarget falls short of the target (0 if on/above target)
    etaVsTargetMonths: number | null; // positive = ETA lands after the target date (behind), negative = ahead
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

/** "Dec 2027" style label for a goal's target date. */
export function formatDueDate(targetDate: string): string {
    return new Date(targetDate).toLocaleDateString("default", { month: "short", year: "numeric" });
}

export function projectGoal(
    history: { date: string; value: number }[],
    targetAmount: number | null,
    targetDate?: string | null,
): GoalProjection {
    const currentValue = history.length > 0 ? history[history.length - 1].value : 0;
    const percentComplete = targetAmount ? Math.min(100, Math.max(0, (currentValue / targetAmount) * 100)) : 0;
    const remaining = targetAmount ? Math.max(0, targetAmount - currentValue) : 0;

    // Estimate monthly contribution pace from the trailing ~90 days of snapshot history.
    let monthlyPace = 0;
    if (history.length >= 2) {
        const last = history[history.length - 1];
        const cutoff = new Date(last.date).getTime() - 90 * MS_PER_DAY;
        const windowStart = history.find(h => new Date(h.date).getTime() >= cutoff) || history[0];
        const days = Math.max(1, (new Date(last.date).getTime() - new Date(windowStart.date).getTime()) / MS_PER_DAY);
        const delta = last.value - windowStart.value;
        monthlyPace = (delta / days) * 30;
    }

    let etaLabel: string | null = null;
    let etaTime: number | null = null;
    if (targetAmount && monthlyPace > 0 && remaining > 0) {
        const monthsToGo = remaining / monthlyPace;
        const eta = new Date();
        eta.setMonth(eta.getMonth() + Math.ceil(monthsToGo));
        const quarter = Math.floor(eta.getMonth() / 3) + 1;
        etaLabel = `Q${quarter} '${String(eta.getFullYear()).slice(2)}`;
        etaTime = eta.getTime();
    }

    // Target-date projections
    let monthsToTarget: number | null = null;
    let requiredPace: number | null = null;
    let projectedAtTarget: number | null = null;
    let shortfallAtTarget: number | null = null;
    let etaVsTargetMonths: number | null = null;
    if (targetDate) {
        const targetTime = new Date(targetDate).getTime();
        monthsToTarget = Math.max(0, (targetTime - Date.now()) / (DAYS_PER_MONTH * MS_PER_DAY));
        if (targetAmount) {
            requiredPace = remaining > 0 && monthsToTarget > 0 ? remaining / monthsToTarget : remaining > 0 ? null : 0;
            projectedAtTarget = currentValue + Math.max(0, monthlyPace) * monthsToTarget;
            shortfallAtTarget = Math.max(0, targetAmount - projectedAtTarget);
        }
        if (etaTime !== null) {
            etaVsTargetMonths = Math.round((etaTime - targetTime) / (DAYS_PER_MONTH * MS_PER_DAY));
        }
    }

    // On-track: with a target date, compare actual pace against the pace required to
    // land on time; without one, fall back to "is there any positive pace at all".
    let onTrack: boolean | null = null;
    if (targetAmount) {
        if (remaining === 0) {
            onTrack = true;
        } else if (targetDate && monthsToTarget !== null) {
            if (monthsToTarget === 0) {
                onTrack = false; // target date has passed with money still to go
            } else if (requiredPace !== null) {
                onTrack = monthlyPace >= requiredPace;
            }
        } else {
            onTrack = monthlyPace > 0;
        }
    }

    return {
        currentValue,
        percentComplete,
        remaining,
        monthlyPace,
        etaLabel,
        onTrack,
        monthsToTarget,
        requiredPace,
        projectedAtTarget,
        shortfallAtTarget,
        etaVsTargetMonths,
    };
}
