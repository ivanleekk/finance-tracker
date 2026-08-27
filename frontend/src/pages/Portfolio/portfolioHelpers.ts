/**
 * Shapes and constants behind the Portfolio page.
 *
 * Split out of `Portfolio.tsx` so the page component is the page. Nothing here
 * depends on React or on the page's state.
 */

export type Holding = {
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

export const ALLOCATION_COLORS = ["#38bdf8", "#4ade80", "#fbbf24", "#e879f9", "#f472b6", "#a78bfa", "#fb923c", "#2dd4bf"];

export type PortfolioData = {
    stats: {
        equity: string;
        unrealized: string;
        unrealizedPercent: number;
        realized: string;
        sharpe: string;
        sortino: string;
        treynor: string;
        alpha: string;
        beta: string;
        drawdown: string;
        twr: string;
        irr: string;
        /** "Ann." vs "Period" — which basis the backend returned. */
        returnBasis: string;
    };
    history: any[];
    holdings: Holding[];
};


/**
 * Money formatter bound to a household's base currency.
 *
 * A factory rather than a component-local closure: both the page and
 * `usePortfolioData` format the same figures, and two copies of these options
 * would eventually disagree about decimal places.
 */
export function makeCurrencyFormatter(baseCurrency?: string) {
    return (val: number, code?: string) => new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: code || baseCurrency || "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(val)
}
