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
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
    }

    const currentCash = useMemo(() => {
        let total = 0;
        Object.values(balances).forEach(history => {
            if (history.length > 0) {
                const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
                total += Number(sorted[sorted.length - 1].balance);
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

    // Aggregate historical data for the chart using real snapshots
    const chartData = useMemo(() => {
        const dailyData = new Map<string, { cash: number; portfolio: number }>();
        
        // Cash: Aggregate from balances
        Object.values(balances).forEach(history => {
            history.forEach(b => {
                const existing = dailyData.get(b.date) || { cash: 0, portfolio: 0 };
                dailyData.set(b.date, { ...existing, cash: existing.cash + Number(b.balance) });
            });
        });

        // Portfolio: Aggregate from snapshots
        snapshots.forEach(s => {
            const existing = dailyData.get(s.date) || { cash: 0, portfolio: 0 };
            dailyData.set(s.date, { ...existing, portfolio: existing.portfolio + Number(s.current_value_home_currency) });
        });

        const sortedDates = Array.from(dailyData.keys())
            .filter(date => !startDate || date >= startDate)
            .sort((a, b) => a.localeCompare(b));

        const rawData = sortedDates.map(date => {
            const data = dailyData.get(date)!;
            return {
                date, // ISO string for unique key
                netWorth: data.cash + data.portfolio,
                cash: data.cash,
                portfolio: data.portfolio
            };
        });

        if (timeframe === "Daily") return rawData;

        const binned = new Map<string, any>();
        rawData.forEach(item => {
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
    }, [balances, snapshots, timeframe]);

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
                    <h2 className="text-3xl font-bold tracking-tight text-base-900">Dashboard</h2>
                    <p className="text-base-500 mt-1">Overview of your household financial health.</p>
                </div>
                <TimeframeSelector />
            </div>

            {/* Top Row: Stats */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                <StatCard
                    title="Net Worth"
                    value={formatCurrency(netWorth)}
                    trend="neutral"
                />
                <StatCard
                    title="Portfolio Value"
                    value={formatCurrency(currentPortfolioValue)}
                    trend="neutral"
                />
                <StatCard
                    title="Overall Return"
                    value={`${((metrics?.overall_metrics.simple_return || 0) * 100).toFixed(2)}%`}
                    trend={(metrics?.overall_metrics.simple_return || 0) >= 0 ? "up" : "down"}
                />
                <StatCard
                    title="TWR (Ann.)"
                    value={`${((metrics?.overall_metrics.time_weighted_return || 0) * 100).toFixed(2)}%`}
                    trend={(metrics?.overall_metrics.time_weighted_return || 0) >= 0 ? "up" : "down"}
                />
                <StatCard
                    title="IRR / MWR"
                    value={`${((metrics?.overall_metrics.money_weighted_return || 0) * 100).toFixed(2)}%`}
                    trend={(metrics?.overall_metrics.money_weighted_return || 0) >= 0 ? "up" : "down"}
                />
                <StatCard
                    title="Sharpe Ratio"
                    value={metrics?.overall_metrics.sharpe_ratio !== undefined && metrics?.overall_metrics.sharpe_ratio !== null ? metrics.overall_metrics.sharpe_ratio.toFixed(2) : "0.00"}
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
                        <div className="flex bg-base-100 p-1 rounded-lg border border-base-200">
                            {["Daily", "Weekly", "Monthly", "Yearly"].map((tf) => (
                                <button
                                    key={tf}
                                    onClick={() => setTimeframe(tf)}
                                    className={cn(
                                        "px-3 py-1 text-xs font-medium rounded-md transition-all",
                                        timeframe === tf
                                            ? "bg-white text-base-900 shadow-sm"
                                            : "text-base-500 hover:text-base-700"
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
                                            <linearGradient id="colorNetWorth" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.1} />
                                                <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                        <XAxis
                                            dataKey="date"
                                            axisLine={false}
                                            tickLine={false}
                                            tick={{ fill: '#94a3b8', fontSize: 12 }}
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
                                            tick={{ fill: '#94a3b8', fontSize: 12 }}
                                            tickFormatter={(value) => `$${value >= 1000 ? (value / 1000).toFixed(0) + 'k' : value}`}
                                        />
                                        <Tooltip
                                            labelFormatter={(label) => new Date(label).toLocaleDateString('default', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}
                                            formatter={(value: any) => [formatCurrency(value as number), 'Net Worth']}
                                            contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0' }}
                                        />
                                        <Area
                                            type="monotone"
                                            dataKey="netWorth"
                                            stroke="#0ea5e9"
                                            strokeWidth={2}
                                            fillOpacity={1}
                                            fill="url(#colorNetWorth)"
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
                                const current = snapshots
                                    .filter(s => s.sub_portfolio_id === sp.id)
                                    .reduce((sum, s) => sum + Number(s.current_value_home_currency), 0);
                                return (
                                    <GoalCard
                                        key={sp.id}
                                        title={sp.name}
                                        currentValue={current}
                                        targetValue={10000} // TODO: Add target_value to SubPortfolio model
                                        formatValue={(v) => `$${v.toLocaleString()}`}
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
                            transactions.slice(0, 5).sort((a, b) => b.date.localeCompare(a.date)).map((tx) => (
                                <div key={tx.id} className="flex items-center justify-between border-b border-base-100 pb-4 last:border-0 last:pb-0">
                                    <div>
                                        <p className="font-medium text-base-900">{tx.description || 'Transaction'}</p>
                                        <p className="text-sm text-base-500">{new Date(tx.date).toLocaleDateString()}</p>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <span className={`font-semibold ${Number(tx.amount) > 0 ? 'text-green-600' : 'text-base-900'}`}>
                                            {formatCurrency(Number(tx.amount))}
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
