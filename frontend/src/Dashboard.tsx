import { StatCard } from "./components/ui/StatCard"
import { GoalCard } from "./components/ui/GoalCard"
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/Card"
import { Badge } from "./components/ui/Badge"

export default function Dashboard() {
    return (
        <div className="flex-1 space-y-6 p-8">
            <div className="flex items-center justify-between">
                <h2 className="text-3xl font-bold tracking-tight text-base-900">Dashboard</h2>
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
                    value="$12,050.00" 
                    changeValue="$150.00" 
                    trend="down" 
                />
            </div>

            {/* Middle Row: Charts & Goals */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
                <Card className="col-span-4">
                    <CardHeader>
                        <CardTitle>Portfolio Performance</CardTitle>
                    </CardHeader>
                    <CardContent className="pl-2">
                        <div className="flex h-[300px] items-center justify-center rounded-md border border-dashed border-base-200 bg-base-50 text-base-500">
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