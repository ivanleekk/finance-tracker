import { useState, useMemo, useEffect } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { StatCard } from "../../components/ui/StatCard";
import { TopBar } from "../../components/TopBar";
import { useHousehold } from "../../lib/HouseholdContext";
import { BudgetPeriod, TransactionType } from "../../types/types";
import {
    budgetTone,
    budgetBarPercent,
    periodElapsedPercent,
    runwayLabel,
    runwayTone,
} from "../../lib/budgets";
import type { BudgetsLoaderData } from "./budgets.loader";

export { loader, action } from "./budgets.loader";

const TONE_STYLES: Record<string, { bar: string; text: string; note: string }> = {
    over: {
        bar: "bg-red-500",
        text: "text-red-600 dark:text-red-400",
        note: "Over budget",
    },
    "at-risk": {
        bar: "bg-amber-500",
        text: "text-amber-600 dark:text-amber-400",
        note: "On pace to overspend",
    },
    ok: {
        bar: "bg-emerald-500",
        text: "text-emerald-600 dark:text-emerald-400",
        note: "On track",
    },
};

const RUNWAY_STYLES: Record<string, string> = {
    critical: "text-red-600 dark:text-red-400",
    low: "text-amber-600 dark:text-amber-400",
    ok: "text-emerald-600 dark:text-emerald-400",
    unknown: "text-base-500 dark:text-base-400",
};

export default function Budgets() {
    const { activeHousehold } = useHousehold();
    const { status = null, emergencyFund = null, categories = [] } =
        (useLoaderData() as BudgetsLoaderData) || {};

    const createFetcher = useFetcher();
    const updateFetcher = useFetcher();
    const deleteFetcher = useFetcher();
    const targetFetcher = useFetcher();

    const [isAddOpen, setIsAddOpen] = useState(false);
    const [newBudget, setNewBudget] = useState({ category_id: "", amount: "", period: BudgetPeriod.Monthly as string });
    const [editingId, setEditingId] = useState<string | null>(null);

    useEffect(() => {
        if (createFetcher.state === "idle" && createFetcher.data?.success) {
            setIsAddOpen(false);
            setNewBudget({ category_id: "", amount: "", period: BudgetPeriod.Monthly });
        }
    }, [createFetcher.state, createFetcher.data]);

    useEffect(() => {
        if (updateFetcher.state === "idle" && updateFetcher.data?.success) {
            setEditingId(null);
        }
    }, [updateFetcher.state, updateFetcher.data]);

    const currency = status?.base_currency || activeHousehold?.base_currency || "USD";

    const formatCurrency = (value: number, fractionDigits = 0) =>
        new Intl.NumberFormat("en-US", {
            style: "currency",
            currency,
            minimumFractionDigits: fractionDigits,
            maximumFractionDigits: fractionDigits,
        }).format(value);

    // Only expense categories can carry a budget, and a category that already
    // has one shouldn't be offered again.
    const budgetableCategories = useMemo(() => {
        const taken = new Set((status?.budgets ?? []).map(b => b.category_id));
        return categories.filter(c => c.type === TransactionType.Expense && !taken.has(c.id));
    }, [categories, status]);

    const rows = status?.budgets ?? [];
    const totalLimit = Number(status?.total_limit ?? 0);
    const totalSpent = Number(status?.total_spent ?? 0);

    if (!activeHousehold) {
        return (
            <div className="flex-1 flex items-center justify-center p-8 text-base-500">
                Please select or create a household.
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            <TopBar
                title="Budgets"
                commandPlaceholder="Log or find…"
                cta={
                    <Button
                        variant="cta"
                        onClick={() => setIsAddOpen(true)}
                        disabled={budgetableCategories.length === 0}
                    >
                        + Set a budget
                    </Button>
                }
            />
            <div className="flex-1 overflow-y-auto space-y-6 p-8">
                <p className="text-base-500 dark:text-base-400 -mt-2">
                    Spending limits per category, and how long your cash would last without income.
                </p>

                {/* Emergency fund runway */}
                {emergencyFund && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Emergency fund</CardTitle>
                            <CardDescription>
                                How long your liquid cash covers your recent spending. Only cash
                                accounts count — a fund you have to sell something to reach isn't an
                                emergency fund. Share purchases, transfers and balance corrections
                                are left out of the burn rate: you'd stop investing, not starve.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-base-500">Runway</div>
                                    <div className={`font-display text-2xl font-bold ${RUNWAY_STYLES[runwayTone(emergencyFund)]}`}>
                                        {runwayLabel(emergencyFund)}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-base-500">Liquid cash</div>
                                    <div className="font-mono font-semibold text-base-900 dark:text-base-50 mt-1.5">
                                        {formatCurrency(Number(emergencyFund.liquid_total))}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-base-500">Monthly spend</div>
                                    <div className="font-mono font-semibold text-base-900 dark:text-base-50 mt-1.5">
                                        {formatCurrency(Number(emergencyFund.average_monthly_expenses))}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-base-500">
                                        {Number(emergencyFund.shortfall) > 0 ? "Still to save" : "Target"}
                                    </div>
                                    <div className="font-mono font-semibold text-base-900 dark:text-base-50 mt-1.5">
                                        {Number(emergencyFund.shortfall) > 0
                                            ? formatCurrency(Number(emergencyFund.shortfall))
                                            : formatCurrency(Number(emergencyFund.target_amount))}
                                    </div>
                                </div>
                            </div>

                            {emergencyFund.months_covered !== null && emergencyFund.months_covered !== undefined && (
                                <div>
                                    <div className="h-2.5 w-full rounded-full bg-base-200 dark:bg-base-800 overflow-hidden">
                                        <div
                                            className={`h-full rounded-full ${emergencyFund.on_track ? "bg-emerald-500" : "bg-amber-500"}`}
                                            style={{
                                                width: `${Math.max(0, Math.min(100, (Number(emergencyFund.months_covered) / Number(emergencyFund.target_months || 1)) * 100))}%`,
                                            }}
                                        />
                                    </div>
                                    <div className="mt-1.5 text-xs text-base-500 dark:text-base-400">
                                        {runwayLabel(emergencyFund)} of a {Number(emergencyFund.target_months)}-month target
                                    </div>
                                </div>
                            )}

                            {emergencyFund.months_covered === null && (
                                <p className="text-sm text-base-500 dark:text-base-400">
                                    No expenses recorded in the last 6 months, so there's no burn rate
                                    to measure against. Log some spending and this will fill in.
                                </p>
                            )}

                            <targetFetcher.Form method="post" className="flex flex-wrap items-end gap-3 pt-2 border-t border-base-100 dark:border-base-800">
                                <input type="hidden" name="_intent" value="setEmergencyTarget" />
                                <div className="space-y-1.5">
                                    <label className="text-xs font-medium text-base-700 dark:text-base-300">
                                        Target months of expenses
                                    </label>
                                    <Input
                                        name="target_months"
                                        type="number"
                                        step="1"
                                        min="0"
                                        max="120"
                                        defaultValue={String(Number(emergencyFund.target_months))}
                                        className="w-28"
                                    />
                                </div>
                                <Button variant="ghost" type="submit" disabled={targetFetcher.state !== "idle"}>
                                    {targetFetcher.state !== "idle" ? "Saving…" : "Update target"}
                                </Button>
                            </targetFetcher.Form>
                        </CardContent>
                    </Card>
                )}

                {/* Budget totals */}
                {rows.length > 0 && (
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <StatCard title="Budgeted" value={formatCurrency(totalLimit)} />
                        <StatCard title="Spent" value={formatCurrency(totalSpent)} />
                        <StatCard
                            title="Left"
                            value={formatCurrency(totalLimit - totalSpent)}
                            description={totalLimit > 0 ? `${((totalSpent / totalLimit) * 100).toFixed(0)}% used` : undefined}
                        />
                        <StatCard
                            title="Over pace"
                            value={String(rows.filter(r => budgetTone(r) !== "ok").length)}
                            description={`of ${rows.length} budget${rows.length === 1 ? "" : "s"}`}
                        />
                    </div>
                )}

                {/* Budget list */}
                <div className="space-y-3">
                    {rows.map(row => {
                        const tone = budgetTone(row);
                        const styles = TONE_STYLES[tone];
                        const spent = Number(row.spent);
                        const limit = Number(row.limit);
                        return (
                            <Card key={row.budget_id}>
                                <CardContent className="p-4 space-y-2.5">
                                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium text-base-900 dark:text-base-50">{row.category_name}</span>
                                            <span className="text-[10px] font-mono uppercase tracking-wide text-base-400">
                                                {row.period}
                                            </span>
                                            {row.is_private && (
                                                <span className="text-[10px] font-mono uppercase tracking-wide text-secondary-500">🔒 private</span>
                                            )}
                                        </div>
                                        <div className="font-mono text-sm">
                                            <span className={styles.text}>{formatCurrency(spent)}</span>
                                            <span className="text-base-400"> / {formatCurrency(limit)}</span>
                                        </div>
                                    </div>

                                    {/* Bar plus a pace marker: how far through the period we are. */}
                                    <div className="relative h-2.5 w-full rounded-full bg-base-200 dark:bg-base-800 overflow-hidden">
                                        <div
                                            className={`h-full rounded-full ${styles.bar}`}
                                            style={{ width: `${budgetBarPercent(row)}%` }}
                                        />
                                        <div
                                            className="absolute top-0 bottom-0 w-px bg-base-900/50 dark:bg-base-50/50"
                                            style={{ left: `${periodElapsedPercent(row)}%` }}
                                            title="Where you should be by today"
                                        />
                                    </div>

                                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                        <span className={styles.text}>
                                            {styles.note}
                                            {tone !== "over" && (
                                                <span className="text-base-500 dark:text-base-400">
                                                    {" "}· {formatCurrency(Number(row.remaining))} left · projected {formatCurrency(Number(row.projected_spend))}
                                                </span>
                                            )}
                                            {tone === "over" && (
                                                <span className="text-base-500 dark:text-base-400">
                                                    {" "}by {formatCurrency(Math.abs(Number(row.remaining)))}
                                                </span>
                                            )}
                                        </span>
                                        <div className="flex items-center gap-1">
                                            {editingId === row.budget_id ? (
                                                <updateFetcher.Form method="post" className="flex items-center gap-1">
                                                    <input type="hidden" name="_intent" value="updateBudget" />
                                                    <input type="hidden" name="budgetId" value={row.budget_id} />
                                                    <Input
                                                        name="amount"
                                                        type="number"
                                                        step="0.01"
                                                        min="0.01"
                                                        defaultValue={String(limit)}
                                                        className="w-28 h-8"
                                                    />
                                                    <Button variant="ghost" size="sm" type="submit">Save</Button>
                                                    <Button variant="ghost" size="sm" type="button" onClick={() => setEditingId(null)}>Cancel</Button>
                                                </updateFetcher.Form>
                                            ) : (
                                                <>
                                                    <Button variant="ghost" size="sm" onClick={() => setEditingId(row.budget_id)}>Edit</Button>
                                                    <deleteFetcher.Form method="post" className="inline">
                                                        <input type="hidden" name="_intent" value="deleteBudget" />
                                                        <input type="hidden" name="budgetId" value={row.budget_id} />
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="text-red-600 hover:text-red-700"
                                                            type="submit"
                                                        >
                                                            Delete
                                                        </Button>
                                                    </deleteFetcher.Form>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })}

                    {rows.length === 0 && (
                        <Card>
                            <CardContent className="py-10 text-center space-y-2">
                                <p className="text-base-500 dark:text-base-400">No budgets set yet.</p>
                                <p className="text-sm text-base-400 dark:text-base-500">
                                    Pick an expense category and give it a monthly limit — we'll track
                                    spend against it and warn you when your pace would blow it.
                                </p>
                            </CardContent>
                        </Card>
                    )}
                </div>

                {/* Add budget modal */}
                {isAddOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                        <Card className="w-full max-w-md bg-white dark:bg-base-900 shadow-xl border-base-200 dark:border-base-800">
                            <CardHeader>
                                <CardTitle>Set a budget</CardTitle>
                                <CardDescription>A spending limit for one expense category.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <createFetcher.Form method="post" className="space-y-4">
                                    <input type="hidden" name="_intent" value="createBudget" />
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-base-900 dark:text-base-50">Category</label>
                                        <Select
                                            name="category_id"
                                            value={newBudget.category_id}
                                            onChange={(category_id) => setNewBudget({ ...newBudget, category_id })}
                                            options={[
                                                { value: "", label: "Choose a category…" },
                                                ...budgetableCategories.map(c => ({ value: c.id, label: c.name })),
                                            ]}
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium text-base-900 dark:text-base-50">Limit ({currency})</label>
                                            <Input
                                                name="amount"
                                                type="number"
                                                step="0.01"
                                                min="0.01"
                                                placeholder="600"
                                                value={newBudget.amount}
                                                onChange={(e) => setNewBudget({ ...newBudget, amount: e.target.value })}
                                                required
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium text-base-900 dark:text-base-50">Period</label>
                                            <Select
                                                name="period"
                                                value={newBudget.period}
                                                onChange={(period) => setNewBudget({ ...newBudget, period })}
                                                options={[
                                                    { value: BudgetPeriod.Monthly, label: "Monthly" },
                                                    { value: BudgetPeriod.Yearly, label: "Yearly" },
                                                ]}
                                            />
                                        </div>
                                    </div>

                                    {createFetcher.data?.error && (
                                        <p className="text-sm text-red-600 dark:text-red-400">{createFetcher.data.error}</p>
                                    )}

                                    <div className="flex gap-3 justify-end pt-4">
                                        <Button variant="ghost" type="button" onClick={() => setIsAddOpen(false)}>Cancel</Button>
                                        <Button
                                            variant="primary"
                                            type="submit"
                                            disabled={createFetcher.state !== "idle" || !newBudget.category_id}
                                        >
                                            {createFetcher.state !== "idle" ? "Saving…" : "Set budget"}
                                        </Button>
                                    </div>
                                </createFetcher.Form>
                            </CardContent>
                        </Card>
                    </div>
                )}
            </div>
        </div>
    );
}
