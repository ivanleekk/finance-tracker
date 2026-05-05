import { StatCard } from "../../components/ui/StatCard"
import { GoalCard } from "../../components/ui/GoalCard"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../components/ui/Card"
import { Badge } from "../../components/ui/Badge"
import { useHousehold } from "../../lib/HouseholdContext"
import { useEffect, useMemo } from "react"
import { useLoaderData, useRevalidator } from "react-router"
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import type { DashboardLoaderData } from "./dashboard.loader"

export { dashboardLoader as loader } from "./dashboard.loader";

export default function Dashboard() {
    const { activeHousehold } = useHousehold();
    const {
        accounts = [],
        balances = {},
        subPortfolios = [],
        transactions = [],
        snapshots = []
    } = (useLoaderData() as DashboardLoaderData) || {};
    const revalidator = useRevalidator();

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

    // Aggregate historical data for the chart
    const chartData = useMemo(() => {
        const allDates = new Set<string>();
        Object.values(balances).flat().forEach(b => allDates.add(b.date));
        snapshots.forEach(s => allDates.add(s.date));

        const sortedDates = Array.from(allDates).sort((a, b) => a.localeCompare(b));

        // Pre-sort balances by account
        const sortedBalances = Object.values(balances).map(history =>
            [...history].sort((a, b) => a.date.localeCompare(b.date))
        );

        // Group and sort snapshots by position (sub_portfolio + asset) to properly track value over time
        const snapshotsByPosition: Record<string, typeof snapshots> = {};
        snapshots.forEach(s => {
            const key = `${s.sub_portfolio_id}_${s.asset_id}`;
            if (!snapshotsByPosition[key]) {
                snapshotsByPosition[key] = [];
            }
            snapshotsByPosition[key].push(s);
        });

        const sortedSnapshots = Object.values(snapshotsByPosition).map(posSnapshots =>
            [...posSnapshots].sort((a, b) => a.date.localeCompare(b.date))
        );

        const currentBalanceByAccount = new Array(sortedBalances.length).fill(0);
        const balancePointers = new Array(sortedBalances.length).fill(0);

        const currentSnapshotByPos = new Array(sortedSnapshots.length).fill(0);
        const snapshotPointers = new Array(sortedSnapshots.length).fill(0);

        return sortedDates.map(date => {
            let cash = 0;
            sortedBalances.forEach((history, i) => {
                while (balancePointers[i] < history.length && history[balancePointers[i]].date <= date) {
                    currentBalanceByAccount[i] = Number(history[balancePointers[i]].balance);
                    balancePointers[i]++;
                }
                cash += currentBalanceByAccount[i];
            });

            let portfolio = 0;
            sortedSnapshots.forEach((posSnapshots, i) => {
                while (snapshotPointers[i] < posSnapshots.length && posSnapshots[snapshotPointers[i]].date <= date) {
                    currentSnapshotByPos[i] = Number(posSnapshots[snapshotPointers[i]].current_value_home_currency);
                    snapshotPointers[i]++;
                }
                portfolio += currentSnapshotByPos[i];
            });

            return {
                date,
                netWorth: cash + portfolio,
                cash,
                portfolio
            };
        });
    }, [balances, snapshots]);

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
            </div>

            {/* Top Row: Stats */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
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
                    title="Cash Balance"
                    value={formatCurrency(currentCash)}
                    trend="neutral"
                />
            </div>

            {/* Middle Row: Charts & Goals */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
                <Card className="col-span-4">
                    <CardHeader>
                        <CardTitle>Net Worth Trend</CardTitle>
                        <CardDescription>Your total wealth growth over time.</CardDescription>
                    </CardHeader>
                    <CardContent className="pl-2">
                        <div className="h-[300px] w-full">
                            {chartData.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
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
                                            dy={10}
                                        />
                                        <YAxis
                                            axisLine={false}
                                            tickLine={false}
                                            tick={{ fill: '#94a3b8', fontSize: 12 }}
                                            tickFormatter={(value) => `$${value >= 1000 ? (value / 1000).toFixed(0) + 'k' : value}`}
                                        />
                                        <Tooltip
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
