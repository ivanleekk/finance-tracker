import { useMemo, useState, useEffect } from "react";
import { useLoaderData, useFetcher, Link } from "react-router";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { OwnershipTag } from "../../components/ui/OwnershipTag";
import { TopBar } from "../../components/TopBar";
import { useHousehold } from "../../lib/HouseholdContext";
import { useAuth } from "../../lib/AuthContext";
import { useViewMode, isVisibleInViewMode } from "../../lib/ViewModeContext";
import { valueHistoryForGoal, projectGoal, formatDueDate } from "../../lib/goals";
import type { GoalsLoaderData } from "./goals.loader";

export { goalsLoader as loader, goalsAction as action } from "./goals.loader";

export default function Goals() {
    const { activeHousehold } = useHousehold();
    const { user } = useAuth();
    const { viewMode, hasHousehold } = useViewMode();
    const { subportfolios: allGoals = [], timeseries = [] } = (useLoaderData() as GoalsLoaderData) || {};
    const createFetcher = useFetcher();

    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [form, setForm] = useState({ name: "", target_amount: "", target_date: "", isPrivate: user?.default_new_items_private ?? true });

    useEffect(() => {
        if (createFetcher.state === "idle" && createFetcher.data?.success) {
            setIsCreateOpen(false);
            setForm({ name: "", target_amount: "", target_date: "", isPrivate: user?.default_new_items_private ?? true });
        }
    }, [createFetcher.state, createFetcher.data]);

    const goals = useMemo(
        () => allGoals.filter(g => isVisibleInViewMode(g.owner_user_id, viewMode, user?.id)),
        [allGoals, viewMode, user?.id]
    );

    const formatCurrency = (v: number) =>
        new Intl.NumberFormat('en-US', { style: 'currency', currency: activeHousehold?.base_currency || 'USD', maximumFractionDigits: 0 }).format(v);

    if (!activeHousehold) {
        return (
            <div className="flex-1 flex items-center justify-center p-8 text-base-500">
                Please select or create a household.
            </div>
        )
    }

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            <TopBar
                title="Goals"
                commandPlaceholder="Log or find…"
                cta={<Button variant="cta" onClick={() => setIsCreateOpen(true)}>+ Add goal</Button>}
            />
            <div className="flex-1 overflow-y-auto p-8">
                <p className="text-base-500 dark:text-base-400 -mt-2 mb-6">Track progress toward each milestone, funded automatically or with one-off contributions.</p>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {goals.map(g => {
                        const history = valueHistoryForGoal(timeseries, g.id);
                        const proj = projectGoal(history, g.target_amount, g.target_date);
                        const pct = Math.round(proj.percentComplete);
                        return (
                            <Link key={g.id} to={`/goals/${g.id}`}>
                                <Card className="hover:border-secondary-300 dark:hover:border-secondary-700 transition-colors cursor-pointer h-full">
                                    <CardHeader className="pb-2">
                                        <div className="flex items-center justify-between">
                                            <CardTitle className="text-base">{g.name}</CardTitle>
                                            <div className="flex items-center gap-1.5">
                                                <OwnershipTag ownerUserId={g.owner_user_id} show={hasHousehold && viewMode === "blended"} className="text-[9px] px-1.5 py-0 h-4" />
                                                {proj.onTrack === false && (
                                                    <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400">Behind</span>
                                                )}
                                                <span className="text-xs font-semibold text-secondary-600 dark:text-secondary-400">{pct}%</span>
                                            </div>
                                        </div>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="mb-2 flex items-baseline justify-between text-sm">
                                            <span className="font-bold text-base-900 dark:text-base-50">{formatCurrency(proj.currentValue)}</span>
                                            <span className="text-base-500 dark:text-base-400">of {g.target_amount ? formatCurrency(Number(g.target_amount)) : "—"}</span>
                                        </div>
                                        <div className="h-2 w-full overflow-hidden rounded-full bg-base-100 dark:bg-base-800">
                                            <div className="h-full bg-secondary-500 transition-all duration-500 ease-in-out" style={{ width: `${pct}%` }} />
                                        </div>
                                        {(proj.etaLabel || g.target_date) && (
                                            <div className="mt-2 flex items-center justify-between text-xs text-base-500 dark:text-base-400">
                                                <span>{proj.etaLabel ? `ETA ${proj.etaLabel}` : ""}</span>
                                                {g.target_date && <span>Due {formatDueDate(g.target_date)}</span>}
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            </Link>
                        );
                    })}
                    {goals.length === 0 && (
                        <div className="col-span-full text-center py-12 text-base-500 italic">No goals yet. Create one to start tracking progress.</div>
                    )}
                </div>
            </div>

            {isCreateOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <Card className="w-full max-w-md bg-white dark:bg-base-900 shadow-xl border-base-200 dark:border-base-800">
                        <CardHeader>
                            <CardTitle>New Goal</CardTitle>
                            <CardDescription>Give it a name and a target — you can fund it from any account.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <createFetcher.Form method="post" className="space-y-4">
                                <input type="hidden" name="_intent" value="createGoal" />
                                <input type="hidden" name="current_user_id" value={user?.id ?? ""} />
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-base-900 dark:text-base-50">Goal Name</label>
                                    <Input name="name" placeholder="e.g. House downpayment" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-base-900 dark:text-base-50">Target Amount</label>
                                        <Input name="target_amount" type="number" step="0.01" placeholder="300000" value={form.target_amount} onChange={e => setForm({ ...form, target_amount: e.target.value })} />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-base-900 dark:text-base-50">Target Date</label>
                                        <Input name="target_date" type="date" value={form.target_date} onChange={e => setForm({ ...form, target_date: e.target.value })} />
                                    </div>
                                </div>
                                {hasHousehold && (
                                    <label className="flex items-center gap-2.5 rounded-lg border border-base-200 dark:border-base-800 px-3 py-2.5 cursor-pointer">
                                        <input type="checkbox" name="is_private" checked={form.isPrivate} onChange={e => setForm({ ...form, isPrivate: e.target.checked })} className="accent-secondary-500" />
                                        <span className="text-sm text-base-700 dark:text-base-300">🔒 Private — only visible to you</span>
                                    </label>
                                )}
                                <div className="flex gap-3 justify-end pt-2">
                                    <Button variant="ghost" type="button" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
                                    <Button variant="primary" type="submit" disabled={createFetcher.state !== "idle"}>
                                        {createFetcher.state !== "idle" ? "Creating..." : "Create Goal"}
                                    </Button>
                                </div>
                            </createFetcher.Form>
                        </CardContent>
                    </Card>
                </div>
            )}
        </div>
    )
}
