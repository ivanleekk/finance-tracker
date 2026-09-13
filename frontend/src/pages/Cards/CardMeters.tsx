import { useState } from "react";
import { Form, useFetcher } from "react-router";
import { Button } from "../../components/ui/Button";
import { Trash2 } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { budgetBarPercent, periodElapsedPercent } from "../../lib/budgets";
import { cardLimitTone, headroomLabel, limitMeasuresNothing, type CardLimitTone } from "../../lib/cards";
import { cn } from "../../lib/utils";
import type { CardCategorySpendRow, CardLimitResponse, CardLimitStatusRow, CardResponse } from "../../types/types";

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
    windowLabel,
    formatAmount,
}: {
    row: CardLimitStatusRow;
    /** The limit's own window when it isn't the card's cycle (`limitWindowLabel`). */
    windowLabel?: string | null;
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
                    {(row.category_names.length > 0 || windowLabel) && (
                        <div className="truncate text-xs text-base-500 dark:text-base-400">
                            {[...row.category_names, windowLabel].filter(Boolean).join(" · ")}
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

            {limitMeasuresNothing(row) && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                    No categories point at this limit yet, so it isn't measuring anything.
                </p>
            )}

            {tone === "at-risk" && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                    {row.direction === "floor"
                        ? `On pace for ${formatAmount(Number(row.projected_spend))} — short of the minimum.`
                        : `On pace for ${formatAmount(Number(row.projected_spend))} by the end of the ${windowLabel ? "period" : "cycle"}.`}
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

/**
 * Which of the card's categories count towards a limit.
 *
 * Plain uncontrolled checkboxes sharing one name, so the form submits the ids
 * with `getAll` and `form.reset()` clears them with the rest of the fields. A
 * category already counting towards another limit is still offered: stacking a
 * monthly minimum and an annual cap on the same spend is the point.
 */
export function LimitCategoryChecklist({
    card,
    checked = [],
}: {
    card: CardResponse;
    checked?: string[];
}) {
    return (
        <fieldset className="col-span-2">
            <legend className="mb-1 text-xs text-base-500 dark:text-base-400">Counts spending in</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
                {card.categories.map(category => (
                    <label
                        key={category.id}
                        className="flex cursor-pointer items-center gap-2 text-sm text-base-700 dark:text-base-300"
                    >
                        <input
                            type="checkbox"
                            name="category_ids"
                            value={category.id}
                            defaultChecked={checked.includes(category.id)}
                            className="h-4 w-4 rounded border-base-300 text-primary-600 focus:ring-primary-500 dark:border-base-700"
                        />
                        {category.name}
                    </label>
                ))}
            </div>
        </fieldset>
    );
}

/**
 * A limit in the Manage dialog: what it is, what counts towards it, and the
 * controls to change the second or remove it.
 *
 * Editing the categories is here rather than on each category because a
 * category can count towards several limits — the limit is the one place where
 * "what counts" has a single answer.
 */
export function LimitRow({
    card,
    limit,
    formatAmount,
}: {
    card: CardResponse;
    limit: CardLimitResponse;
    formatAmount: (value: number) => string;
}) {
    const fetcher = useFetcher<{ error?: string; success?: boolean }>();
    const [editing, setEditing] = useState(false);
    const names = card.categories
        .filter(category => limit.category_ids.includes(category.id))
        .map(category => category.name);

    return (
        <li className="space-y-1 text-sm">
            <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-base-700 dark:text-base-300">
                    {limit.name}
                    <span className="ml-2 text-xs text-base-500 dark:text-base-400">
                        {limit.direction === "floor" ? "min" : "cap"} {formatAmount(Number(limit.amount))}
                    </span>
                </span>
                <div className="flex shrink-0 items-center gap-1">
                    <button
                        type="button"
                        onClick={() => setEditing(open => !open)}
                        className="rounded px-1.5 py-0.5 text-xs text-base-500 hover:text-base-900 dark:hover:text-base-50"
                    >
                        {editing ? "Done" : "Categories"}
                    </button>
                    <Form method="post">
                        <input type="hidden" name="_intent" value="deleteLimit" />
                        <input type="hidden" name="limitId" value={limit.id} />
                        <button
                            type="submit"
                            aria-label={`Remove ${limit.name}`}
                            className="rounded p-1 text-base-400 hover:text-red-500"
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </button>
                    </Form>
                </div>
            </div>
            {editing ? (
                <fetcher.Form method="post" className="grid grid-cols-2 gap-2 rounded-md bg-base-50 p-2 dark:bg-base-800/50">
                    <input type="hidden" name="_intent" value="updateLimitCategories" />
                    <input type="hidden" name="limitId" value={limit.id} />
                    <LimitCategoryChecklist card={card} checked={limit.category_ids} />
                    {fetcher.data?.error && (
                        <p className="col-span-2 text-xs text-red-600 dark:text-red-400">{fetcher.data.error}</p>
                    )}
                    <Button
                        type="submit"
                        variant="secondary"
                        size="sm"
                        className="col-span-2"
                        disabled={fetcher.state !== "idle"}
                    >
                        Save categories
                    </Button>
                </fetcher.Form>
            ) : (
                <p className="truncate text-xs text-base-500 dark:text-base-400">
                    {names.length > 0 ? names.join(" · ") : "No categories — measuring nothing"}
                </p>
            )}
        </li>
    );
}
