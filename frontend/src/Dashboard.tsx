import { StatCard } from "./components/ui/StatCard"
import { GoalCard } from "./components/ui/GoalCard"
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/Card"
import { Badge } from "./components/ui/Badge"
import { useHousehold } from "./lib/HouseholdContext"
import { useEffect, useState, useMemo } from "react"
import api from "./lib/api"
import type { AccountResponse, BalanceResponse } from "./types/types"

export default function Dashboard() {
    const { activeHousehold } = useHousehold();
    const [accounts, setAccounts] = useState<AccountResponse[]>([]);
    const [balances, setBalances] = useState<Record<string, BalanceResponse[]>>({});
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchDashboardData = async () => {
            if (!activeHousehold) return;
            setIsLoading(true);
            try {
                const accountsRes = await api.get<AccountResponse[]>(`/accounts/household/${activeHousehold.id}`);
                setAccounts(accountsRes.data);

                const balanceMap: Record<string, BalanceResponse[]> = {};
                await Promise.all(accountsRes.data.map(async (acc) => {
                    const bRes = await api.get<BalanceResponse[]>(`/accounts/balances/account/${acc.id}`);
                    balanceMap[acc.id] = bRes.data;
                }));
                setBalances(balanceMap);
            } catch (error) {
                console.error("Dashboard fetch failed", error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchDashboardData();
    }, [activeHousehold?.id]);

    const totalCash = useMemo(() => {
        let total = 0;
        Object.values(balances).forEach(history => {
            if (history.length > 0) {
                const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
                total += Number(sorted[sorted.length - 1].balance);
            }
        });
        return total;
    }, [balances]);

    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
    }

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
                <h2 className="text-3xl font-bold tracking-tight text-base-900">Dashboard for {activeHousehold.name}</h2>
            </div>

            {/* Top Row: Stats */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <StatCard
                    title="Net Worth"
                    value="$124,563.00"
                    changeValue="$2,400.00"
                    changePercent={1.9}
                    trend="up"
                />
                <StatCard
                    title="Daily Return"
                    value="+$854.20"
                    changePercent={0.7}
                    trend="up"
                />
                <StatCard
                    title="Cash Balance"
                    value={isLoading ? "..." : formatCurrency(totalCash)}
                    trend="neutral"
                />
            </div>

            {/* Middle Row: Charts & Goals */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
                <Card className="col-span-4">
                    <CardHeader>
                        <CardTitle>Portfolio Performance</CardTitle>
                    </CardHeader>
                    <CardContent className="pl-2">
                        <div className="flex h-75 items-center justify-center rounded-md border border-dashed border-base-200 bg-base-50 text-base-500">
                            Chart Placeholder
                        </div>
                    </CardContent>
                </Card>

                <Card className="col-span-3">
                    <CardHeader>
                        <CardTitle>Financial Goals</CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-4">
                        <GoalCard
                            title="Emergency Fund"
                            currentValue={8000}
                            targetValue={10000}
                            formatValue={(v) => `$${v.toLocaleString()}`}
                        />
                        <GoalCard
                            title="New Car Down Payment"
                            currentValue={2500}
                            targetValue={15000}
                            formatValue={(v) => `$${v.toLocaleString()}`}
                        />
                    </CardContent>
                </Card>
            </div>

            {/* Bottom Row: Recent Transactions */}
            <Card>
                <CardHeader>
                    <CardTitle>Recent Transactions</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {[
                            { name: "Bought AAPL", amount: "-$1,500.00", date: "Today, 10:23 AM", status: "completed" },
                            { name: "Salary Deposit", amount: "+$4,200.00", date: "Yesterday", status: "completed" },
                            { name: "Bought TSLA", amount: "-$850.00", date: "May 1st", status: "pending" }
                        ].map((tx, i) => (
                            <div key={i} className="flex items-center justify-between border-b border-base-100 pb-4 last:border-0 last:pb-0">
                                <div>
                                    <p className="font-medium text-base-900">{tx.name}</p>
                                    <p className="text-sm text-base-500">{tx.date}</p>
                                </div>
                                <div className="flex items-center gap-4">
                                    <span className={`font-semibold ${tx.amount.startsWith('+') ? 'text-green-600' : 'text-base-900'}`}>
                                        {tx.amount}
                                    </span>
                                    <Badge variant={tx.status === 'completed' ? 'success' : 'warning'}>
                                        {tx.status}
                                    </Badge>
                                </div>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}