import { useMemo } from "react";
import { useLoaderData, Link, useParams } from "react-router";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, ReferenceLine } from "recharts";
import { useHousehold } from "../../lib/HouseholdContext";
import { valueHistoryForGoal, projectGoal } from "../../lib/goals";
import type { GoalDetailLoaderData } from "./goalDetail.loader";

export { goalDetailLoader as loader } from "./goalDetail.loader";

export default function GoalDetail() {
    const { activeHousehold } = useHousehold();
    const params = useParams();
    const { goal, snapshots = [], trades = [], accounts = [] } = (useLoaderData() as GoalDetailLoaderData) || {};

    const formatCurrency = (v: number) =>
        new Intl.NumberFormat('en-US', { style: 'currency', currency: activeHousehold?.base_currency || 'USD', maximumFractionDigits: 0 }).format(v);

    const history = useMemo(() => valueHistoryForGoal(snapshots, params.id as string), [snapshots, params.id]);
    const proj = useMemo(() => projectGoal(history, goal?.target_amount ?? null), [history, goal?.target_amount]);

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
                <div className="ml-auto">
                    <Link to={`/trade?sub_portfolio_id=${goal.id}`}>
                        <Button variant="cta">+ Add funds</Button>
                    </Link>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-6">
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
        </div>
    )
}
