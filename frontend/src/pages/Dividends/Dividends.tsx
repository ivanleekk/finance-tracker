import { useMemo, useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../components/ui/Card";
import { StatCard } from "../../components/ui/StatCard";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { TopBar } from "../../components/TopBar";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { useHousehold } from "../../lib/HouseholdContext";
import { summarizeDividends } from "../../lib/dividends";
import api from "../../lib/api";
import type { ScheduledDividendResponse } from "../../types/types";
import type { DividendsLoaderData } from "./dividends.loader";

export { dividendsLoader as loader } from "./dividends.loader";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LABELS_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function addMonths(iso: string, months: number): string {
    const [y, m, d] = iso.split("-").map(Number);
    const total = (m - 1) + months;
    const year = y + Math.floor(total / 12);
    const month = (total % 12) + 1;
    // Clamp the day so e.g. Jan 31 + 1mo lands on the last day of Feb.
    const lastDay = new Date(year, month, 0).getDate();
    const day = Math.min(d, lastDay);
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export default function Dividends() {
    const { activeHousehold } = useHousehold();
    const { dividends = [], assets = [], snapshots = [], scheduled = [], subportfolios = [], accounts = [] } = (useLoaderData() as DividendsLoaderData) || {};

    const formatCurrency = (value: number) =>
        new Intl.NumberFormat('en-US', { style: 'currency', currency: activeHousehold?.base_currency || 'USD', maximumFractionDigits: 0 }).format(value);

    // Dividend amounts are often small (e.g. $43.50), so the chart keeps cents.
    const formatCurrencyPrecise = (value: number) =>
        new Intl.NumberFormat('en-US', { style: 'currency', currency: activeHousehold?.base_currency || 'USD', maximumFractionDigits: 2 }).format(value);

    const formatCompactCurrency = (value: number) =>
        new Intl.NumberFormat('en-US', { style: 'currency', currency: activeHousehold?.base_currency || 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(value);

    const summary = useMemo(() => summarizeDividends(dividends, assets, snapshots), [dividends, assets, snapshots]);

    const chartData = useMemo(() => summary.calendar.map(m => ({
        month: MONTH_LABELS[m.month],
        monthFull: MONTH_LABELS_FULL[m.month],
        received: m.received,
        projected: m.projected,
    })), [summary.calendar]);

    const revalidator = useRevalidator();
    const assetById = useMemo(() => new Map(assets.map(a => [a.id, a])), [assets]);
    // Only assets the household actually holds can pay a coupon.
    const schedulableAssets = useMemo(() => {
        const held = new Set(snapshots.map(s => s.asset_id));
        return assets.filter(a => held.has(a.id) && a.type !== "cash");
    }, [assets, snapshots]);

    const [schedForm, setSchedForm] = useState(() => ({
        assetId: "",
        subPortfolioId: "",
        accountId: "",
        amount: "",
        firstDate: new Date().toISOString().split("T")[0],
        everyMonths: "6",
        count: "10",
    }));
    const [isScheduling, setIsScheduling] = useState(false);
    const [schedError, setSchedError] = useState<string | null>(null);

    const handleSchedule = async () => {
        if (!activeHousehold) return;
        const assetId = schedForm.assetId || schedulableAssets[0]?.id;
        const subPortfolioId = schedForm.subPortfolioId || subportfolios[0]?.id;
        const accountId = schedForm.accountId || accounts[0]?.id;
        const amount = parseFloat(schedForm.amount);
        const count = parseInt(schedForm.count, 10);
        const every = parseInt(schedForm.everyMonths, 10);
        if (!assetId || !subPortfolioId || !accountId) {
            setSchedError("You need a held asset, a portfolio, and an account first.");
            return;
        }
        if (!amount || amount <= 0 || !count || count <= 0 || !schedForm.firstDate) {
            setSchedError("Enter a positive amount, a payment count, and a first payment date.");
            return;
        }
        setIsScheduling(true);
        setSchedError(null);
        try {
            const items = Array.from({ length: count }, (_, i) => ({
                household_id: activeHousehold.id,
                sub_portfolio_id: subPortfolioId,
                asset_id: assetId,
                account_id: accountId,
                date: addMonths(schedForm.firstDate, i * every),
                amount,
                description: "Coupon",
            }));
            await api.post("/portfolio/scheduled-dividends", items);
            setSchedForm(f => ({ ...f, amount: "" }));
            revalidator.revalidate();
        } catch (e: any) {
            console.error(e);
            setSchedError(e.response?.data?.detail || "Failed to schedule payments.");
        } finally {
            setIsScheduling(false);
        }
    };

    const handleDeleteScheduled = async (id: string) => {
        try {
            await api.delete(`/portfolio/scheduled-dividends/${id}`);
            revalidator.revalidate();
        } catch (e) {
            console.error(e);
        }
    };

    const handleAmendScheduled = async (row: ScheduledDividendResponse, newAmount: number) => {
        if (!newAmount || newAmount <= 0 || newAmount === Number(row.amount)) return;
        try {
            await api.put(`/portfolio/scheduled-dividends/${row.id}`, { amount: newAmount });
            revalidator.revalidate();
        } catch (e) {
            console.error(e);
        }
    };

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
            <div className="flex-1 overflow-y-auto space-y-6 p-4 sm:p-6 lg:p-8">
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
                            <span
                                className="flex items-center gap-1.5"
                            >
                                <span
                                    className="w-2.5 h-2.5 rounded-sm inline-block"
                                    style={{ background: "repeating-linear-gradient(45deg, var(--color-secondary-500) 0 1.5px, transparent 1.5px 4px)" }}
                                />
                                Projected
                            </span>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[220px] w-full">
                            <ResponsiveContainer width="100%" height="100%" minHeight={220}>
                                <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                    <defs>
                                        {/* Diagonal stripes mark projected (not-yet-received) income. */}
                                        <pattern id="dividendProjectedStripes" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)">
                                            <line x1="0" y1="0" x2="0" y2="5" stroke="var(--color-secondary-500)" strokeWidth="2.5" />
                                        </pattern>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-base-200)" className="dark:opacity-10" />
                                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: 'var(--color-base-400)', fontSize: 12 }} dy={6} interval={0} />
                                    <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--color-base-400)', fontSize: 12 }} tickFormatter={(v) => formatCompactCurrency(Number(v))} />
                                    <Tooltip
                                        cursor={{ fill: 'var(--color-base-400)', fillOpacity: 0.08 }}
                                        content={({ active, payload }) => {
                                            if (!active || !payload || payload.length === 0) return null;
                                            const row = payload[0].payload as { monthFull: string; received: number; projected: number };
                                            const total = row.received + row.projected;
                                            return (
                                                <div className="bg-base-50 dark:bg-base-900 border border-base-200 dark:border-base-800 p-3 rounded-lg shadow-xl">
                                                    <p className="text-xs font-semibold text-base-500 mb-2 uppercase tracking-wider">
                                                        {row.monthFull} {new Date().getFullYear()}
                                                    </p>
                                                    {total === 0 ? (
                                                        <p className="text-sm text-base-500 dark:text-base-400 italic">No dividend income</p>
                                                    ) : (
                                                        <div className="space-y-1.5">
                                                            {row.received > 0 && (
                                                                <div className="flex items-center justify-between gap-6">
                                                                    <span className="flex items-center gap-1.5 text-sm text-base-500 dark:text-base-400">
                                                                        <span className="w-2.5 h-2.5 rounded-sm bg-secondary-500 inline-block" /> Received
                                                                    </span>
                                                                    <span className="text-sm font-bold font-mono text-base-900 dark:text-base-50">{formatCurrencyPrecise(row.received)}</span>
                                                                </div>
                                                            )}
                                                            {row.projected > 0 && (
                                                                <div className="flex items-center justify-between gap-6">
                                                                    <span className="flex items-center gap-1.5 text-sm text-base-500 dark:text-base-400">
                                                                        <span
                                                                            className="w-2.5 h-2.5 rounded-sm inline-block"
                                                                            style={{ background: "repeating-linear-gradient(45deg, var(--color-secondary-500) 0 1.5px, transparent 1.5px 4px)" }}
                                                                        /> Projected
                                                                    </span>
                                                                    <span className="text-sm font-bold font-mono text-base-900 dark:text-base-50">{formatCurrencyPrecise(row.projected)}</span>
                                                                </div>
                                                            )}
                                                            {row.received > 0 && row.projected > 0 && (
                                                                <div className="pt-1.5 mt-1.5 border-t border-base-200 dark:border-base-800 flex items-center justify-between gap-6">
                                                                    <span className="text-sm font-medium text-base-900 dark:text-base-50">Total</span>
                                                                    <span className="text-sm font-bold font-mono text-base-900 dark:text-base-50">{formatCurrencyPrecise(total)}</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        }}
                                    />
                                    <Bar dataKey="received" stackId="a" fill="var(--color-secondary-500)" maxBarSize={24}>
                                        {/* Round the top only when this segment IS the top of the stack. */}
                                        {chartData.map((d, i) => (
                                            <Cell key={i} radius={(d.projected > 0 ? [0, 0, 0, 0] : [4, 4, 0, 0]) as unknown as number} />
                                        ))}
                                    </Bar>
                                    <Bar dataKey="projected" stackId="a" fill="url(#dividendProjectedStripes)" radius={[4, 4, 0, 0]} maxBarSize={24} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>

                {/* [&>*]:min-w-0 — grid items default to min-width:auto, which lets the
                    wide holdings table stretch the column instead of scrolling inside it. */}
                <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
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
                            <div className="overflow-x-auto">
                            <table className="w-full min-w-[520px] text-left text-sm">
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
                            </div>
                        </CardContent>
                    </Card>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>Coupon schedule</CardTitle>
                        <CardDescription>
                            Pre-plan known payments — bond coupons, SSB semi-annual interest. Each payment becomes a dividend automatically on its date; edit individual amounts below for step-up coupons.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-5">
                        {schedError && (
                            <div className="p-3 rounded text-sm bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400">{schedError}</div>
                        )}
                        <div className="flex items-end gap-3 flex-wrap">
                            <div className="min-w-[160px] flex-1 space-y-2">
                                <label className="text-sm font-medium text-base-900 dark:text-base-50">Asset</label>
                                <Select
                                    value={schedForm.assetId || schedulableAssets[0]?.id || ""}
                                    onChange={(assetId) => setSchedForm({ ...schedForm, assetId })}
                                    placeholder="No held assets"
                                    options={schedulableAssets.map(a => ({ value: a.id, label: `${a.ticker} (${a.currency})` }))}
                                />
                            </div>
                            <div className="min-w-[140px] space-y-2">
                                <label className="text-sm font-medium text-base-900 dark:text-base-50">Portfolio</label>
                                <Select
                                    value={schedForm.subPortfolioId || subportfolios[0]?.id || ""}
                                    onChange={(subPortfolioId) => setSchedForm({ ...schedForm, subPortfolioId })}
                                    placeholder="No portfolios"
                                    options={subportfolios.map(sp => ({ value: sp.id, label: sp.name }))}
                                />
                            </div>
                            <div className="min-w-[140px] space-y-2">
                                <label className="text-sm font-medium text-base-900 dark:text-base-50">Account</label>
                                <Select
                                    value={schedForm.accountId || accounts[0]?.id || ""}
                                    onChange={(accountId) => setSchedForm({ ...schedForm, accountId })}
                                    placeholder="No accounts"
                                    options={accounts.map(a => ({ value: a.id, label: a.name }))}
                                />
                            </div>
                            <div className="w-28 space-y-2">
                                <Input
                                    label="Amount"
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    placeholder="43.50"
                                    value={schedForm.amount}
                                    onChange={e => setSchedForm({ ...schedForm, amount: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Input
                                    label="First payment"
                                    type="date"
                                    value={schedForm.firstDate}
                                    onChange={e => setSchedForm({ ...schedForm, firstDate: e.target.value })}
                                />
                            </div>
                            <div className="min-w-[130px] space-y-2">
                                <label className="text-sm font-medium text-base-900 dark:text-base-50">Frequency</label>
                                <Select
                                    value={schedForm.everyMonths}
                                    onChange={(everyMonths) => setSchedForm({ ...schedForm, everyMonths })}
                                    options={[
                                        { value: "1", label: "Monthly" },
                                        { value: "3", label: "Quarterly" },
                                        { value: "6", label: "Semi-annual" },
                                        { value: "12", label: "Annual" },
                                    ]}
                                />
                            </div>
                            <div className="w-24 space-y-2">
                                <Input
                                    label="Payments"
                                    type="number"
                                    min="1"
                                    step="1"
                                    value={schedForm.count}
                                    onChange={e => setSchedForm({ ...schedForm, count: e.target.value })}
                                />
                            </div>
                            <Button variant="primary" className="h-[42px]" onClick={handleSchedule} disabled={isScheduling || schedulableAssets.length === 0}>
                                {isScheduling ? "Scheduling..." : "Schedule"}
                            </Button>
                        </div>

                        {scheduled.length > 0 ? (
                            <div className="max-h-72 overflow-y-auto overflow-x-auto rounded-lg border border-base-100 dark:border-base-800">
                                <table className="w-full min-w-[480px] text-left text-sm">
                                    <thead className="text-base-500 dark:text-base-400 uppercase text-[10px] font-bold tracking-wider border-b border-base-100 dark:border-base-800 sticky top-0 bg-white dark:bg-base-900">
                                        <tr>
                                            <th className="px-4 py-2">Date</th>
                                            <th className="px-4 py-2">Asset</th>
                                            <th className="px-4 py-2">Note</th>
                                            <th className="px-4 py-2 text-right">Amount</th>
                                            <th className="px-4 py-2" />
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-base-100 dark:divide-base-800">
                                        {scheduled.map(row => {
                                            const asset = assetById.get(row.asset_id);
                                            return (
                                                <tr key={row.id}>
                                                    <td className="px-4 py-2 font-mono text-xs text-base-600 dark:text-base-300 whitespace-nowrap">
                                                        {new Date(row.date).toLocaleDateString('default', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                    </td>
                                                    <td className="px-4 py-2 font-medium text-base-900 dark:text-base-50">{asset?.ticker || "—"}</td>
                                                    <td className="px-4 py-2 text-base-500 dark:text-base-400">{row.description || ""}</td>
                                                    <td className="px-4 py-2 text-right">
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            min="0"
                                                            defaultValue={Number(row.amount)}
                                                            onBlur={e => handleAmendScheduled(row, parseFloat(e.target.value))}
                                                            className="w-24 rounded-md border border-transparent hover:border-base-200 dark:hover:border-base-700 focus:border-secondary-400 bg-transparent px-2 py-1 text-right font-mono text-sm text-base-900 dark:text-base-50 outline-none"
                                                        />
                                                        <span className="ml-1 font-mono text-[10px] text-base-400">{asset?.currency}</span>
                                                    </td>
                                                    <td className="px-4 py-2 text-right">
                                                        <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700" onClick={() => handleDeleteScheduled(row.id)}>✕</Button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div className="text-center py-4 text-base-500 italic text-sm">No scheduled payments yet. Schedule a bond's coupon calendar above.</div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
