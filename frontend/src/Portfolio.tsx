import { useState } from "react"
import { StatCard } from "./components/ui/StatCard"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./components/ui/Card"
import { Badge } from "./components/ui/Badge"
import { Button } from "./components/ui/Button"
import { cn } from "./lib/utils"
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts"

export default function Portfolio() {
    const [activeTab, setActiveTab] = useState("Overall")

    const portfolios = {
        "Overall": {
            stats: {
                equity: "$125,450.00",
                unrealized: "+$22,120.00",
                unrealizedPercent: 21.4,
                realized: "+$8,400.00",
                sharpe: "1.85",
                sortino: "2.40",
                drawdown: "-12.5%"
            },
            history: [
                { date: "Jan", equity: 100000 },
                { date: "Feb", equity: 105000 },
                { date: "Mar", equity: 102000 },
                { date: "Apr", equity: 110000 },
                { date: "May", equity: 108000 },
                { date: "Jun", equity: 118000 },
                { date: "Jul", equity: 125450 }
            ],
            holdings: [
                { ticker: "AAPL", name: "Apple Inc.", shares: 150, avgCost: 145.00, currentPrice: 175.50 },
                { ticker: "TSLA", name: "Tesla Inc.", shares: 45, avgCost: 200.00, currentPrice: 185.20 },
                { ticker: "MSFT", name: "Microsoft", shares: 80, avgCost: 290.00, currentPrice: 420.00 },
                { ticker: "VOO", name: "Vanguard S&P 500", shares: 200, avgCost: 350.00, currentPrice: 480.00 }
            ]
        },
        "Retirement": {
            stats: {
                equity: "$96,000.00",
                unrealized: "+$18,000.00",
                unrealizedPercent: 23.0,
                realized: "+$4,000.00",
                sharpe: "2.10",
                sortino: "2.85",
                drawdown: "-8.2%"
            },
            history: [
                { date: "Jan", equity: 75000 },
                { date: "Feb", equity: 78000 },
                { date: "Mar", equity: 76000 },
                { date: "Apr", equity: 82000 },
                { date: "May", equity: 81000 },
                { date: "Jun", equity: 89000 },
                { date: "Jul", equity: 96000 }
            ],
            holdings: [
                { ticker: "VOO", name: "Vanguard S&P 500", shares: 200, avgCost: 350.00, currentPrice: 480.00 }
            ]
        },
        "Trading": {
            stats: {
                equity: "$29,450.00",
                unrealized: "+$4,120.00",
                unrealizedPercent: 16.2,
                realized: "+$4,400.00",
                sharpe: "1.25",
                sortino: "1.50",
                drawdown: "-24.1%"
            },
            history: [
                { date: "Jan", equity: 25000 },
                { date: "Feb", equity: 27000 },
                { date: "Mar", equity: 26000 },
                { date: "Apr", equity: 28000 },
                { date: "May", equity: 27000 },
                { date: "Jun", equity: 29000 },
                { date: "Jul", equity: 29450 }
            ],
            holdings: [
                { ticker: "AAPL", name: "Apple Inc.", shares: 150, avgCost: 145.00, currentPrice: 175.50 },
                { ticker: "TSLA", name: "Tesla Inc.", shares: 45, avgCost: 200.00, currentPrice: 185.20 },
                { ticker: "MSFT", name: "Microsoft", shares: 80, avgCost: 290.00, currentPrice: 420.00 }
            ]
        }
    }

    const currentData = portfolios[activeTab as keyof typeof portfolios]

    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
    }

    return (
        <div className="flex-1 space-y-6 p-8">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight text-base-900">Portfolio</h2>
                    <p className="text-base-500 mt-1">Track your performance and risk metrics.</p>
                </div>
                <Button variant="primary">Download Report</Button>
            </div>

            {/* Subportfolio Tabs */}
            <div className="flex space-x-2 border-b border-base-200 pb-px">
                {Object.keys(portfolios).map((tab) => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={cn(
                            "px-4 py-2 text-sm font-medium transition-colors border-b-2",
                            activeTab === tab
                                ? "border-primary-500 text-primary-600"
                                : "border-transparent text-base-500 hover:text-base-900 hover:border-base-300"
                        )}
                    >
                        {tab}
                    </button>
                ))}
            </div>

            {/* Top Stats */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <StatCard title="Total Equity" value={currentData.stats.equity} />
                <StatCard title="Unrealized P&L" value={currentData.stats.unrealized} trend={currentData.stats.unrealized.startsWith('-') ? 'down' : 'up'} changePercent={currentData.stats.unrealizedPercent} />
                <StatCard title="Realized P&L" value={currentData.stats.realized} trend={currentData.stats.realized.startsWith('-') ? 'down' : 'up'} />
                <StatCard title="Sharpe Ratio" value={currentData.stats.sharpe} trend="neutral" />
                <StatCard title="Sortino Ratio" value={currentData.stats.sortino} trend="neutral" />
                <StatCard title="Max Drawdown" value={currentData.stats.drawdown} trend="down" />
            </div>

            {/* Equity Curve Chart */}
            <Card>
                <CardHeader>
                    <CardTitle>{activeTab} Growth</CardTitle>
                    <CardDescription>Historical equity curve over the past 7 months.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="h-[350px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={currentData.history} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorEquity" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                <XAxis 
                                    dataKey="date" 
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: '#64748b', fontSize: 12 }}
                                    dy={10}
                                />
                                <YAxis 
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: '#64748b', fontSize: 12 }}
                                    tickFormatter={(value) => `$${value / 1000}k`}
                                />
                                <Tooltip 
                                    formatter={(value: any) => [formatCurrency(value as number), "Equity"]}
                                    contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                />
                                <Area 
                                    type="monotone" 
                                    dataKey="equity" 
                                    stroke="#10b981" 
                                    strokeWidth={3}
                                    fillOpacity={1} 
                                    fill="url(#colorEquity)" 
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </CardContent>
            </Card>

            {/* Holdings Table */}
            <Card>
                <CardHeader>
                    <CardTitle>{activeTab} Holdings</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm text-base-600">
                            <thead className="border-b border-base-200 bg-base-50/50 text-base-900">
                                <tr>
                                    <th className="px-4 py-3 font-semibold">Asset</th>
                                    <th className="px-4 py-3 font-semibold">Shares</th>
                                    <th className="px-4 py-3 font-semibold">Avg Cost</th>
                                    <th className="px-4 py-3 font-semibold">Current Price</th>
                                    <th className="px-4 py-3 font-semibold">Market Value</th>
                                    <th className="px-4 py-3 font-semibold">Total Return</th>
                                </tr>
                            </thead>
                            <tbody>
                                {currentData.holdings.map((h) => {
                                    const marketValue = h.shares * h.currentPrice
                                    const costBasis = h.shares * h.avgCost
                                    const totalReturn = marketValue - costBasis
                                    const returnPercent = (totalReturn / costBasis) * 100
                                    const isPositive = totalReturn >= 0

                                    return (
                                        <tr key={h.ticker} className="border-b border-base-100 hover:bg-base-50/50 transition-colors">
                                            <td className="px-4 py-3">
                                                <div className="font-medium text-base-900">{h.ticker}</div>
                                                <div className="text-xs text-base-500">{h.name}</div>
                                            </td>
                                            <td className="px-4 py-3">{h.shares}</td>
                                            <td className="px-4 py-3">${h.avgCost.toFixed(2)}</td>
                                            <td className="px-4 py-3">${h.currentPrice.toFixed(2)}</td>
                                            <td className="px-4 py-3 font-medium text-base-900">${marketValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                            <td className="px-4 py-3">
                                                <Badge variant={isPositive ? "success" : "error"}>
                                                    {isPositive ? "+" : ""}{totalReturn.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({returnPercent.toFixed(2)}%)
                                                </Badge>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}