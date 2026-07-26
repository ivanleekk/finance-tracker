import { StatCard } from "../../components/ui/StatCard"
import { GoalCard } from "../../components/ui/GoalCard"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../components/ui/Card"
import { Badge } from "../../components/ui/Badge"
import { useHousehold } from "../../lib/HouseholdContext"
import { useEffect, useMemo, useState } from "react"
import { useLoaderData, useRevalidator, useSearchParams } from "react-router"
import { cn } from "../../lib/utils"
import { Area, AreaChart, Line, ReferenceLine, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import type { DashboardLoaderData } from "./dashboard.loader"
import type { PortfolioTimeseriesPoint } from "../../types/types"
import { TimeframeSelector } from "../../components/ui/TimeframeSelector"
import { TopBar } from "../../components/TopBar"
import { sampleProjection } from "../../lib/networth"
import { runwayLabel, runwayTone } from "../../lib/budgets"
import { Link } from "react-router"

export { dashboardLoader as loader } from "./dashboard.loader";

export default function Dashboard() {
    const { activeHousehold } = useHousehold();
    const {
        accounts = [],
        balances = {},
        subPortfolios = [],
        transactions = [],
        timeseries = [],
        metrics = null,
        projection = null,
        emergencyFund = null
    } = (useLoaderData() as DashboardLoaderData) || {};
    const revalidator = useRevalidator();
    const [searchParams] = useSearchParams();
    const [timeframe, setTimeframe] = useState("Monthly");
    const startDate = searchParams.get("start_date");

    // Revalidate data when active household changes
    useEffect(() => {
        if (activeHousehold?.id && revalidator.state === "idle") {
            revalidator.revalidate()
        }
    }, [activeHousehold?.id]);

    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: activeHousehold?.base_currency || 'USD',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(value)
    }

    const formatCompactCurrency = (value: number) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: activeHousehold?.base_currency || 'USD',
            notation: 'compact',
            maximumFractionDigits: 1
        }).format(value)
    }

    // Liability accounts (loans, mortgages) store outstanding balances as
    // positive numbers; they count against net worth.
    const liabilityIds = useMemo(
        () => new Set(accounts.filter(a => a.kind === "liability").map(a => a.id)),
        [accounts]
    );

    const currentCash = useMemo(() => {
        let total = 0;
        Object.entries(balances).forEach(([accId, history]) => {
            if (history.length > 0) {
                // ⚡ Bolt Performance Optimization: Replace O(N log N) sorting with an O(N) single-pass reduce
                const last = history.reduce((max, current) => current.date > max.date ? current : max, history[0]);
                const bal = Number(last.balance_home_currency ?? last.balance);
                total += liabilityIds.has(accId) ? -bal : bal;
            }
        });
        return total;
    }, [balances, liabilityIds]);

    const currentPortfolioValue = useMemo(() => {
        if (!timeseries || timeseries.length === 0) return 0;

        // Group by date (summing across sub-portfolios) and find the latest date
        const totalsByDate: Record<string, number> = {};
        timeseries.forEach(t => {
            totalsByDate[t.date] = (totalsByDate[t.date] || 0) + Number(t.total_value_home_currency);
        });

        const datesArr = Object.keys(totalsByDate);
        if (datesArr.length === 0) return 0;

        const latestDate = datesArr.reduce((max, current) => current > max ? current : max, datesArr[0]);

        return totalsByDate[latestDate] || 0;
    }, [timeseries]);

    const netWorth = currentCash + currentPortfolioValue;

    // The outlook only says something worth reading once there is debt to
    // amortize or property to grow — otherwise it's a flat line at today's
    // number, which is noise on the dashboard.
    const projectionData = useMemo(
        () => sampleProjection(projection?.points ?? []),
        [projection]
    );

    const formatMonthYear = (value?: string | null) =>
        value
            ? new Date(value).toLocaleDateString('default', { month: 'long', year: 'numeric', timeZone: 'UTC' })
            : null;

    // ⚡ Bolt Performance Optimization:
    // Replaced O(N^2) nested `.find()` and `.filter()` array operations inside `.map()`
    // with O(N) hash map lookups to prevent main-thread blocking. Also replaced `localeCompare` with relational operators.
    const chartData = useMemo(() => {
        const allDatesSet = new Set<string>();

        // Pre-compute daily portfolio totals (already summed per sub-portfolio server-side)
        const snapshotsByDate = new Map<string, number>();
        timeseries.forEach(t => {
            allDatesSet.add(t.date);
            snapshotsByDate.set(t.date, (snapshotsByDate.get(t.date) || 0) + Number(t.total_value_home_currency));
        });

        // Pre-compute daily balance updates
        const balancesByDate = new Map<string, Array<{ id: string, bal: number }>>();
        Object.entries(balances).forEach(([accId, history]) => {
            const sign = liabilityIds.has(accId) ? -1 : 1;
            history.forEach(b => {
                allDatesSet.add(b.date);
                const list = balancesByDate.get(b.date) || [];
                list.push({ id: accId, bal: sign * Number(b.balance_home_currency ?? b.balance) });
                balancesByDate.set(b.date, list);
            });
        });

        const sortedDates = Array.from(allDatesSet).sort((a, b) => (a < b ? -1 : (a > b ? 1 : 0)));

        const accountLatestBalances = new Map<string, number>();

        const rawData = sortedDates.map(date => {
            const updates = balancesByDate.get(date);
            if (updates) {
                updates.forEach(u => accountLatestBalances.set(u.id, u.bal));
            }

            let currentTotalCash = 0;
            accountLatestBalances.forEach(bal => currentTotalCash += bal);

            const currentTotalPortfolio = snapshotsByDate.get(date) || 0;

            return {
                date,
                netWorth: currentTotalCash + currentTotalPortfolio,
                cash: currentTotalCash,
                portfolio: currentTotalPortfolio
            };
        });

        // Filter by start date if applicable
        const filteredData = rawData.filter(item => !startDate || item.date >= startDate);

        if (timeframe === "Daily") return filteredData;

        const binned = new Map<string, any>();
        filteredData.forEach(item => {
            const d = new Date(item.date);
            let key = "";
            if (timeframe === "Weekly") {
                const startOfWeek = new Date(d);
                const day = d.getDay();
                const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
                startOfWeek.setDate(diff);
                key = startOfWeek.toISOString().split('T')[0];
            } else if (timeframe === "Monthly") {
                key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
            } else if (timeframe === "Yearly") {
                key = `${d.getFullYear()}-01-01`;
            }
            binned.set(key, item);
        });

        return Array.from(binned.values()).sort((a, b) => (a.date < b.date ? -1 : (a.date > b.date ? 1 : 0)));
    }, [balances, timeseries, timeframe, startDate, liabilityIds]);

    if (!activeHousehold) {
        return (
            <div className="flex-1 flex items-center justify-center p-8 text-base-500">
                Please select or create a household.
            </div>
        )
    }

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            <TopBar title="Dashboard" commandPlaceholder="Log or find…" />
            <div className="flex-1 overflow-y-auto space-y-6 p-4 sm:p-6 lg:p-8">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-base-500 dark:text-base-400">Overview of your household financial health.</p>
                    <TimeframeSelector />
                </div>

                {/* Top Row: Stats */}
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                    <StatCard
                        title="Net Worth"
                        value={new Intl.NumberFormat('en-US', { style: 'currency', currency: activeHousehold?.base_currency || 'USD' }).format(netWorth)}
                        trend="neutral"
                    />
                    <StatCard
                        title="Portfolio Value"
                        value={new Intl.NumberFormat('en-US', { style: 'currency', currency: activeHousehold?.base_currency || 'USD' }).format(currentPortfolioValue)}
                        trend="neutral"
                    />
                    <StatCard
                        title="Overall Return"
                        value={`${((metrics?.overall_metrics?.simple_return || 0) * 100).toFixed(2)}%`}
                        trend={(metrics?.overall_metrics?.simple_return || 0) >= 0 ? "up" : "down"}
                    />
                    <StatCard
                        title="TWR (Ann.)"
                        value={`${((metrics?.overall_metrics?.time_weighted_return || 0) * 100).toFixed(2)}%`}
                        trend={(metrics?.overall_metrics?.time_weighted_return || 0) >= 0 ? "up" : "down"}
                    />
                    <StatCard
                        title="IRR / MWR"
                        value={`${((metrics?.overall_metrics?.money_weighted_return || 0) * 100).toFixed(2)}%`}
                        trend={(metrics?.overall_metrics?.money_weighted_return || 0) >= 0 ? "up" : "down"}
                    />
                    <StatCard
                        title="Sharpe Ratio"
                        value={metrics?.overall_metrics?.sharpe_ratio !== undefined && metrics?.overall_metrics?.sharpe_ratio !== null ? metrics.overall_metrics.sharpe_ratio.toFixed(2) : "0.00"}
                        trend="neutral"
                    />
                </div>

                {/* Emergency fund runway — the "how long could I survive" number. */}
                {emergencyFund && (
                    <Link to="/budgets" className="block">
                        <Card className="hover:border-primary-300 dark:hover:border-primary-800 transition-colors">
                            <CardContent className="p-4 flex flex-wrap items-center justify-between gap-4">
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-base-500">Emergency fund runway</div>
                                    <div className={cn(
                                        "font-display text-xl font-bold",
                                        runwayTone(emergencyFund) === "critical" && "text-red-600 dark:text-red-400",
                                        runwayTone(emergencyFund) === "low" && "text-amber-600 dark:text-amber-400",
                                        runwayTone(emergencyFund) === "ok" && "text-emerald-600 dark:text-emerald-400",
                                        runwayTone(emergencyFund) === "unknown" && "text-base-500",
                                    )}>
                                        {runwayLabel(emergencyFund)}
                                    </div>
                                </div>
                                <div className="text-sm text-base-500 dark:text-base-400">
                                    {emergencyFund.months_covered === null || emergencyFund.months_covered === undefined
                                        ? "Log some expenses to measure your burn rate."
                                        : <>
                                            {formatCurrency(Number(emergencyFund.liquid_total))} liquid against{" "}
                                            {formatCurrency(Number(emergencyFund.average_monthly_expenses))}/month
                                            {Number(emergencyFund.shortfall) > 0 && (
                                                <> · {formatCurrency(Number(emergencyFund.shortfall))} short of a {Number(emergencyFund.target_months)}-month target</>
                                            )}
                                        </>}
                                </div>
                            </CardContent>
                        </Card>
                    </Link>
                )}

                {/* Middle Row: Charts & Goals */}
                {/* [&>*]:min-w-0 — without it the charts' intrinsic width stops these
                    grid items shrinking, and the cards spill past the viewport. */}
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7 [&>*]:min-w-0">
                    <Card className="col-span-4">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0">
                            <div>
                                <CardTitle>Net Worth Trend</CardTitle>
                                <CardDescription>Your total wealth growth over time.</CardDescription>
                            </div>
                            <div className="flex bg-base-100 dark:bg-base-900/50 p-1 rounded-lg border border-base-200 dark:border-base-800">
                                {["Daily", "Weekly", "Monthly", "Yearly"].map((tf) => (
                                    <button
                                        key={tf}
                                        onClick={() => setTimeframe(tf)}
                                        className={cn(
                                            "px-3 py-1 text-xs font-medium rounded-md transition-all",
                                            timeframe === tf
                                                ? "bg-white dark:bg-base-700 text-base-900 dark:text-base-50 shadow-sm"
                                                : "text-base-500 dark:text-base-400 hover:text-base-700 dark:hover:text-base-200"
                                        )}
                                    >
                                        {tf}
                                    </button>
                                ))}
                            </div>
                        </CardHeader>
                        <CardContent className="pl-2">
                            <div className="h-[300px] w-full relative min-h-0">
                                {chartData.length > 0 ? (
                                    <ResponsiveContainer width="100%" height="100%" minHeight={300}>
                                        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                            <defs>
                                                <linearGradient id="colorPortfolio" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="var(--color-primary-500)" stopOpacity={0.2} />
                                                    <stop offset="95%" stopColor="var(--color-primary-500)" stopOpacity={0} />
                                                </linearGradient>
                                                <linearGradient id="colorCash" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="var(--color-secondary-500)" stopOpacity={0.2} />
                                                    <stop offset="95%" stopColor="var(--color-secondary-500)" stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-base-200)" className="dark:opacity-10" />
                                            <XAxis
                                                dataKey="date"
                                                axisLine={false}
                                                tickLine={false}
                                                tick={{ fill: 'var(--color-base-400)', fontSize: 12 }}
                                                tickFormatter={(val) => {
                                                    const d = new Date(val);
                                                    if (timeframe === "Yearly") return d.getUTCFullYear().toString();
                                                    if (timeframe === "Monthly") return d.toLocaleDateString('default', { month: 'short', year: '2-digit', timeZone: 'UTC' });
                                                    return d.toLocaleDateString('default', { month: 'short', day: 'numeric', timeZone: 'UTC' });
                                                }}
                                                dy={10}
                                            />
                                            <YAxis
                                                axisLine={false}
                                                tickLine={false}
                                                tick={{ fill: 'var(--color-base-400)', fontSize: 12 }}
                                                tickFormatter={(value) => formatCompactCurrency(value)}
                                            />
                                            <Tooltip
                                                content={({ active, payload, label }) => {
                                                    if (active && payload && payload.length) {
                                                        return (
                                                            <div className="bg-base-50 dark:bg-base-900 border border-base-200 dark:border-base-800 p-3 rounded-lg shadow-xl backdrop-blur-md bg-opacity-95">
                                                                <p className="text-xs font-semibold text-base-500 mb-2 uppercase tracking-wider">
                                                                    {new Date(label).toLocaleDateString('default', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}
                                                                </p>
                                                                <div className="space-y-1.5">
                                                                    {payload.map((entry: any, index: number) => (
                                                                        <div key={index} className="flex items-center justify-between gap-4">
                                                                            <span
                                                                                className="text-sm font-semibold"
                                                                                style={{ color: entry.stroke }}
                                                                            >
                                                                                {entry.name === 'portfolio' ? 'Portfolio' : entry.name === 'cash' ? 'Cash' : entry.name}
                                                                            </span>
                                                                            <span className="text-sm font-bold text-base-900 dark:text-base-50">
                                                                                {new Intl.NumberFormat('en-US', { style: 'currency', currency: activeHousehold?.base_currency || 'USD' }).format(entry.value)}
                                                                            </span>
                                                                        </div>
                                                                    ))}
                                                                    <div className="pt-1.5 mt-1.5 border-t border-base-200 dark:border-base-800 flex items-center justify-between gap-4">
                                                                        <span className="text-sm font-medium text-base-900 dark:text-base-50">Total</span>
                                                                        <span className="text-sm font-bold text-base-900 dark:text-base-50">
                                                                            {new Intl.NumberFormat('en-US', { style: 'currency', currency: activeHousehold?.base_currency || 'USD' }).format(payload.reduce((sum: number, entry: any) => sum + Number(entry.value), 0))}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        );
                                                    }
                                                    return null;
                                                }}
                                            />
                                            <Area
                                                type="monotone"
                                                dataKey="portfolio"
                                                stackId="1"
                                                stroke="var(--color-primary-500)"
                                                strokeWidth={2}
                                                fillOpacity={1}
                                                fill="url(#colorPortfolio)"
                                            />
                                            <Area
                                                type="monotone"
                                                dataKey="cash"
                                                stackId="1"
                                                stroke="var(--color-secondary-500)"
                                                strokeWidth={2}
                                                fillOpacity={1}
                                                fill="url(#colorCash)"
                                            />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <div className="flex h-full items-center justify-center text-base-400 border border-dashed border-base-200 rounded-lg">
                                        No historical data available yet.
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="col-span-3">
                        <CardHeader>
                            <CardTitle>Financial Goals</CardTitle>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-4">
                            {subPortfolios.length > 0 ? (
                                subPortfolios.slice(0, 3).map(sp => {
                                    const spPoints = timeseries.filter(t => t.sub_portfolio_id === sp.id);
                                    const latest = spPoints.reduce<PortfolioTimeseriesPoint | null>(
                                        (max, t) => (!max || t.date > max.date ? t : max),
                                        null
                                    );
                                    const current = Number(latest?.total_value_home_currency ?? 0);
                                    return (
                                        <GoalCard
                                            key={sp.id}
                                            title={sp.name}
                                            currentValue={current}
                                            targetValue={sp.target_amount || 10000}
                                            formatValue={(v) => new Intl.NumberFormat('en-US', { style: 'currency', currency: activeHousehold?.base_currency || 'USD', maximumFractionDigits: 0 }).format(v)}
                                        />
                                    );
                                })
                            ) : (
                                <div className="text-center py-8 text-base-500 italic">
                                    No goals set yet.
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>

                {/* Net worth outlook — where today's assets and debts are headed */}
                {projectionData.length > 0 && projection && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Net Worth Outlook</CardTitle>
                            <CardDescription>
                                Where you land if you keep paying the loans you've recorded. Cash and investments are held flat — this is your debt-and-property trajectory, not a savings forecast.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="grid gap-4 sm:grid-cols-3 mb-4">
                                <div className="rounded-lg border border-base-200 dark:border-base-800 p-3">
                                    <div className="text-[10px] uppercase tracking-wider text-base-500">Net worth positive</div>
                                    <div className="font-display font-bold text-base-900 dark:text-base-50">
                                        {Number(projection.current_net_worth) >= 0
                                            ? "Already there"
                                            : formatMonthYear(projection.net_worth_positive_date) ?? "Not within 30 years"}
                                    </div>
                                </div>
                                <div className="rounded-lg border border-base-200 dark:border-base-800 p-3">
                                    <div className="text-[10px] uppercase tracking-wider text-base-500">Debt free</div>
                                    <div className="font-display font-bold text-base-900 dark:text-base-50">
                                        {formatMonthYear(projection.debt_free_date) ?? "Not within 30 years"}
                                    </div>
                                </div>
                                <div className="rounded-lg border border-base-200 dark:border-base-800 p-3">
                                    <div className="text-[10px] uppercase tracking-wider text-base-500">Interest still to pay</div>
                                    <div className="font-display font-bold text-red-600 dark:text-red-400">
                                        {formatCurrency(Number(projection.total_interest_remaining))}
                                    </div>
                                </div>
                            </div>
                            <div className="h-[300px] w-full">
                                <ResponsiveContainer width="100%" height="100%" minHeight={300}>
                                    <ComposedChart data={projectionData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-base-200)" className="dark:opacity-10" />
                                        <XAxis
                                            dataKey="date"
                                            axisLine={false}
                                            tickLine={false}
                                            tick={{ fill: 'var(--color-base-400)', fontSize: 12 }}
                                            tickFormatter={(val) => new Date(val).getUTCFullYear().toString()}
                                            dy={10}
                                        />
                                        <YAxis
                                            axisLine={false}
                                            tickLine={false}
                                            tick={{ fill: 'var(--color-base-400)', fontSize: 12 }}
                                            tickFormatter={(value) => formatCompactCurrency(value)}
                                        />
                                        <Tooltip
                                            content={({ active, payload, label }) => {
                                                if (!active || !payload || !payload.length) return null;
                                                const labels: Record<string, string> = {
                                                    netWorth: "Net worth",
                                                    assets: "Assets",
                                                    liabilities: "Debt",
                                                };
                                                return (
                                                    <div className="bg-base-50 dark:bg-base-900 border border-base-200 dark:border-base-800 p-3 rounded-lg shadow-xl">
                                                        <p className="text-xs font-semibold text-base-500 mb-2 uppercase tracking-wider">
                                                            {new Date(label).toLocaleDateString('default', { month: 'short', year: 'numeric', timeZone: 'UTC' })}
                                                        </p>
                                                        <div className="space-y-1.5">
                                                            {payload.map((entry: any, index: number) => (
                                                                <div key={index} className="flex items-center justify-between gap-4">
                                                                    <span className="text-sm font-semibold" style={{ color: entry.stroke }}>
                                                                        {labels[entry.dataKey] ?? entry.dataKey}
                                                                    </span>
                                                                    <span className="text-sm font-bold text-base-900 dark:text-base-50">
                                                                        {formatCurrency(Number(entry.value))}
                                                                    </span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                );
                                            }}
                                        />
                                        {/* The line the user is waiting to cross. */}
                                        <ReferenceLine y={0} stroke="var(--color-base-400)" strokeDasharray="4 4" />
                                        <Area type="monotone" dataKey="assets" stroke="var(--color-secondary-500)" strokeWidth={1} fill="var(--color-secondary-500)" fillOpacity={0.08} />
                                        <Area type="monotone" dataKey="liabilities" stroke="#ef4444" strokeWidth={1} fill="#ef4444" fillOpacity={0.08} />
                                        <Line type="monotone" dataKey="netWorth" stroke="var(--color-primary-500)" strokeWidth={2.5} dot={false} />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* Bottom Row: Recent Transactions */}
                <Card>
                    <CardHeader>
                        <CardTitle>Recent Activity</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            {transactions.length > 0 ? (
                                transactions.slice(0, 5).sort((a, b) => (b.date < a.date ? -1 : (b.date > a.date ? 1 : 0))).map((tx) => (
                                    <div key={tx.id} className="flex items-center justify-between border-b border-base-100 dark:border-base-800 pb-4 last:border-0 last:pb-0">
                                        <div>
                                            <p className="font-medium text-base-900 dark:text-base-50">{tx.description || 'Transaction'}</p>
                                            <p className="text-sm text-base-500 dark:text-base-400">{new Date(tx.date).toLocaleDateString()}</p>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <span className={`font-semibold ${Number(tx.amount) > 0 ? 'text-green-600 dark:text-green-400' : 'text-base-900 dark:text-base-50'}`}>
                                                {new Intl.NumberFormat('en-US', { style: 'currency', currency: activeHousehold?.base_currency || 'USD' }).format(Number(tx.amount))}
                                            </span>
                                            <Badge variant="success">
                                                Completed
                                            </Badge>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="text-center py-4 text-base-500">
                                    No recent transactions found.
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
