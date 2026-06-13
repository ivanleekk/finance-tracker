import { StatCard } from "../../components/ui/StatCard"
import { GoalCard } from "../../components/ui/GoalCard"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../components/ui/Card"
import { Badge } from "../../components/ui/Badge"
import { useHousehold } from "../../lib/HouseholdContext"
import { useEffect, useMemo, useState } from "react"
import { useLoaderData, useRevalidator, useSearchParams } from "react-router"
import { cn } from "../../lib/utils"
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import type { DashboardLoaderData } from "./dashboard.loader"
import { TimeframeSelector } from "../../components/ui/TimeframeSelector"

export { dashboardLoader as loader } from "./dashboard.loader";

export default function Dashboard() {
    const { activeHousehold } = useHousehold();
    const {
        accounts = [],
        balances = {},
        subPortfolios = [],
        transactions = [],
        snapshots = [],
        metrics = null
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

    const currentCash = useMemo(() => {
        let total = 0;
        Object.values(balances).forEach(history => {
            if (history.length > 0) {
                const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
                const last = sorted[sorted.length - 1];
                total += Number(last.balance_home_currency ?? last.balance);
            }
        });
        return total;
    }, [balances]);

    const currentPortfolioValue = useMemo(() => {
        if (snapshots.length === 0) return 0;

        // Group snapshots by date and find the latest date
        const snapshotsByDate: Record<string, number> = {};
        snapshots.forEach(s => {
            snapshotsByDate[s.date] = (snapshotsByDate[s.date] || 0) + Number(s.current_value_home_currency);
        });

        const sortedDates = Object.keys(snapshotsByDate).sort((a, b) => a.localeCompare(b));
        if (sortedDates.length === 0) return 0;

        return snapshotsByDate[sortedDates[sortedDates.length - 1]];
    }, [snapshots]);

    const netWorth = currentCash + currentPortfolioValue;

    // Aggregate historical data for the chart using real snapshots and carrying forward cash
    const chartData = useMemo(() => {
        const allDatesSet = new Set<string>();
        snapshots.forEach(s => allDatesSet.add(s.date));
        Object.values(balances).forEach(history => {
            history.forEach(b => allDatesSet.add(b.date));
        });

        // Use standard relational operators for faster date sorting
        const sortedDates = Array.from(allDatesSet).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        
        // Optimize: Pre-calculate sums and balances by date to avoid O(N^2) array operations inside the map loop
        const portfolioByDate = new Map<string, number>();
        snapshots.forEach(s => {
            portfolioByDate.set(s.date, (portfolioByDate.get(s.date) || 0) + Number(s.current_value_home_currency));
        });

        const balanceUpdatesByDate = new Map<string, Array<{accId: string, value: number}>>();
        Object.entries(balances).forEach(([accId, history]) => {
            history.forEach(b => {
                let updates = balanceUpdatesByDate.get(b.date);
                if (!updates) {
                    updates = [];
                    balanceUpdatesByDate.set(b.date, updates);
                }
                updates.push({ accId, value: Number(b.balance_home_currency ?? b.balance) });
            });
        });

        // Track the latest balance for each account to "carry forward"
        const accountLatestBalances = new Map<string, number>();
        let currentTotalCash = 0;
        
        const rawData = sortedDates.map(date => {
            // Apply any balance updates for THIS date
            const updatesOnDate = balanceUpdatesByDate.get(date);
            if (updatesOnDate) {
                updatesOnDate.forEach(update => {
                    const prevValue = accountLatestBalances.get(update.accId) || 0;
                    currentTotalCash += (update.value - prevValue);
                    accountLatestBalances.set(update.accId, update.value);
                });
            }
            
            // Get portfolio snapshots for this date
            const currentTotalPortfolio = portfolioByDate.get(date) || 0;

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

        return Array.from(binned.values()).sort((a, b) => a.date.localeCompare(b.date));
    }, [balances, snapshots, timeframe, startDate]);

    if (!activeHousehold) {
        return (
            <div className="flex-1 flex items-center justify-center p-8 text-base-500">
                Please select or create a household.
            </div>
        )
    }

    return (
        <div className="flex-1 space-y-6 p-8">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight text-base-900 dark:text-base-50">Dashboard</h2>
                    <p className="text-base-500 dark:text-base-400 mt-1">Overview of your household financial health.</p>
                </div>
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

            {/* Middle Row: Charts & Goals */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
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
                                const spSnaps = snapshots.filter(s => s.sub_portfolio_id === sp.id);
                                // Optimize: Calculate latest date and sum directly without filtering to reduce array allocations
                                let latestDate = null;
                                let current = 0;
                                if (spSnaps.length > 0) {
                                    latestDate = spSnaps.reduce((max, s) => s.date > max ? s.date : max, spSnaps[0].date);
                                    current = spSnaps.reduce((sum, s) => s.date === latestDate ? sum + Number(s.current_value_home_currency) : sum, 0);
                                }
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

            {/* Bottom Row: Recent Transactions */}
            <Card>
                <CardHeader>
                    <CardTitle>Recent Activity</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {transactions.length > 0 ? (
                            transactions.slice(0, 5).sort((a, b) => (b.date < a.date ? -1 : b.date > a.date ? 1 : 0)).map((tx) => (
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
    )
}
