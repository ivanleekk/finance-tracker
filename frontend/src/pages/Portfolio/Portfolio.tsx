import { useState, useEffect, useMemo } from "react"
import { useLoaderData, useRevalidator, useNavigation, useSearchParams, Link } from "react-router"
import { StatCard } from "../../components/ui/StatCard"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../components/ui/Card"
import { Badge } from "../../components/ui/Badge"
import { Button } from "../../components/ui/Button"
import { Input } from "../../components/ui/Input"
import { Select } from "../../components/ui/Select"
import { cn } from "../../lib/utils"
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts"
import { useHousehold } from "../../lib/HouseholdContext"
import api from "../../lib/api"
import type { SubPortfolioResponse } from "../../types/types"
import type { PortfolioLoaderData } from "./portfolio.loader"
import { TimeframeSelector } from "../../components/ui/TimeframeSelector"
import { TopBar } from "../../components/TopBar"

export { portfolioLoader as loader } from "./portfolio.loader";

type Holding = {
    assetId: string;
    ticker: string;
    name: string;
    shares: number;
    avgCost: number; // Home currency
    currentPrice: number; // Home currency
    currency: string; // Ticker's base currency
    avgCostNative: number;
    currentPriceNative: number;
    assetType: string;
    pricingMode: "market" | "manual";
};

const ALLOCATION_COLORS = ["#38bdf8", "#4ade80", "#fbbf24", "#e879f9", "#f472b6", "#a78bfa", "#fb923c", "#2dd4bf"];

type PortfolioData = {
    stats: {
        equity: string;
        unrealized: string;
        unrealizedPercent: number;
        realized: string;
        sharpe: string;
        sortino: string;
        drawdown: string;
        twr: string;
        irr: string;
    };
    history: any[];
    holdings: Holding[];
};



export default function Portfolio() {
    const { activeHousehold } = useHousehold()
    const { subportfolios = [], trades = [], assets = [], snapshots = [], metrics = null, dividends = [], accounts = [] } = (useLoaderData() as PortfolioLoaderData) || {};
    const revalidator = useRevalidator()
    const navigation = useNavigation()
    const [searchParams] = useSearchParams()
    const startDate = searchParams.get("start_date")

    const formatCurrency = (val: number, code?: string) => new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: code || activeHousehold?.base_currency || 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(val);

    const formatCompactCurrency = (val: number) => new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: activeHousehold?.base_currency || 'USD',
        notation: 'compact',
        maximumFractionDigits: 1
    }).format(val);

    const [activeTab, setActiveTab] = useState("Overall")
    const [timeframe, setTimeframe] = useState("Monthly")
    const [isCreating, setIsCreating] = useState(false)
    const [newPortfolioName, setNewPortfolioName] = useState("")
    const [newPortfolioRisk, setNewPortfolioRisk] = useState("Moderate")
    const [newPortfolioTarget, setNewPortfolioTarget] = useState("")
    const [isSyncing, setIsSyncing] = useState(false)
    const [isEditing, setIsEditing] = useState(false)
    const [editName, setEditName] = useState("")
    const [editRisk, setEditRisk] = useState("Moderate")
    const [editTarget, setEditTarget] = useState("")
    const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null)
    const [isManagingCash, setIsManagingCash] = useState(false)
    const [cashDirection, setCashDirection] = useState<"deposit" | "withdraw">("deposit")
    const [cashAmount, setCashAmount] = useState("")
    const [cashAccountId, setCashAccountId] = useState("")
    const [cashDate, setCashDate] = useState(new Date().toISOString().split('T')[0])
    const [isSubmittingCash, setIsSubmittingCash] = useState(false)
    const [cashError, setCashError] = useState<string | null>(null)
    // Manual price recording for pricing_mode === "manual" assets (SSBs, unlisted bonds)
    const [priceHolding, setPriceHolding] = useState<Holding | null>(null)
    const [priceValue, setPriceValue] = useState("")
    const [priceDate, setPriceDate] = useState(new Date().toISOString().split('T')[0])
    const [isSubmittingPrice, setIsSubmittingPrice] = useState(false)
    const [priceError, setPriceError] = useState<string | null>(null)

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
                target_amount: newPortfolioTarget ? parseFloat(newPortfolioTarget) : null,
                household_id: activeHousehold.id
            });
            setIsCreating(false);
            setNewPortfolioName("");
            setNewPortfolioTarget("");
            setActiveTab(res.data.name);
            revalidator.revalidate(); // Re-fetch to get new portfolio in the loader data
        } catch (e) {
            console.error(e);
            alert("Failed to create sub-portfolio");
        }
    };

    const handleRecordPrice = async () => {
        if (!priceHolding || !activeHousehold) return;
        const parsed = parseFloat(priceValue);
        if (!parsed || parsed <= 0) {
            setPriceError("Enter a price greater than zero.");
            return;
        }
        setIsSubmittingPrice(true);
        setPriceError(null);
        try {
            await api.post(`/portfolio/assets/${priceHolding.assetId}/price`, {
                household_id: activeHousehold.id,
                date: priceDate,
                price: parsed,
            });
            setPriceHolding(null);
            setPriceValue("");
            revalidator.revalidate();
        } catch (e: any) {
            console.error(e);
            setPriceError(e.response?.data?.detail || "Failed to record price.");
        } finally {
            setIsSubmittingPrice(false);
        }
    };

    const handleUpdateSubPortfolio = async () => {
        const sp = subportfolios.find(s => s.name === activeTab);
        if (!sp || !editName.trim()) return;
        try {
            await api.patch(`/portfolio/subportfolios/${sp.id}`, {
                name: editName,
                risk_profile: editRisk,
                target_amount: editTarget ? parseFloat(editTarget) : null
            });
            setIsEditing(false);
            setActiveTab(editName);
            revalidator.revalidate();
        } catch (e) {
            console.error(e);
            alert("Failed to update sub-portfolio");
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

    const handleCashMove = async () => {
        const sp = subportfolios.find(s => s.name === activeTab);
        const account = accounts.find(a => a.id === cashAccountId);
        if (!sp || !activeHousehold || !account) return;
        const amount = parseFloat(cashAmount);
        if (!amount || amount <= 0) {
            setCashError("Enter an amount greater than zero.");
            return;
        }
        setIsSubmittingCash(true);
        setCashError(null);
        try {
            // Cash inherits the funding account's currency, so no FX conversion is needed here.
            await api.post(`/portfolio/subportfolios/${sp.id}/cash`, {
                household_id: activeHousehold.id,
                account_id: account.id,
                direction: cashDirection,
                amount,
                currency: account.currency || activeHousehold.base_currency || "USD",
                date: new Date(cashDate).toISOString(),
                exchange_rate: 1.0
            });
            setCashAmount("");
            setIsManagingCash(false);
            revalidator.revalidate();
        } catch (e: any) {
            console.error(e);
            setCashError(e.response?.data?.detail || "Failed to record cash movement.");
        } finally {
            setIsSubmittingCash(false);
        }
    };

    const handleSyncPortfolio = async () => {
        if (!activeHousehold) return;
        setIsSyncing(true);
        try {
            await api.post(`/portfolio/household/${activeHousehold.id}/sync`);
            // Record any dividends that went ex since the last sync
            await api.post(`/portfolio/household/${activeHousehold.id}/dividends/sync`);
            // Wait a bit for the background task to start/process
            setTimeout(() => {
                revalidator.revalidate();
                setIsSyncing(false);
            }, 1500);
        } catch (e) {
            console.error(e);
            alert("Failed to sync portfolio snapshots");
            setIsSyncing(false);
        }
    };

    const portfoliosData = useMemo(() => {
        const dataMap: Record<string, PortfolioData> = {};

        const binHistory = (history: any[]) => {
            if (timeframe === "Daily") return history;

            const binned = new Map<string, number>();
            history.forEach(item => {
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
                binned.set(key, item.equity);
            });

            return Array.from(binned.entries())
                .filter(([date]) => !startDate || date >= startDate)
                // ⚡ Bolt: Fast string comparison instead of localeCompare
                .sort((a, b) => (a[0] < b[0] ? -1 : (a[0] > b[0] ? 1 : 0)))
                .map(([date, equity]) => ({ date, equity }));
        };

        const computeStats = (hlds: Holding[], realizedPnL: number, history: any[], equity: number, m?: any): PortfolioData => {
            let costBasis = 0;
            for (const h of hlds) {
                costBasis += h.shares * h.avgCost;
            }
            const unrealized = equity - costBasis;
            const unrealizedPercent = costBasis > 0 ? (unrealized / costBasis) * 100 : 0;

            const formatPercent = (val: number) => `${(val * 100).toFixed(2)}%`;
            const sign = (val: number) => val >= 0 ? '+' : '';

            if (history.length === 0) {
                history = [{ date: new Date().toLocaleDateString('default', { month: 'short', day: 'numeric', year: 'numeric' }), equity: 0 }];
            }

            return {
                stats: {
                    equity: formatCurrency(equity),
                    unrealized: `${sign(unrealized)}${formatCurrency(Math.abs(unrealized))}`,
                    unrealizedPercent: (m?.simple_return ?? 0) * 100 || unrealizedPercent,
                    realized: `${sign(realizedPnL)}${formatCurrency(Math.abs(realizedPnL))}`,
                    sharpe: m?.sharpe_ratio !== undefined && m?.sharpe_ratio !== null ? m.sharpe_ratio.toFixed(2) : "N/A",
                    sortino: m?.sortino_ratio !== undefined && m?.sortino_ratio !== null ? m.sortino_ratio.toFixed(2) : "N/A",
                    drawdown: m?.volatility !== undefined && m?.volatility !== null ? formatPercent(m.volatility) : "N/A",
                    twr: m?.time_weighted_return !== undefined && m?.time_weighted_return !== null ? formatPercent(m.time_weighted_return) : "N/A",
                    irr: m?.money_weighted_return !== undefined && m?.money_weighted_return !== null ? formatPercent(m.money_weighted_return) : "N/A"
                },
                history,
                holdings: hlds
            };
        };

        const calculateFromSnapshots = (snaps: typeof snapshots) => {
            if (snaps.length === 0) return { holdings: [], realizedPnL: 0, history: [], currentEquity: 0 };

            const dailyEquity = new Map<string, number>();
            snaps.forEach(s => {
                const dateKey = typeof s.date === 'string' ? s.date.split('T')[0] : s.date;
                dailyEquity.set(dateKey, (dailyEquity.get(dateKey) || 0) + Number(s.current_value_home_currency));
            });

            const history = Array.from(dailyEquity.entries())
                // ⚡ Bolt: Fast string comparison instead of localeCompare
                .sort((a, b) => (a[0] < b[0] ? -1 : (a[0] > b[0] ? 1 : 0)))
                .map(([date, equity]) => ({
                    date,
                    equity
                }))
                .filter(item => !startDate || item.date >= startDate);

            // ⚡ Bolt Performance Optimization: Replace O(N log N) sorting with an O(N) single-pass reduce
            const datesArr = Array.from(dailyEquity.keys());
            const latestDate = datesArr.length > 0 ? datesArr.reduce((max, current) => current > max ? current : max, datesArr[0]) : null;
            const latestSnaps = snaps.filter(s => {
                const dateKey = typeof s.date === 'string' ? s.date.split('T')[0] : s.date;
                return dateKey === latestDate;
            });

            const assetMap = new Map(assets.map(a => [a.id, a]));
            const holdingMap = new Map<string, Holding>();

            latestSnaps
                .filter(s => s.quantity > 0.001)
                .forEach(s => {
                    const asset = assetMap.get(s.asset_id);
                    const ticker = asset?.ticker || "UNKNOWN";
                    const currency = asset?.currency || "USD";
                    
                    const currentPriceHome = Number(s.price) * (s.exchange_rate_used || 1.0);
                    const costBasisHome = Number(s.average_cost_basis_home_currency ?? (Number(s.average_cost_basis) * (s.exchange_rate_used || 1.0)));
                    const currentPriceNative = Number(s.price);
                    const costBasisNative = Number(s.average_cost_basis);

                    if (holdingMap.has(ticker)) {
                        const existing = holdingMap.get(ticker)!;
                        const totalShares = existing.shares + s.quantity;
                        
                        // Weighted average for home currency
                        const totalCostHome = (existing.shares * existing.avgCost) + (s.quantity * costBasisHome);
                        existing.avgCost = totalShares > 0 ? totalCostHome / totalShares : 0;
                        
                        // Weighted average for native currency
                        const totalCostNative = (existing.shares * existing.avgCostNative) + (s.quantity * costBasisNative);
                        existing.avgCostNative = totalShares > 0 ? totalCostNative / totalShares : 0;
                        
                        existing.shares = totalShares;
                        existing.currentPrice = currentPriceHome;
                        existing.currentPriceNative = currentPriceNative;
                    } else {
                        holdingMap.set(ticker, {
                            assetId: s.asset_id,
                            ticker: ticker,
                            name: asset?.name || "Unknown Asset",
                            shares: s.quantity,
                            avgCost: costBasisHome,
                            currentPrice: currentPriceHome,
                            currency: currency,
                            avgCostNative: costBasisNative,
                            currentPriceNative: currentPriceNative,
                            assetType: asset?.type || "other",
                            pricingMode: asset?.pricing_mode || "market"
                        });
                    }
                });

            const holdings: Holding[] = Array.from(holdingMap.values());

            const currentEquity = latestSnaps.reduce((sum, s) => sum + Number(s.current_value_home_currency), 0);

            return { holdings, realizedPnL: 0, history: binHistory(history), currentEquity };
        };

        // Overall
        const overallResult = calculateFromSnapshots(snapshots);
        dataMap["Overall"] = computeStats(
            overallResult.holdings,
            overallResult.realizedPnL,
            overallResult.history,
            overallResult.currentEquity,
            metrics?.overall_metrics
        );

        // Subportfolios
        for (const sp of subportfolios) {
            const spSnaps = snapshots.filter(s => s.sub_portfolio_id === sp.id);
            const spResult = calculateFromSnapshots(spSnaps);
            const spMetric = metrics?.sub_portfolio_metrics.find(m => m.sub_portfolio_id === sp.id);
            dataMap[sp.name] = computeStats(
                spResult.holdings,
                spResult.realizedPnL,
                spResult.history,
                spResult.currentEquity,
                spMetric?.metrics
            );
        }

        return dataMap;
    }, [snapshots, assets, subportfolios, timeframe, metrics]);

    // Dividends for the active tab (all sub-portfolios when "Overall"), newest first.
    // Kept above the early return so hook order stays stable across renders.
    const dividendData = useMemo(() => {
        const sp = subportfolios.find(s => s.name === activeTab);
        const assetById = new Map(assets.map(a => [a.id, a]));
        const relevant = dividends
            .filter(d => activeTab === "Overall" || d.sub_portfolio_id === sp?.id)
            .map(d => ({
                ...d,
                ticker: assetById.get(d.asset_id)?.ticker || "UNKNOWN",
                homeAmount: d.amount_home_currency ?? d.amount,
            }))
            .sort((a, b) => (a.date < b.date ? 1 : (a.date > b.date ? -1 : 0)));
        const total = relevant.reduce((sum, d) => sum + (Number(d.homeAmount) || 0), 0);
        return { rows: relevant, total };
    }, [dividends, assets, subportfolios, activeTab]);

    if (!activeHousehold) {
        return (
            <div className="flex-1 flex items-center justify-center p-8 text-base-500">
                Please select or create a household.
            </div>
        )
    }

    const isLoading = navigation.state === "loading" || revalidator.state === "loading";

    // Default to Overall if tab is deleted
    const rawData = portfoliosData[activeTab] || portfoliosData["Overall"];
    
    const sortedHoldings = useMemo(() => {
        if (!rawData.holdings) return [];
        const sortable = [...rawData.holdings];
        if (sortConfig !== null) {
            sortable.sort((a, b) => {
                let aValue: any;
                let bValue: any;

                switch (sortConfig.key) {
                    case 'asset': aValue = a.ticker; bValue = b.ticker; break;
                    case 'shares': aValue = a.shares; bValue = b.shares; break;
                    case 'avgCost': aValue = a.avgCost; bValue = b.avgCost; break;
                    case 'price': aValue = a.currentPrice; bValue = b.currentPrice; break;
                    case 'value': aValue = a.shares * a.currentPrice; bValue = b.shares * b.currentPrice; break;
                    case 'return': 
                        aValue = (a.shares * a.currentPrice) - (a.shares * a.avgCost);
                        bValue = (b.shares * b.currentPrice) - (b.shares * b.avgCost);
                        break;
                    default: aValue = 0; bValue = 0;
                }

                if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
                if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return sortable;
    }, [rawData.holdings, sortConfig]);

    const requestSort = (key: string) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const getSortIcon = (key: string) => {
        if (!sortConfig || sortConfig.key !== key) return <svg className="w-3 h-3 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" /></svg>;
        return sortConfig.direction === 'asc' 
            ? <svg className="w-3 h-3 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15l7-7 7 7" /></svg>
            : <svg className="w-3 h-3 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>;
    };

    const currentData = { ...rawData, holdings: sortedHoldings };
    const activeSubportfolioObj = subportfolios.find(sp => sp.name === activeTab);

    const allocationSlices = (() => {
        const byType = new Map<string, number>();
        let totalValue = 0;
        currentData.holdings.forEach(h => {
            const value = h.shares * h.currentPrice;
            totalValue += value;
            byType.set(h.assetType, (byType.get(h.assetType) || 0) + value);
        });
        return Array.from(byType.entries())
            .map(([type, value]) => ({ type, value, pct: totalValue > 0 ? (value / totalValue) * 100 : 0 }))
            .sort((a, b) => b.value - a.value);
    })();

    const fxExposure = (() => {
        const byCurrency = new Map<string, number>();
        let totalValue = 0;
        currentData.holdings.forEach(h => {
            const value = h.shares * h.currentPrice;
            totalValue += value;
            byCurrency.set(h.currency, (byCurrency.get(h.currency) || 0) + value);
        });
        return Array.from(byCurrency.entries())
            .map(([currency, value]) => ({ currency, pct: totalValue > 0 ? (value / totalValue) * 100 : 0 }))
            .sort((a, b) => b.pct - a.pct);
    })();

    // Uninvested cash held inside the active tab's sub-portfolio(s), in home currency.
    const cashValue = currentData.holdings
        .filter(h => h.assetType === "cash")
        .reduce((sum, h) => sum + h.shares * h.currentPrice, 0);

    // Metrics for the active tab (includes dividend_income / dividend_yield).
    const activeMetrics = activeTab === "Overall"
        ? metrics?.overall_metrics
        : metrics?.sub_portfolio_metrics?.find(m => m.sub_portfolio_id === activeSubportfolioObj?.id)?.metrics;

    return (
        <div className="flex-1 flex flex-col overflow-hidden relative">
            <TopBar
                title="Portfolio"
                commandPlaceholder="buy 10 VOO…"
                cta={
                    <Link to={`/trade${activeSubportfolioObj ? `?sub_portfolio_id=${activeSubportfolioObj.id}` : ""}`}>
                        <Button variant="cta">+ Add trade</Button>
                    </Link>
                }
            />
            <div className="flex-1 overflow-y-auto space-y-6 p-8 relative">
            {isLoading && (
                <div className="absolute top-4 right-8 z-10 flex items-center gap-2 text-sm text-base-500 bg-white/80 dark:bg-base-800/80 px-3 py-1 rounded-full border border-base-200 dark:border-base-800">
                    <div className="w-3 h-3 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
                    Updating...
                </div>
            )}
            <div className="flex items-center justify-between">
                <p className="text-base-500">Track your performance and risk metrics.</p>
                <div className="flex items-center gap-4">
                    <TimeframeSelector />
                    <div className="flex gap-2">
                        <Button
                            variant="secondary"
                            onClick={handleSyncPortfolio}
                            disabled={isSyncing}
                            className="flex items-center gap-2"
                        >
                            {isSyncing ? (
                                <div className="w-3 h-3 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
                            ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
                            )}
                            Sync
                        </Button>
                        <Button variant="secondary" onClick={() => revalidator.revalidate()}>Refresh</Button>
                        <Button variant="primary">Download Report</Button>
                    </div>
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
                                ? "border-primary-500 text-primary-600 dark:text-primary-400 bg-primary-50/50 dark:bg-primary-900/20"
                                : "border-transparent text-base-500 dark:text-base-400 hover:text-base-900 dark:hover:text-base-100 hover:bg-base-50 dark:hover:bg-base-800"
                        )}
                    >
                        {tab}
                    </button>
                ))}
                <button
                    onClick={() => setIsCreating(!isCreating)}
                    className={cn(
                        "px-3 py-1 text-sm font-medium transition-colors border rounded-md ml-2",
                        isCreating ? "border-secondary-500 text-secondary-600 dark:text-secondary-400 bg-secondary-50 dark:bg-secondary-900/20" : "border-base-200 dark:border-base-800 text-base-600 dark:text-base-400 hover:bg-base-50 dark:hover:bg-base-800"
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
                            <label className="text-sm font-medium text-base-900 dark:text-base-50">Risk Profile</label>
                            <Select
                                className="h-[42px]"
                                value={newPortfolioRisk}
                                onChange={setNewPortfolioRisk}
                                options={[
                                    { value: "Conservative", label: "Conservative" },
                                    { value: "Moderate", label: "Moderate" },
                                    { value: "Aggressive", label: "Aggressive" },
                                ]}
                            />
                        </div>
                        <div className="flex-1 space-y-2">
                            <Input
                                label="Target Amount"
                                type="number"
                                value={newPortfolioTarget}
                                onChange={e => setNewPortfolioTarget(e.target.value)}
                                placeholder="e.g. 100000"
                            />
                        </div>
                        <Button variant="primary" className="h-[42px]" onClick={handleCreateSubPortfolio}>Create</Button>
                        <Button variant="ghost" className="h-[42px]" onClick={() => setIsCreating(false)}>Cancel</Button>
                    </CardContent>
                </Card>
            )}

            {/* Portfolio Actions */}
            {activeTab !== "Overall" && !isCreating && activeSubportfolioObj && (
                <div className="flex justify-end gap-2">
                    <Button variant="secondary" onClick={() => {
                        setIsManagingCash(!isManagingCash);
                        setCashError(null);
                        if (!cashAccountId && accounts.length > 0) {
                            const defaultId = activeHousehold.default_funding_account_id;
                            setCashAccountId(defaultId && accounts.some(a => a.id === defaultId) ? defaultId : accounts[0].id);
                        }
                    }}>
                        {isManagingCash ? "Close Cash" : "Manage Cash"}
                    </Button>
                    <Button variant="secondary" onClick={() => {
                        setIsEditing(!isEditing);
                        setEditName(activeSubportfolioObj.name);
                        setEditRisk(activeSubportfolioObj.risk_profile);
                        setEditTarget(activeSubportfolioObj.target_amount?.toString() || "");
                    }}>
                        {isEditing ? "Cancel Edit" : "Edit Details"}
                    </Button>
                    <Button variant="danger" onClick={() => handleDeleteSubPortfolio(activeSubportfolioObj.id)}>
                        Delete {activeTab}
                    </Button>
                </div>
            )}

            {isManagingCash && activeSubportfolioObj && (
                <Card className="bg-emerald-50/30 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800 border-dashed">
                    <CardContent className="pt-6 space-y-4">
                        {cashError && (
                            <div className="p-3 rounded text-sm bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400">
                                {cashError}
                            </div>
                        )}
                        <div className="flex items-end gap-4 flex-wrap">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-base-900 dark:text-base-50">Action</label>
                                <Select
                                    className="h-[42px] w-36"
                                    value={cashDirection}
                                    onChange={(v) => setCashDirection(v as "deposit" | "withdraw")}
                                    options={[
                                        { value: "deposit", label: "Deposit" },
                                        { value: "withdraw", label: "Withdraw" },
                                    ]}
                                />
                            </div>
                            <div className="flex-1 min-w-[160px] space-y-2">
                                <label className="text-sm font-medium text-base-900 dark:text-base-50">
                                    {cashDirection === "deposit" ? "From Account" : "To Account"}
                                </label>
                                <Select
                                    className="h-[42px]"
                                    value={cashAccountId}
                                    onChange={setCashAccountId}
                                    placeholder="No accounts available"
                                    options={accounts.map(acc => ({ value: acc.id, label: `${acc.name} (${acc.currency})` }))}
                                />
                            </div>
                            <div className="flex-1 min-w-[120px] space-y-2">
                                <Input
                                    label={`Amount (${accounts.find(a => a.id === cashAccountId)?.currency || activeHousehold.base_currency || "USD"})`}
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    placeholder="0.00"
                                    value={cashAmount}
                                    onChange={e => setCashAmount(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Input
                                    label="Date"
                                    type="date"
                                    value={cashDate}
                                    onChange={e => setCashDate(e.target.value)}
                                />
                            </div>
                            <Button
                                variant="primary"
                                className="h-[42px]"
                                onClick={handleCashMove}
                                disabled={isSubmittingCash || accounts.length === 0}
                            >
                                {isSubmittingCash ? "Saving..." : (cashDirection === "deposit" ? "Deposit Cash" : "Withdraw Cash")}
                            </Button>
                        </div>
                        <p className="text-xs text-base-500 dark:text-base-400">
                            {cashDirection === "deposit"
                                ? `Moves cash from the selected account into ${activeTab}, where it counts toward the portfolio's value until you invest or withdraw it.`
                                : `Moves uninvested cash out of ${activeTab} back into the selected account.`}
                        </p>
                    </CardContent>
                </Card>
            )}

            {priceHolding && (
                <Card className="bg-secondary-50/30 dark:bg-secondary-900/10 border-secondary-200 dark:border-secondary-800 border-dashed">
                    <CardContent className="pt-6 space-y-4">
                        {priceError && (
                            <div className="p-3 rounded text-sm bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400">
                                {priceError}
                            </div>
                        )}
                        <div className="flex items-end gap-4 flex-wrap">
                            <div className="flex-1 min-w-[120px] space-y-2">
                                <Input
                                    label={`${priceHolding.ticker} price (${priceHolding.currency})`}
                                    type="number"
                                    step="0.0001"
                                    min="0"
                                    placeholder="0.00"
                                    value={priceValue}
                                    onChange={e => setPriceValue(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Input
                                    label="As of Date"
                                    type="date"
                                    value={priceDate}
                                    onChange={e => setPriceDate(e.target.value)}
                                />
                            </div>
                            <Button
                                variant="primary"
                                className="h-[42px]"
                                onClick={handleRecordPrice}
                                disabled={isSubmittingPrice}
                            >
                                {isSubmittingPrice ? "Saving..." : "Record Price"}
                            </Button>
                            <Button variant="ghost" className="h-[42px]" onClick={() => setPriceHolding(null)}>Cancel</Button>
                        </div>
                        <p className="text-xs text-base-500 dark:text-base-400">
                            {priceHolding.ticker} is priced manually. The recorded price applies from the chosen date forward until you record a newer one; valuations are recalculated immediately.
                        </p>
                    </CardContent>
                </Card>
            )}

            {isEditing && activeSubportfolioObj && (
                <Card className="bg-primary-50/30 border-primary-200 border-dashed">
                    <CardContent className="pt-6 flex items-end gap-4">
                        <div className="flex-1 space-y-2">
                            <Input
                                label="Name"
                                value={editName}
                                onChange={e => setEditName(e.target.value)}
                            />
                        </div>
                        <div className="flex-1 space-y-2">
                            <label className="text-sm font-medium text-base-900 dark:text-base-50">Risk Profile</label>
                            <Select
                                className="h-[42px]"
                                value={editRisk}
                                onChange={setEditRisk}
                                options={[
                                    { value: "Conservative", label: "Conservative" },
                                    { value: "Moderate", label: "Moderate" },
                                    { value: "Aggressive", label: "Aggressive" },
                                ]}
                            />
                        </div>
                        <div className="flex-1 space-y-2">
                            <Input
                                label="Target Amount"
                                type="number"
                                value={editTarget}
                                onChange={e => setEditTarget(e.target.value)}
                            />
                        </div>
                        <Button variant="primary" className="h-[42px]" onClick={handleUpdateSubPortfolio}>Save Changes</Button>
                    </CardContent>
                </Card>
            )}

            {/* Top Stats */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
                <StatCard title="Total Equity" value={currentData.stats.equity} />
                {cashValue > 0 && (
                    <StatCard title="Cash" value={formatCurrency(cashValue)} trend="neutral" description="Uninvested cash" />
                )}
                <StatCard title="Unrealized P&L" value={currentData.stats.unrealized} trend={currentData.stats.unrealized.startsWith('-') ? 'down' : 'up'} changePercent={currentData.stats.unrealizedPercent} />
                <StatCard title="TWR (Ann.)" value={currentData.stats.twr} trend={currentData.stats.twr.startsWith('-') ? 'down' : 'up'} />
                <StatCard title="IRR / MWR" value={currentData.stats.irr} trend={currentData.stats.irr.startsWith('-') ? 'down' : 'up'} />
                <StatCard title="Div Yield" value={activeMetrics?.dividend_yield != null ? `${(activeMetrics.dividend_yield * 100).toFixed(1)}%` : "—"} />
                {activeSubportfolioObj?.target_amount && (
                    <StatCard 
                        title="Goal Progress" 
                        value={`${((parseFloat(currentData.stats.equity.replace(/[^0-9.-]+/g,"")) / activeSubportfolioObj.target_amount) * 100).toFixed(1)}%`} 
                        trend="neutral"
                        description={`Target: ${formatCurrency(activeSubportfolioObj.target_amount)}`}
                    />
                )}
                <StatCard title="Sharpe Ratio" value={currentData.stats.sharpe} trend="neutral" />
            </div>

            {/* Equity Curve Chart */}
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                    <div>
                        <CardTitle>{activeTab} Growth</CardTitle>
                        <CardDescription>Historical equity curve based on latest evaluation.</CardDescription>
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
                <CardContent>
                    <div className="h-[350px] w-full relative min-h-0">
                        <ResponsiveContainer width="100%" height="100%" minHeight={350}>
                            <AreaChart data={currentData.history} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorEquity" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-base-200)" className="dark:opacity-10" />
                                <XAxis
                                    dataKey="date"
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: '#64748b', fontSize: 12 }}
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
                                                                    {activeTab} Equity
                                                                </span>
                                                                <span className="text-sm font-bold text-base-900 dark:text-base-50">
                                                                    {formatCurrency(entry.value)}
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            );
                                        }
                                        return null;
                                    }}
                                />
                                <Area
                                    type="monotone"
                                    dataKey="equity"
                                    stroke="var(--color-primary-500)"
                                    strokeWidth={3}
                                    fillOpacity={1}
                                    fill="url(#colorEquity)"
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </CardContent>
            </Card>

            {/* Allocation + Holdings */}
            <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6 items-start">
            <Card>
                <CardHeader>
                    <CardTitle>Allocation</CardTitle>
                </CardHeader>
                <CardContent>
                    {allocationSlices.length > 0 ? (
                        <>
                            <div className="flex justify-center mb-4">
                                <div
                                    className="w-[130px] h-[130px] rounded-full flex items-center justify-center"
                                    style={{
                                        background: `conic-gradient(${(() => {
                                            let acc = 0;
                                            return allocationSlices.map((s, i) => {
                                                const start = acc;
                                                acc += s.pct;
                                                return `${ALLOCATION_COLORS[i % ALLOCATION_COLORS.length]} ${start}% ${acc}%`;
                                            }).join(", ");
                                        })()})`,
                                    }}
                                >
                                    <div className="w-20 h-20 rounded-full bg-white dark:bg-base-900 flex flex-col items-center justify-center">
                                        <div className="font-mono font-bold text-base-900 dark:text-base-50">{currentData.holdings.length}</div>
                                        <div className="font-mono text-[8px] text-base-500">holdings</div>
                                    </div>
                                </div>
                            </div>
                            <div className="space-y-2 mb-4">
                                {allocationSlices.map((s, i) => (
                                    <div key={s.type} className="flex items-center gap-2">
                                        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: ALLOCATION_COLORS[i % ALLOCATION_COLORS.length] }} />
                                        <span className="flex-1 text-xs text-base-700 dark:text-base-300 capitalize">{s.type.replace('_', ' ')}</span>
                                        <span className="font-mono text-xs text-base-500">{s.pct.toFixed(0)}%</span>
                                    </div>
                                ))}
                            </div>
                            <div className="border-t border-base-100 dark:border-base-800 pt-3">
                                <div className="text-[10px] font-mono uppercase tracking-wider text-base-400 mb-2">FX exposure</div>
                                <div className="flex flex-wrap gap-2">
                                    {fxExposure.map(fx => (
                                        <span key={fx.currency} className="flex-1 text-center bg-base-100 dark:bg-base-800 rounded-lg py-1.5 font-mono text-xs font-semibold text-base-700 dark:text-base-300">
                                            {fx.currency} {fx.pct.toFixed(0)}%
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="text-sm text-base-500 text-center py-8">No holdings yet.</div>
                    )}
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle>{activeTab} Holdings</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm text-base-600 dark:text-base-400">
                            <thead className="border-b border-base-200 dark:border-base-800 bg-base-50/50 dark:bg-base-900/50 text-base-900 dark:text-base-50">
                                <tr>
                                    <th className="px-4 py-3 font-semibold cursor-pointer hover:bg-base-100/50 transition-colors" onClick={() => requestSort('asset')}>
                                        <div className="flex items-center gap-2">Asset {getSortIcon('asset')}</div>
                                    </th>
                                    <th className="px-4 py-3 font-semibold cursor-pointer hover:bg-base-100/50 transition-colors text-right" onClick={() => requestSort('shares')}>
                                        <div className="flex items-center justify-end gap-2">Shares {getSortIcon('shares')}</div>
                                    </th>
                                    <th className="px-4 py-3 font-semibold cursor-pointer hover:bg-base-100/50 transition-colors text-right" onClick={() => requestSort('avgCost')}>
                                        <div className="flex items-center justify-end gap-2">Avg Cost {getSortIcon('avgCost')}</div>
                                    </th>
                                    <th className="px-4 py-3 font-semibold cursor-pointer hover:bg-base-100/50 transition-colors text-right" onClick={() => requestSort('price')}>
                                        <div className="flex items-center justify-end gap-2">Price {getSortIcon('price')}</div>
                                    </th>
                                    <th className="px-4 py-3 font-semibold cursor-pointer hover:bg-base-100/50 transition-colors text-right" onClick={() => requestSort('value')}>
                                        <div className="flex items-center justify-end gap-2">Value {getSortIcon('value')}</div>
                                    </th>
                                    <th className="px-4 py-3 font-semibold cursor-pointer hover:bg-base-100/50 transition-colors text-right" onClick={() => requestSort('return')}>
                                        <div className="flex items-center justify-end gap-2">Return {getSortIcon('return')}</div>
                                    </th>
                                    <th className="px-4 py-3 font-semibold"></th>
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
                                    const marketValueHome = h.shares * h.currentPrice;
                                    const marketValueNative = h.shares * h.currentPriceNative;
                                    const costBasisHome = h.shares * h.avgCost;
                                    const totalReturnHome = marketValueHome - costBasisHome;
                                    const returnPercent = costBasisHome > 0 ? (totalReturnHome / costBasisHome) * 100 : 0;
                                    const isPositive = totalReturnHome >= 0;

                                    return (
                                        <tr key={h.ticker} className="border-b border-base-100 dark:border-base-800 hover:bg-base-50/50 dark:hover:bg-base-900/50 transition-colors">
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2">
                                                    <div className="font-medium text-base-900 dark:text-base-50">{h.ticker}</div>
                                                    <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4 bg-base-100 dark:bg-base-800 text-base-500 border-none uppercase">
                                                        {h.currency}
                                                    </Badge>
                                                </div>
                                                <div className="text-xs text-base-500 dark:text-base-400">{h.name}</div>
                                            </td>
                                            <td className="px-4 py-3 text-right">{h.shares.toLocaleString()}</td>
                                            <td className="px-4 py-3 text-right">
                                                <div className="text-sm font-medium text-base-900 dark:text-base-50">{formatCurrency(h.currentPriceNative, h.currency)}</div>
                                                <div className="text-[10px] text-base-400 dark:text-base-500">
                                                    ≈ {formatCurrency(h.currentPrice)}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <div className="text-sm text-base-600 dark:text-base-300">{formatCurrency(h.avgCostNative, h.currency)}</div>
                                                <div className="text-[10px] text-base-400 dark:text-base-500">
                                                    ≈ {formatCurrency(h.avgCost)}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-right font-medium">
                                                <div className="text-base-900 dark:text-base-50">{formatCurrency(marketValueHome)}</div>
                                                {h.currency !== activeHousehold.base_currency && (
                                                    <div className="text-[10px] text-base-400 dark:text-base-500 font-normal">
                                                        {formatCurrency(marketValueNative, h.currency)}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                {h.assetType === "cash" ? (
                                                    <span className="text-base-400">—</span>
                                                ) : (
                                                    <Badge variant={isPositive ? "success" : "error"}>
                                                        {isPositive ? "+" : ""}{formatCurrency(totalReturnHome)} ({returnPercent.toFixed(2)}%)
                                                    </Badge>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                {h.assetType === "cash" ? (
                                                    activeSubportfolioObj && (
                                                        <Button variant="ghost" size="sm" onClick={() => {
                                                            setIsManagingCash(true);
                                                            setCashError(null);
                                                            if (!cashAccountId && accounts.length > 0) setCashAccountId(accounts[0].id);
                                                        }}>
                                                            Manage
                                                        </Button>
                                                    )
                                                ) : (
                                                    <div className="flex items-center justify-end gap-1">
                                                        {h.pricingMode === "manual" && (
                                                            <Button variant="ghost" size="sm" className="text-secondary-600 dark:text-secondary-400" onClick={() => {
                                                                setPriceHolding(h);
                                                                setPriceValue(h.currentPriceNative > 0 ? String(h.currentPriceNative) : "");
                                                                setPriceDate(new Date().toISOString().split('T')[0]);
                                                                setPriceError(null);
                                                            }}>
                                                                Price
                                                            </Button>
                                                        )}
                                                        <Link to={`/trade?ticker=${h.ticker}${activeSubportfolioObj ? `&sub_portfolio_id=${activeSubportfolioObj.id}` : ""}`}>
                                                            <Button variant="ghost" size="sm">Trade</Button>
                                                        </Link>
                                                    </div>
                                                )}
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

            {/* Dividend Income */}
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                    <div>
                        <CardTitle>{activeTab} Dividend Income</CardTitle>
                        <CardDescription>Automatically tracked from your holdings.</CardDescription>
                    </div>
                    <div className="flex items-center gap-6">
                        {activeMetrics?.dividend_yield != null && activeMetrics.dividend_yield > 0 && (
                            <div className="text-right">
                                <div className="text-xs text-base-500 dark:text-base-400">Trailing yield</div>
                                <div className="text-lg font-semibold text-base-900 dark:text-base-50">
                                    {(activeMetrics.dividend_yield * 100).toFixed(2)}%
                                </div>
                            </div>
                        )}
                        <div className="text-right">
                            <div className="text-xs text-base-500 dark:text-base-400">Total received</div>
                            <div className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">
                                {formatCurrency(dividendData.total)}
                            </div>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm text-base-600 dark:text-base-400">
                            <thead className="border-b border-base-200 dark:border-base-800 bg-base-50/50 dark:bg-base-900/50 text-base-900 dark:text-base-50">
                                <tr>
                                    <th className="px-4 py-3 font-semibold">Date</th>
                                    <th className="px-4 py-3 font-semibold">Asset</th>
                                    <th className="px-4 py-3 font-semibold text-right">Per Share</th>
                                    <th className="px-4 py-3 font-semibold text-right">Shares</th>
                                    <th className="px-4 py-3 font-semibold text-right">Amount</th>
                                </tr>
                            </thead>
                            <tbody>
                                {dividendData.rows.length === 0 && (
                                    <tr>
                                        <td colSpan={5} className="px-4 py-8 text-center text-base-500">
                                            No dividends recorded yet. Click Sync to fetch payouts for your holdings.
                                        </td>
                                    </tr>
                                )}
                                {dividendData.rows.map((d) => (
                                    <tr key={d.id} className="border-b border-base-100 dark:border-base-800 hover:bg-base-50/50 dark:hover:bg-base-900/50 transition-colors">
                                        <td className="px-4 py-3 whitespace-nowrap">{new Date(d.date).toLocaleDateString()}</td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium text-base-900 dark:text-base-50">{d.ticker}</span>
                                                {d.is_manual && (
                                                    <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4 bg-base-100 dark:bg-base-800 text-base-500 border-none uppercase">
                                                        Manual
                                                    </Badge>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-right">{d.per_share_amount != null ? formatCurrency(Number(d.per_share_amount)) : "—"}</td>
                                        <td className="px-4 py-3 text-right">{d.quantity != null ? Number(d.quantity).toLocaleString() : "—"}</td>
                                        <td className="px-4 py-3 text-right font-medium text-emerald-600 dark:text-emerald-400">
                                            +{formatCurrency(Number(d.homeAmount))}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>
            </div>
        </div>
    )
}
