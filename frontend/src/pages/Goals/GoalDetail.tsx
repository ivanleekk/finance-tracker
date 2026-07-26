import { useMemo, useState, useEffect } from "react";
import { useLoaderData, Link, useParams, useFetcher } from "react-router";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, ReferenceLine } from "recharts";
import { useHousehold } from "../../lib/HouseholdContext";
import { valueHistoryForGoal, projectGoal, formatDueDate } from "../../lib/goals";
import type { GoalDetailLoaderData } from "./goalDetail.loader";

export { goalDetailLoader as loader, goalDetailAction as action } from "./goalDetail.loader";

export default function GoalDetail() {
    const { activeHousehold } = useHousehold();
    const params = useParams();
    const { goal, timeseries = [], trades = [], accounts = [], members = [] } = (useLoaderData() as GoalDetailLoaderData) || {};
    const editFetcher = useFetcher();

    const [isEditOpen, setIsEditOpen] = useState(false);
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const [editForm, setEditForm] = useState({ name: "", target_amount: "", target_date: "" });

    useEffect(() => {
        if (goal) {
            setEditForm({
                name: goal.name,
                target_amount: goal.target_amount != null ? String(goal.target_amount) : "",
                target_date: goal.target_date || "",
            });
        }
    }, [goal]);

    useEffect(() => {
        if (editFetcher.state === "idle" && editFetcher.data?.success) {
            setIsEditOpen(false);
            setConfirmingDelete(false);
        }
    }, [editFetcher.state, editFetcher.data]);

    const formatCurrency = (v: number) =>
        new Intl.NumberFormat('en-US', { style: 'currency', currency: activeHousehold?.base_currency || 'USD', maximumFractionDigits: 0 }).format(v);

    const history = useMemo(() => valueHistoryForGoal(timeseries, params.id as string), [timeseries, params.id]);
    const proj = useMemo(
        () => projectGoal(history, goal?.target_amount ?? null, goal?.target_date ?? null),
        [history, goal?.target_amount, goal?.target_date]
    );

    const accountMap = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts]);

    const fundedFrom = useMemo(() => {
        const byAccount = new Map<string, number>();
        trades.forEach(t => {
            const amt = Number(t.quantity) * Number(t.price) * Number(t.exchange_rate) * (t.type === "sell" ? -1 : 1);
            byAccount.set(t.account_id, (byAccount.get(t.account_id) || 0) + amt);
        });
        return Array.from(byAccount.entries())
            .map(([accountId, total]) => ({ accountId, name: accountMap.get(accountId)?.name || "Unknown account", total }))
            .filter(f => f.total > 0)
            .sort((a, b) => b.total - a.total);
    }, [trades, accountMap]);

    const contributionsByMember = useMemo(() => {
        const byOwner = new Map<string, number>();
        trades.forEach(t => {
            const account = accountMap.get(t.account_id);
            const ownerKey = account?.owner_user_id || "shared";
            const amt = Number(t.quantity) * Number(t.price) * Number(t.exchange_rate) * (t.type === "sell" ? -1 : 1);
            byOwner.set(ownerKey, (byOwner.get(ownerKey) || 0) + amt);
        });
        const memberMap = new Map(members.map(m => [m.user_id, m.name]));
        const items = Array.from(byOwner.entries())
            .map(([ownerKey, total]) => ({
                key: ownerKey,
                name: ownerKey === "shared" ? "Shared accounts" : (memberMap.get(ownerKey) || "Member"),
                total,
            }))
            .filter(i => i.total > 0)
            .sort((a, b) => b.total - a.total);
        const max = Math.max(1, ...items.map(i => i.total));
        return { items, max };
    }, [trades, accountMap, members]);

    const recentContributions = useMemo(() => {
        return [...trades]
            .sort((a, b) => (a.date < b.date ? 1 : -1))
            .slice(0, 8)
            .map(t => ({
                id: t.id,
                date: t.date,
                accountName: accountMap.get(t.account_id)?.name || "Unknown account",
                amount: Number(t.quantity) * Number(t.price) * Number(t.exchange_rate) * (t.type === "sell" ? -1 : 1),
                type: t.type,
            }));
    }, [trades, accountMap]);

    const chartData = history.map(h => ({ date: h.date, value: h.value }));

    if (!activeHousehold) {
        return (
            <div className="flex-1 flex items-center justify-center p-8 text-base-500">
                Please select or create a household.
            </div>
        )
    }

    if (!goal) {
        return (
            <div className="flex-1 flex items-center justify-center p-8 text-base-500">
                Goal not found.
            </div>
        )
    }

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            <div className="h-16 flex-none border-b border-base-200 dark:border-base-800 flex items-center px-6 gap-3">
                <Link to="/goals" className="text-base-400 hover:text-base-600 dark:hover:text-base-300">‹</Link>
                <div className="font-display text-lg font-extrabold tracking-tight text-base-900 dark:text-base-50">
                    <Link to="/goals" className="text-base-400 hover:text-base-600 dark:hover:text-base-300 font-medium">Goals</Link>
                    <span className="text-base-300 dark:text-base-700 mx-1.5">/</span>
                    {goal.name}
                </div>
                <div className="ml-auto flex items-center gap-2">
                    <Button variant="ghost" onClick={() => { setConfirmingDelete(false); setIsEditOpen(true); }}>Edit</Button>
                    <Link to={`/trade?sub_portfolio_id=${goal.id}`}>
                        <Button variant="cta">+ Add funds</Button>
                    </Link>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-6">
                <div className="grid gap-4 lg:grid-cols-2">
                    <Card className="bg-gradient-to-br from-secondary-50 to-white dark:from-secondary-950/40 dark:to-base-900 border-secondary-100 dark:border-secondary-900">
                        <CardContent className="pt-6 flex flex-col items-center text-center">
                            <div
                                className="relative w-36 h-36 rounded-full flex items-center justify-center mb-4"
                                style={{ background: `conic-gradient(var(--color-secondary-500) ${proj.percentComplete * 3.6}deg, var(--color-secondary-100) 0deg)` }}
                            >
                                <div className="absolute inset-2.5 rounded-full bg-white dark:bg-base-900 flex flex-col items-center justify-center">
                                    <span className="font-mono font-bold text-2xl text-secondary-600 dark:text-secondary-400">{Math.round(proj.percentComplete)}%</span>
                                    <span className="text-[10px] uppercase tracking-wider text-base-500">funded</span>
                                </div>
                            </div>
                            <div className="font-mono font-bold text-2xl text-base-900 dark:text-base-50">{formatCurrency(proj.currentValue)}</div>
                            <div className="text-sm text-base-500 dark:text-base-400 mb-4">of {goal.target_amount ? formatCurrency(Number(goal.target_amount)) : "no target set"}</div>
                            <div className="grid grid-cols-3 gap-4 w-full pt-4 border-t border-base-200/60 dark:border-base-800">
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-base-500 font-mono">Remaining</div>
                                    <div className="font-semibold text-base-900 dark:text-base-50">{formatCurrency(proj.remaining)}</div>
                                </div>
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-secondary-500 font-mono">Per month</div>
                                    <div className="font-semibold text-secondary-600 dark:text-secondary-400">{proj.monthlyPace > 0 ? formatCurrency(proj.monthlyPace) : "—"}</div>
                                </div>
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-emerald-500 font-mono">ETA</div>
                                    <div className="font-semibold text-emerald-600 dark:text-emerald-400">{proj.etaLabel || "—"}</div>
                                </div>
                            </div>
                            {goal.target_date && (
                                <div className="grid grid-cols-3 gap-4 w-full pt-4 mt-4 border-t border-base-200/60 dark:border-base-800">
                                    <div>
                                        <div className="text-[10px] uppercase tracking-wider text-base-500 font-mono">Due</div>
                                        <div className="font-semibold text-base-900 dark:text-base-50">{formatDueDate(goal.target_date)}</div>
                                    </div>
                                    <div>
                                        <div className="text-[10px] uppercase tracking-wider text-secondary-500 font-mono">Needed / mo</div>
                                        <div className="font-semibold text-secondary-600 dark:text-secondary-400">
                                            {proj.requiredPace != null && proj.requiredPace > 0 ? formatCurrency(proj.requiredPace) : "—"}
                                        </div>
                                    </div>
                                    <div>
                                        <div className={`text-[10px] uppercase tracking-wider font-mono ${proj.shortfallAtTarget ? "text-amber-500" : "text-emerald-500"}`}>
                                            {proj.shortfallAtTarget ? "Shortfall" : "On target"}
                                        </div>
                                        <div className={`font-semibold ${proj.shortfallAtTarget ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                                            {proj.shortfallAtTarget != null ? (proj.shortfallAtTarget > 0 ? formatCurrency(proj.shortfallAtTarget) : "✓") : "—"}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0">
                            <CardTitle>Projected completion</CardTitle>
                            {proj.onTrack !== null && (
                                <Badge variant={proj.onTrack ? "success" : "warning"}>{proj.onTrack ? "ON TRACK" : "BEHIND PACE"}</Badge>
                            )}
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm text-base-600 dark:text-base-300 mb-4">
                                {proj.monthlyPace > 0 && proj.etaLabel
                                    ? `At ${formatCurrency(proj.monthlyPace)}/mo you reach ${goal.target_amount ? formatCurrency(Number(goal.target_amount)) : "your target"} by ${proj.etaLabel}.`
                                    : "Not enough contribution history yet to project a completion date."}
                                {proj.etaVsTargetMonths != null && goal.target_date && (
                                    proj.etaVsTargetMonths > 0
                                        ? ` That's ~${proj.etaVsTargetMonths} month${proj.etaVsTargetMonths === 1 ? "" : "s"} past your ${formatDueDate(goal.target_date)} target${proj.requiredPace ? ` — you'd need ${formatCurrency(proj.requiredPace)}/mo to land on time` : ""}.`
                                        : proj.etaVsTargetMonths < 0
                                            ? ` That's ~${-proj.etaVsTargetMonths} month${proj.etaVsTargetMonths === -1 ? "" : "s"} ahead of your ${formatDueDate(goal.target_date)} target.`
                                            : ` That lands right on your ${formatDueDate(goal.target_date)} target.`
                                )}
                            </p>
                            <div className="h-[160px] w-full">
                                <ResponsiveContainer width="100%" height="100%" minHeight={160}>
                                    <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="goalFill" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="var(--color-secondary-500)" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="var(--color-secondary-500)" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-base-200)" className="dark:opacity-10" />
                                        <XAxis dataKey="date" hide />
                                        <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--color-base-400)', fontSize: 11 }} tickFormatter={(v) => `$${v / 1000}k`} />
                                        {goal.target_amount && (
                                            <ReferenceLine y={Number(goal.target_amount)} stroke="var(--color-secondary-400)" strokeDasharray="4 4" label={{ value: "target", fontSize: 10, fill: 'var(--color-secondary-500)' }} />
                                        )}
                                        <Tooltip formatter={(v) => formatCurrency(Number(v))} contentStyle={{ background: 'var(--color-base-50)', border: '1px solid var(--color-base-200)', borderRadius: 8 }} />
                                        <Area type="monotone" dataKey="value" stroke="var(--color-secondary-500)" strokeWidth={2} fill="url(#goalFill)" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                    <Card>
                        <CardHeader>
                            <CardTitle>Funded from</CardTitle>
                            <CardDescription>Accounts that have contributed to this goal via trades.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {fundedFrom.length === 0 && <div className="text-center py-6 text-base-500 italic">No funding activity yet.</div>}
                            {fundedFrom.map(f => (
                                <div key={f.accountId} className="flex items-center justify-between py-2 border-b border-base-100 dark:border-base-800 last:border-0">
                                    <span className="text-sm font-medium text-base-900 dark:text-base-50">{f.name}</span>
                                    <span className="font-mono text-sm text-base-700 dark:text-base-300">{formatCurrency(f.total)}</span>
                                </div>
                            ))}
                            {members.length > 1 && contributionsByMember.items.length > 0 && (
                                <div className="pt-3 mt-1 border-t border-base-100 dark:border-base-800 space-y-3">
                                    <div className="text-sm font-semibold text-base-900 dark:text-base-50">Contributions by member</div>
                                    {contributionsByMember.items.map((m, i) => (
                                        <div key={m.key} className="flex items-center gap-3">
                                            <div
                                                className="w-6 h-6 rounded-full shrink-0 bg-gradient-to-br"
                                                style={{ backgroundImage: `linear-gradient(135deg, ${i % 2 === 0 ? 'var(--color-primary-400), var(--color-primary-600)' : 'var(--color-secondary-400), var(--color-secondary-600)'})` }}
                                            />
                                            <span className="flex-1 text-sm text-base-700 dark:text-base-300 truncate">{m.name}</span>
                                            <div className="w-24 h-1.5 rounded-full bg-base-100 dark:bg-base-800 overflow-hidden">
                                                <div
                                                    className={i % 2 === 0 ? "h-full bg-primary-500" : "h-full bg-secondary-500"}
                                                    style={{ width: `${(m.total / contributionsByMember.max) * 100}%` }}
                                                />
                                            </div>
                                            <span className="font-mono text-xs text-base-500 w-16 text-right">{formatCurrency(m.total)}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Recent contributions</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-1">
                            {recentContributions.length === 0 && <div className="text-center py-6 text-base-500 italic">No contributions yet.</div>}
                            {recentContributions.map(c => (
                                <div key={c.id} className="flex items-center justify-between py-2 border-b border-base-100 dark:border-base-800 last:border-0">
                                    <div>
                                        <div className="text-sm font-medium text-base-900 dark:text-base-50">{c.accountName}</div>
                                        <div className="text-xs text-base-500 dark:text-base-400">{new Date(c.date).toLocaleDateString('default', { month: 'short', day: 'numeric', year: 'numeric' })} · {c.type}</div>
                                    </div>
                                    <span className={`font-mono text-sm font-semibold ${c.amount >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                                        {c.amount >= 0 ? '+' : ''}{formatCurrency(c.amount)}
                                    </span>
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                </div>
            </div>

            {isEditOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <Card className="w-full max-w-md bg-white dark:bg-base-900 shadow-xl border-base-200 dark:border-base-800">
                        <CardHeader>
                            <CardTitle>Edit Goal</CardTitle>
                            <CardDescription>Change the name, target amount, or target date.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <editFetcher.Form method="post" className="space-y-4">
                                <input type="hidden" name="_intent" value="updateGoal" />
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-base-900 dark:text-base-50">Goal Name</label>
                                    <Input name="name" value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} required />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-base-900 dark:text-base-50">Target Amount</label>
                                        <Input name="target_amount" type="number" step="0.01" value={editForm.target_amount} onChange={e => setEditForm({ ...editForm, target_amount: e.target.value })} />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-base-900 dark:text-base-50">Target Date</label>
                                        <Input name="target_date" type="date" value={editForm.target_date} onChange={e => setEditForm({ ...editForm, target_date: e.target.value })} />
                                    </div>
                                </div>
                                {editFetcher.data?.error && (
                                    <p className="text-sm text-red-600 dark:text-red-400">{editFetcher.data.error}</p>
                                )}
                                <div className="flex items-center gap-3 pt-2">
                                    <Button
                                        variant="ghost"
                                        type="button"
                                        className="text-red-600 dark:text-red-400"
                                        onClick={() => {
                                            if (!confirmingDelete) { setConfirmingDelete(true); return; }
                                            editFetcher.submit({ _intent: "deleteGoal" }, { method: "post" });
                                        }}
                                        disabled={editFetcher.state !== "idle"}
                                    >
                                        {confirmingDelete ? "Confirm delete?" : "Delete goal"}
                                    </Button>
                                    <div className="flex gap-3 ml-auto">
                                        <Button variant="ghost" type="button" onClick={() => { setIsEditOpen(false); setConfirmingDelete(false); }}>Cancel</Button>
                                        <Button variant="primary" type="submit" disabled={editFetcher.state !== "idle"}>
                                            {editFetcher.state !== "idle" ? "Saving..." : "Save changes"}
                                        </Button>
                                    </div>
                                </div>
                            </editFetcher.Form>
                        </CardContent>
                    </Card>
                </div>
            )}
        </div>
    )
}
