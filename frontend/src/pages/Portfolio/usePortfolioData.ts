import { useMemo } from "react"
import type { SubPortfolioResponse } from "../../types/types"
import type { PortfolioLoaderData } from "./portfolio.loader"
import { makeCurrencyFormatter, type Holding, type PortfolioData } from "./portfolioHelpers"
import { returnBasis } from "../../lib/utils"

type Options = {
    latestSnapshots: PortfolioLoaderData["latestSnapshots"]
    timeseries: PortfolioLoaderData["timeseries"]
    assets: PortfolioLoaderData["assets"]
    subportfolios: SubPortfolioResponse[]
    metrics: PortfolioLoaderData["metrics"]
    dividends: PortfolioLoaderData["dividends"]
    baseCurrency: string | undefined
    startDate: string | null
    activeTab: string
    timeframe: string
    sortConfig: { key: string; direction: "asc" | "desc" } | null
}

/**
 * The Portfolio page's view model: per-tab stats and equity curve, the dividend
 * series, and the holdings table in its current sort order.
 *
 * This was ~220 lines of `useMemo` sitting between the page's event handlers and
 * its JSX. Snapshots, trades and metrics arrive in three different shapes and
 * have to be reconciled per sub-portfolio tab before anything can render, which
 * is genuinely intricate — and much easier to follow when it is not interleaved
 * with the markup that consumes it.
 */
export function usePortfolioData({
    latestSnapshots,
    timeseries,
    assets,
    subportfolios,
    metrics,
    dividends,
    baseCurrency,
    startDate,
    activeTab,
    timeframe,
    sortConfig,
}: Options) {
    const formatCurrency = makeCurrencyFormatter(baseCurrency)

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
                    treynor: m?.treynor_ratio !== undefined && m?.treynor_ratio !== null ? m.treynor_ratio.toFixed(2) : "N/A",
                    alpha: m?.alpha !== undefined && m?.alpha !== null ? formatPercent(m.alpha) : "N/A",
                    beta: m?.beta !== undefined && m?.beta !== null ? m.beta.toFixed(2) : "N/A",
                    drawdown: m?.volatility !== undefined && m?.volatility !== null ? formatPercent(m.volatility) : "N/A",
                    twr: m?.time_weighted_return !== undefined && m?.time_weighted_return !== null ? formatPercent(m.time_weighted_return) : "N/A",
                    irr: m?.money_weighted_return !== undefined && m?.money_weighted_return !== null ? formatPercent(m.money_weighted_return) : "N/A",
                    returnBasis: returnBasis(m?.annualized)
                },
                history,
                holdings: hlds
            };
        };

        // Equity curve from pre-aggregated (date, sub_portfolio) totals — already summed
        // across assets server-side, so this just sorts/bins/windows.
        const buildHistory = (points: typeof timeseries) => {
            const history = points
                .slice()
                .sort((a, b) => (a.date < b.date ? -1 : (a.date > b.date ? 1 : 0)))
                .map(t => ({ date: t.date, equity: Number(t.total_value_home_currency) }))
                .filter(item => !startDate || item.date >= startDate);
            return binHistory(history);
        };

        // Holdings table from the latest-date-only per-asset rows (server-filtered via
        // latest_only=true, so every row here is already "current").
        const buildHoldings = (latestSnaps: typeof latestSnapshots) => {
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

            return { holdings, currentEquity };
        };

        // Overall
        const overallHoldings = buildHoldings(latestSnapshots);
        dataMap["Overall"] = computeStats(
            overallHoldings.holdings,
            0,
            buildHistory(timeseries),
            overallHoldings.currentEquity,
            metrics?.overall_metrics
        );

        // Subportfolios
        for (const sp of subportfolios) {
            const spHoldings = buildHoldings(latestSnapshots.filter(s => s.sub_portfolio_id === sp.id));
            const spMetric = metrics?.sub_portfolio_metrics.find(m => m.sub_portfolio_id === sp.id);
            dataMap[sp.name] = computeStats(
                spHoldings.holdings,
                0,
                buildHistory(timeseries.filter(t => t.sub_portfolio_id === sp.id)),
                spHoldings.currentEquity,
                spMetric?.metrics
            );
        }

        return dataMap;
    }, [latestSnapshots, timeseries, assets, subportfolios, timeframe, metrics, startDate]);

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
    return { portfoliosData, dividendData, sortedHoldings, rawData }
}
