import { useState, useEffect, useMemo } from "react"
import { useLoaderData, useRevalidator, useNavigation } from "react-router"
import { StatCard } from "../../components/ui/StatCard"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../components/ui/Card"
import { Badge } from "../../components/ui/Badge"
import { Button } from "../../components/ui/Button"
import { Input } from "../../components/ui/Input"
import { cn } from "../../lib/utils"
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts"
import { useHousehold } from "../../lib/HouseholdContext"
import api from "../../lib/api"
import type { SubPortfolioResponse } from "../../types/types"
import type { PortfolioLoaderData } from "./portfolio.loader"

export { portfolioLoader as loader } from "./portfolio.loader";

type Holding = {
    assetId: string;
    ticker: string;
    name: string;
    shares: number;
    avgCost: number;
    currentPrice: number;
};

type PortfolioData = {
    stats: {
        equity: string;
        unrealized: string;
        unrealizedPercent: number;
        realized: string;
        sharpe: string;
        sortino: string;
        drawdown: string;
    };
    history: any[];
    holdings: Holding[];
};



export default function Portfolio() {
    const { activeHousehold } = useHousehold()
    const { subportfolios = [], trades = [], assets = [], snapshots = [] } = (useLoaderData() as PortfolioLoaderData) || {};
    const revalidator = useRevalidator()
    const navigation = useNavigation()

    const [activeTab, setActiveTab] = useState("Overall")
    const [isCreating, setIsCreating] = useState(false)
    const [newPortfolioName, setNewPortfolioName] = useState("")
    const [newPortfolioRisk, setNewPortfolioRisk] = useState("Moderate")

    // Revalidate data when active household changes
    useEffect(() => {
        if (activeHousehold?.id && revalidator.state === "idle") {
            revalidator.revalidate()
        }
    }, [activeHousehold?.id])

    const handleCreateSubPortfolio = async () => {
        if (!newPortfolioName.trim() || !activeHousehold) return;
        try {
            const res = await api.post<SubPortfolioResponse>('/portfolio/subportfolios', {
                name: newPortfolioName,
                risk_profile: newPortfolioRisk,
                household_id: activeHousehold.id
            });
            setIsCreating(false);
            setNewPortfolioName("");
            setActiveTab(res.data.name);
            revalidator.revalidate(); // Re-fetch to get new portfolio in the loader data
        } catch (e) {
            console.error(e);
            alert("Failed to create sub-portfolio");
        }
    };

    const handleDeleteSubPortfolio = async (id: string) => {
        if (!window.confirm("Are you sure you want to delete this sub-portfolio?")) return;
        try {
            await api.delete(`/portfolio/subportfolios/${id}`);
            if (activeTab !== "Overall") {
                setActiveTab("Overall");
            }
            revalidator.revalidate();
        } catch (e) {
            console.error(e);
            alert("Failed to delete sub-portfolio. It might have associated trades.");
        }
    };

    const portfoliosData = useMemo(() => {
        const dataMap: Record<string, PortfolioData> = {};

        const computeStats = (hlds: Holding[], realizedPnL: number, history: any[], equity: number): PortfolioData => {
            let costBasis = 0;
            for (const h of hlds) {
                costBasis += h.shares * h.avgCost;
            }
            const unrealized = equity - costBasis;
            const unrealizedPercent = costBasis > 0 ? (unrealized / costBasis) * 100 : 0;

            const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
            const sign = (val: number) => val >= 0 ? '+' : '';

            if (history.length === 0) {
                history = [{ date: new Date().toLocaleDateString('default', { month: 'short', day: 'numeric', year: 'numeric' }), equity: 0 }];
            }

            return {
                stats: {
                    equity: formatCurrency(equity),
                    unrealized: `${sign(unrealized)}${formatCurrency(Math.abs(unrealized))}`,
                    unrealizedPercent: unrealizedPercent,
                    realized: `${sign(realizedPnL)}${formatCurrency(Math.abs(realizedPnL))}`,
                    sharpe: "N/A",
                    sortino: "N/A",
                    drawdown: "N/A"
                },
                history,
                holdings: hlds
            };
        };

        const calculateFromSnapshots = (snaps: typeof snapshots) => {
            if (snaps.length === 0) return { holdings: [], realizedPnL: 0, history: [], currentEquity: 0 };
            
            // 1. History (Aggregated by Date)
            const dailyEquity = new Map<string, number>();
            snaps.forEach(s => {
                const dateKey = typeof s.date === 'string' ? s.date.split('T')[0] : s.date;
                dailyEquity.set(dateKey, (dailyEquity.get(dateKey) || 0) + Number(s.current_value_home_currency));
            });
            
            const history = Array.from(dailyEquity.entries())
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([date, equity]) => ({
                    date, // Keep ISO string as the unique key
                    equity
                }));

            // 2. Current Holdings (from the most recent snapshot date)
            const sortedDates = Array.from(dailyEquity.keys()).sort((a, b) => a.localeCompare(b));
            const latestDate = sortedDates[sortedDates.length - 1];
            const latestSnaps = snaps.filter(s => s.date === latestDate);
            
            const assetMap = new Map(assets.map(a => [a.id, a]));
            const holdings: Holding[] = latestSnaps
                .filter(s => s.quantity > 0.001)
                .map(s => {
                    const asset = assetMap.get(s.asset_id);
                    return {
                        assetId: s.asset_id,
                        ticker: asset?.ticker || "UNKNOWN",
                        name: asset?.name || "Unknown Asset",
                        shares: s.quantity,
                        avgCost: Number(s.averge_cost_basis),
                        currentPrice: Number(s.price)
                    };
                });
            
            const currentEquity = latestSnaps.reduce((sum, s) => sum + Number(s.current_value_home_currency), 0);
            
            return { holdings, realizedPnL: 0, history, currentEquity };
        };

        // Overall
        const overallResult = calculateFromSnapshots(snapshots);
        dataMap["Overall"] = computeStats(overallResult.holdings, overallResult.realizedPnL, overallResult.history, overallResult.currentEquity);

        // Subportfolios
        for (const sp of subportfolios) {
            const spSnaps = snapshots.filter(s => s.sub_portfolio_id === sp.id);
            const spResult = calculateFromSnapshots(spSnaps);
            dataMap[sp.name] = computeStats(spResult.holdings, spResult.realizedPnL, spResult.history, spResult.currentEquity);
        }

        return dataMap;
    }, [snapshots, assets, subportfolios]);

    if (!activeHousehold) {
        return (
            <div className="flex-1 flex items-center justify-center p-8 text-base-500">
                Please select or create a household.
            </div>
        )
    }

    const isLoading = navigation.state === "loading" || revalidator.state === "loading";

    // Default to Overall if tab is deleted
    const currentData = portfoliosData[activeTab] || portfoliosData["Overall"];
    const activeSubportfolioObj = subportfolios.find(sp => sp.name === activeTab);

    return (
        <div className="flex-1 space-y-6 p-8 relative">
            {isLoading && (
                <div className="absolute top-4 right-8 z-10 flex items-center gap-2 text-sm text-base-500 bg-white/80 px-3 py-1 rounded-full border border-base-200">
                    <div className="w-3 h-3 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
                    Updating...
                </div>
            )}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight text-base-900">Portfolio</h2>
                    <p className="text-base-500 mt-1">Track your performance and risk metrics.</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => revalidator.revalidate()}>Refresh</Button>
                    <Button variant="primary">Download Report</Button>
                </div>
            </div>

            {/* Subportfolio Tabs */}
            <div className="flex flex-wrap gap-2 items-center border-b border-base-200 pb-2">
                {Object.keys(portfoliosData).map((tab) => (
                    <button
                        key={tab}
                        onClick={() => {
                            setActiveTab(tab);
                            setIsCreating(false);
                        }}
                        className={cn(
                            "px-4 py-2 text-sm font-medium transition-colors border-b-2 rounded-t-md",
                            activeTab === tab && !isCreating
                                ? "border-primary-500 text-primary-600 bg-primary-50/50"
                                : "border-transparent text-base-500 hover:text-base-900 hover:bg-base-50"
                        )}
                    >
                        {tab}
                    </button>
                ))}
                <button
                    onClick={() => setIsCreating(!isCreating)}
                    className={cn(
                        "px-3 py-1 text-sm font-medium transition-colors border rounded-md ml-2",
                        isCreating ? "border-primary-500 text-primary-600 bg-primary-50" : "border-base-200 text-base-600 hover:bg-base-50"
                    )}
                >
                    + New
                </button>
            </div>

            {isCreating && (
                <Card className="bg-base-50 border-dashed">
                    <CardContent className="pt-6 flex items-end gap-4">
                        <div className="flex-1 space-y-2">
                            <Input
                                label="Sub-Portfolio Name"
                                value={newPortfolioName}
                                onChange={e => setNewPortfolioName(e.target.value)}
                                placeholder="e.g. Retirement, Trading"
                            />
                        </div>
                        <div className="flex-1 space-y-2">
                            <label className="text-sm font-medium text-base-900">Risk Profile</label>
                            <select
                                className="w-full rounded-md border border-base-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 h-[42px]"
                                value={newPortfolioRisk}
                                onChange={e => setNewPortfolioRisk(e.target.value)}
                            >
                                <option value="Conservative">Conservative</option>
                                <option value="Moderate">Moderate</option>
                                <option value="Aggressive">Aggressive</option>
                            </select>
                        </div>
                        <Button variant="primary" className="h-[42px]" onClick={handleCreateSubPortfolio}>Create</Button>
                        <Button variant="ghost" className="h-[42px]" onClick={() => setIsCreating(false)}>Cancel</Button>
                    </CardContent>
                </Card>
            )}

            {/* Portfolio Actions */}
            {activeTab !== "Overall" && !isCreating && activeSubportfolioObj && (
                <div className="flex justify-end">
                    <Button variant="danger" onClick={() => handleDeleteSubPortfolio(activeSubportfolioObj.id)}>
                        Delete {activeTab}
                    </Button>
                </div>
            )}

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
                    <CardDescription>Historical equity curve based on latest evaluation.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="h-[350px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={currentData.history} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorEquity" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                <XAxis
                                    dataKey="date"
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: '#64748b', fontSize: 12 }}
                                    tickFormatter={(val) => new Date(val).toLocaleDateString('default', { month: 'short', day: 'numeric', timeZone: 'UTC' })}
                                    dy={10}
                                />
                                <YAxis
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: '#64748b', fontSize: 12 }}
                                    tickFormatter={(value) => `$${value / 1000}k`}
                                />
                                <Tooltip
                                    labelFormatter={(label) => new Date(label).toLocaleDateString('default', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}
                                    formatter={(value: any) => [new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value as number), "Total Equity"]}
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
                                {currentData.holdings.length === 0 && (
                                    <tr>
                                        <td colSpan={6} className="px-4 py-8 text-center text-base-500">
                                            No active holdings. Execute some trades to build your portfolio.
                                        </td>
                                    </tr>
                                )}
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
