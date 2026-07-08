import { useMemo } from "react";
import { useLoaderData } from "react-router";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../components/ui/Card";
import { StatCard } from "../../components/ui/StatCard";
import { TopBar } from "../../components/TopBar";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { useHousehold } from "../../lib/HouseholdContext";
import { summarizeDividends } from "../../lib/dividends";
import type { DividendsLoaderData } from "./dividends.loader";

export { dividendsLoader as loader } from "./dividends.loader";

const MONTH_LABELS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

export default function Dividends() {
    const { activeHousehold } = useHousehold();
    const { dividends = [], assets = [], snapshots = [] } = (useLoaderData() as DividendsLoaderData) || {};

    const formatCurrency = (value: number) =>
        new Intl.NumberFormat('en-US', { style: 'currency', currency: activeHousehold?.base_currency || 'USD', maximumFractionDigits: 0 }).format(value);

    const summary = useMemo(() => summarizeDividends(dividends, assets, snapshots), [dividends, assets, snapshots]);

    const chartData = useMemo(() => summary.calendar.map(m => ({
        month: MONTH_LABELS[m.month],
        received: m.received,
        projected: m.projected,
    })), [summary.calendar]);

    if (!activeHousehold) {
        return (
            <div className="flex-1 flex items-center justify-center p-8 text-base-500">
                Please select or create a household.
            </div>
        )
    }

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            <TopBar title="Dividends" commandPlaceholder="div AAPL 48…" />
            <div className="flex-1 overflow-y-auto space-y-6 p-8">
                <p className="text-base-500 dark:text-base-400 -mt-2">
                    Received and upcoming dividends, annual income, and yield on cost across your holdings.
                </p>

                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    <StatCard title={`Received ${new Date().getFullYear()}`} value={formatCurrency(summary.receivedThisYear)} trend="up" />
                    <StatCard title="Forward / yr" value={formatCurrency(summary.forwardAnnual)} trend="neutral" />
                    <StatCard title="Yield on cost" value={`${(summary.yieldOnCost * 100).toFixed(1)}%`} trend="neutral" />
                    <StatCard title="This month" value={formatCurrency(summary.thisMonth)} trend="neutral" />
                </div>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0">
                        <div>
                            <CardTitle>Income by month · {new Date().getFullYear()}</CardTitle>
                            <CardDescription>Received vs. projected dividend income.</CardDescription>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-base-500 dark:text-base-400">
                            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-secondary-500 inline-block" /> Received</span>
                            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-secondary-900 inline-block" /> Projected</span>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[220px] w-full">
                            <ResponsiveContainer width="100%" height="100%" minHeight={220}>
                                <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-base-200)" className="dark:opacity-10" />
                                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: 'var(--color-base-400)', fontSize: 12 }} />
                                    <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--color-base-400)', fontSize: 12 }} tickFormatter={(v) => `$${v}`} />
                                    <Tooltip
                                        formatter={(value) => formatCurrency(Number(value))}
                                        contentStyle={{ background: 'var(--color-base-50)', border: '1px solid var(--color-base-200)', borderRadius: 8 }}
                                    />
                                    <Bar dataKey="received" stackId="a" fill="var(--color-secondary-500)" radius={[3, 3, 0, 0]} />
                                    <Bar dataKey="projected" stackId="a" fill="var(--color-secondary-900)" radius={[3, 3, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>

                <div className="grid gap-4 lg:grid-cols-2">
                    <Card>
                        <CardHeader>
                            <CardTitle>Upcoming</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-1">
                            {summary.upcoming.length === 0 && (
                                <div className="text-center py-6 text-base-500 italic">No upcoming payments detected yet.</div>
                            )}
                            {summary.upcoming.slice(0, 6).map((u, i) => {
                                const d = new Date(u.date);
                                const cadenceLabel = u.cadenceDays >= 300 ? "Annual" : u.cadenceDays >= 150 ? "Semi-annual" : u.cadenceDays >= 60 ? "Quarterly" : "Monthly";
                                return (
                                    <div key={i} className="flex items-center gap-3 py-2.5 border-b border-base-100 dark:border-base-800 last:border-0">
                                        <div className="flex flex-col items-center justify-center w-11 h-11 rounded-lg bg-secondary-50 dark:bg-secondary-950 border border-secondary-100 dark:border-secondary-900 shrink-0">
                                            <span className="font-mono font-bold text-secondary-600 dark:text-secondary-400 text-sm leading-none">{d.getDate()}</span>
                                            <span className="font-mono text-[8px] uppercase text-secondary-500">{d.toLocaleDateString('default', { month: 'short' })}</span>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium text-base-900 dark:text-base-50 text-sm">{u.ticker}</div>
                                            <div className="text-xs text-base-500 dark:text-base-400">{cadenceLabel}</div>
                                        </div>
                                        <div className="font-mono font-semibold text-emerald-600 dark:text-emerald-400 text-sm">+{formatCurrency(u.amount)}</div>
                                    </div>
                                );
                            })}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Per-holding yield</CardTitle>
                        </CardHeader>
                        <CardContent className="p-0">
                            <table className="w-full text-left text-sm">
                                <thead className="text-base-500 dark:text-base-400 uppercase text-[10px] font-bold tracking-wider border-b border-base-100 dark:border-base-800">
                                    <tr>
                                        <th className="px-4 py-2">Holding</th>
                                        <th className="px-4 py-2 text-right">Received</th>
                                        <th className="px-4 py-2 text-right">Yield</th>
                                        <th className="px-4 py-2 text-right">Yield on cost</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-base-100 dark:divide-base-800">
                                    {summary.holdings.map(h => (
                                        <tr key={h.assetId}>
                                            <td className="px-4 py-3 font-medium text-base-900 dark:text-base-50">{h.ticker}</td>
                                            <td className="px-4 py-3 text-right font-mono">{formatCurrency(h.receivedThisYear)}</td>
                                            <td className="px-4 py-3 text-right font-mono">{(h.trailingYield * 100).toFixed(1)}%</td>
                                            <td className="px-4 py-3 text-right font-mono text-secondary-600 dark:text-secondary-400">{(h.yieldOnCost * 100).toFixed(1)}%</td>
                                        </tr>
                                    ))}
                                    {summary.holdings.length === 0 && (
                                        <tr>
                                            <td colSpan={4} className="px-4 py-8 text-center text-base-500">No dividend-paying holdings yet.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    )
}
