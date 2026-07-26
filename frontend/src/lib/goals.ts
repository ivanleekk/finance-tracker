import type { PortfolioTimeseriesPoint } from "../types/types";

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

/** This sub-portfolio's value per date (already summed across assets server-side), sorted ascending. */
export function valueHistoryForGoal(timeseries: PortfolioTimeseriesPoint[], subPortfolioId: string): { date: string; value: number }[] {
    return timeseries
        .filter(t => t.sub_portfolio_id === subPortfolioId)
        .map(t => {
            // total_value_home_currency can be non-numeric in edge cases (e.g. a manual
            // snapshot with no recorded value); Number(undefined) is NaN, which would
            // poison every downstream goal projection. Coerce non-finite to 0.
            const raw = Number(t.total_value_home_currency);
            return { date: t.date, value: Number.isFinite(raw) ? raw : 0 };
        })
        .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** "Dec 2027" style label for a goal's target date. */
export function formatDueDate(targetDate: string): string {
    return new Date(targetDate).toLocaleDateString("default", { month: "short", year: "numeric" });
}

export function projectGoal(
    history: { date: string; value: number }[],
    targetAmountInput: number | string | null,
    targetDate?: string | null,
): GoalProjection {
    const rawCurrent = history.length > 0 ? history[history.length - 1].value : 0;
    // Defend the projection against a non-finite value slipping in from history,
    // so nothing downstream (percentages, pace, ETA) can become NaN/Infinity.
    const currentValue = Number.isFinite(rawCurrent) ? rawCurrent : 0;
    // The backend serializes Decimal fields (like target_amount) as JSON strings, so
    // coerce before the finite check — Number.isFinite('20000') is false, unlike the
    // coercing global isFinite, and would silently null out every string target.
    let targetAmount: number | null = targetAmountInput != null ? Number(targetAmountInput) : null;
    // A non-finite or non-positive target isn't a usable goal target; treat it
    // as "no target" so we never emit NaN/Infinity percentages.
    if (targetAmount != null && (!Number.isFinite(targetAmount) || targetAmount <= 0)) {
        targetAmount = null;
    }
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
