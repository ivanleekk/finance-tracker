import { Form } from "react-router";
import { Trash2 } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { budgetBarPercent, periodElapsedPercent } from "../../lib/budgets";
import { cardLimitTone, headroomLabel, type CardLimitTone } from "../../lib/cards";
import { cn } from "../../lib/utils";
import type { CardCategorySpendRow, CardLimitStatusRow } from "../../types/types";

/**
 * The meters themselves — one bar per limit, plus the cycle's spend by
 * category.
 *
 * The bar and the pace marker come from the budget helpers unchanged: a card
 * limit row is the same shape, which is the whole reason this feature is a
 * re-parameterisation rather than a second system.
 */

const TONE_BAR: Record<CardLimitTone, string> = {
    over: "bg-red-500",
    "at-risk": "bg-amber-500",
    ok: "bg-primary-500",
};

const TONE_TEXT: Record<CardLimitTone, string> = {
    over: "text-red-600 dark:text-red-400",
    "at-risk": "text-amber-600 dark:text-amber-400",
    ok: "text-base-600 dark:text-base-400",
};

export function LimitMeter({
    row,
    formatAmount,
}: {
    row: CardLimitStatusRow;
    formatAmount: (value: number) => string;
}) {
    const tone = cardLimitTone(row);
    const barPercent = budgetBarPercent(row);
    const pacePercent = periodElapsedPercent(row);

    return (
        <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                    <span className="text-sm font-medium text-base-900 dark:text-base-50">
                        {row.name}
                    </span>
                    {row.direction === "floor" && (
                        <Badge className="ml-2 align-middle">Minimum</Badge>
                    )}
                    {row.category_names.length > 0 && (
                        <div className="truncate text-xs text-base-500 dark:text-base-400">
                            {row.category_names.join(" · ")}
                        </div>
                    )}
                </div>
                <div className="shrink-0 text-right">
                    <div className={cn("text-sm font-semibold tabular-nums", TONE_TEXT[tone])}>
                        {headroomLabel(row, formatAmount)}
                    </div>
                    <div className="text-xs tabular-nums text-base-500 dark:text-base-400">
                        {formatAmount(Number(row.spent))} of {formatAmount(Number(row.amount))}
                    </div>
                </div>
            </div>

            <div className="relative h-2 overflow-hidden rounded-full bg-base-100 dark:bg-base-800">
                <div
                    className={cn("h-full rounded-full transition-all", TONE_BAR[tone])}
                    style={{ width: `${barPercent}%` }}
                />
                {/* Where the cycle is, so a bar can be read against the clock
                    rather than in isolation — the same marker budgets use. */}
                <div
                    className="absolute inset-y-0 w-px bg-base-900/40 dark:bg-base-50/40"
                    style={{ left: `${pacePercent}%` }}
                    aria-hidden="true"
                />
            </div>

            {tone === "at-risk" && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                    {row.direction === "floor"
                        ? `On pace for ${formatAmount(Number(row.projected_spend))} — short of the minimum.`
                        : `On pace for ${formatAmount(Number(row.projected_spend))} by the end of the cycle.`}
                </p>
            )}
        </div>
    );
}

export function CategorySpendList({
    rows,
    formatAmount,
}: {
    rows: CardCategorySpendRow[];
    formatAmount: (value: number) => string;
}) {
    const total = rows.reduce((sum, row) => sum + Number(row.spent), 0);
    if (rows.length === 0) {
        return (
            <p className="text-sm text-base-500 dark:text-base-400">
                No categories yet. Add one to see where this card's spending goes.
            </p>
        );
    }

    return (
        <ul className="space-y-1.5">
            {rows.map(row => (
                <li key={row.card_category_id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-base-700 dark:text-base-300">{row.name}</span>
                    <span className="shrink-0 tabular-nums text-base-900 dark:text-base-50">
                        {formatAmount(Number(row.spent))}
                    </span>
                </li>
            ))}
            <li className="flex items-center justify-between gap-3 border-t border-base-100 pt-1.5 text-sm font-medium dark:border-base-800">
                <span className="text-base-700 dark:text-base-300">This cycle</span>
                <span className="tabular-nums text-base-900 dark:text-base-50">
                    {formatAmount(total)}
                </span>
            </li>
        </ul>
    );
}

export function LimitRow({
    limitId,
    name,
    amount,
    direction,
    formatAmount,
}: {
    limitId: string;
    name: string;
    amount: string;
    direction: string;
    formatAmount: (value: number) => string;
}) {
    return (
        <li className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate text-base-700 dark:text-base-300">
                {name}
                <span className="ml-2 text-xs text-base-500 dark:text-base-400">
                    {direction === "floor" ? "min" : "cap"} {formatAmount(Number(amount))}
                </span>
            </span>
            <Form method="post" className="shrink-0">
                <input type="hidden" name="_intent" value="deleteLimit" />
                <input type="hidden" name="limitId" value={limitId} />
                <button
                    type="submit"
                    aria-label={`Remove ${name}`}
                    className="rounded p-1 text-base-400 hover:text-red-500"
                >
                    <Trash2 className="h-3.5 w-3.5" />
                </button>
            </Form>
        </li>
    );
}
