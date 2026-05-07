import { useState, useMemo } from "react"
import { useLoaderData, useNavigation, useRevalidator } from "react-router"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/Card"
import { Badge } from "../../components/ui/Badge"
import { Button } from "../../components/ui/Button"
import { ArrowUpRight, ArrowDownRight, ArrowRightLeft, Trash2 } from "lucide-react"
import { useHousehold } from "../../lib/HouseholdContext"
import api from "../../lib/api"
import type { HistoryLoaderData } from "./history.loader"

export { historyLoader as loader } from "./history.loader";

type UnifiedHistoryItem = {
    id: string;
    type: string; // 'buy', 'sell', 'deposit', 'withdrawal', 'income', 'expense'
    categoryType: 'trade' | 'transaction';
    assetOrCategory: string;
    amount: number;
    shares: number | null;
    date: Date;
    status: string;
    accountId: string;
    accountName: string;
    subportfolioId: string | null;
    subportfolioName: string | null;
    householdName: string;
};

export default function History() {
    const { activeHousehold } = useHousehold()
    const { trades = [], transactions = [], assets = [], categories = [], accounts = [], subportfolios = [] } = (useLoaderData() as HistoryLoaderData) || {};
    const navigation = useNavigation()
    const revalidator = useRevalidator()

    const [filterCategory, setFilterCategory] = useState<string>("all")
    const [filterAccount, setFilterAccount] = useState<string>("all")
    const [filterSubportfolio, setFilterSubportfolio] = useState<string>("all")

    const [isDeleting, setIsDeleting] = useState<string | null>(null);

    if (!activeHousehold) {
        return (
            <div className="flex-1 flex items-center justify-center p-8 text-base-500">
                Please select or create a household.
            </div>
        )
    }

    const handleDelete = async (item: UnifiedHistoryItem) => {
        if (!window.confirm(`Are you sure you want to delete this ${item.categoryType}? This action cannot be undone.`)) return;
        
        setIsDeleting(item.id);
        try {
            const endpoint = item.categoryType === 'trade' 
                ? `/portfolio/trades/${item.id.replace('trade-', '')}` 
                : `/cashflow/transactions/${item.id.replace('tx-', '')}`;
            
            await api.delete(endpoint);
            revalidator.revalidate();
        } catch (error) {
            console.error("Failed to delete item", error);
            alert("Failed to delete item. Please try again.");
        } finally {
            setIsDeleting(null);
        }
    };

    const isLoading = navigation.state === "loading";

    const combinedHistory = useMemo(() => {
        // Maps for O(1) lookups
        const assetMap = new Map(assets.map(a => [a.id, a.ticker]));
        const categoryMap = new Map(categories.map(c => [c.id, c.name]));
        const accountMap = new Map(accounts.map(a => [a.id, a.name]));
        const subportfolioMap = new Map(subportfolios.map(sp => [sp.id, sp.name]));

        // 1. Process Trades
        const tradeItems: UnifiedHistoryItem[] = trades.map(t => {
            const ticker = assetMap.get(t.asset_id) || "UNKNOWN";
            const accountName = accountMap.get(t.account_id) || "Unknown Account";
            const spName = t.sub_portfolio_id ? (subportfolioMap.get(t.sub_portfolio_id) || "Unknown Sub-Portfolio") : null;
            const totalValue = Number(t.quantity) * Number(t.price);

            return {
                id: `trade-${t.id}`,
                type: t.type, // 'buy' or 'sell'
                categoryType: 'trade',
                assetOrCategory: ticker,
                amount: totalValue,
                shares: Number(t.quantity),
                date: new Date(t.date),
                status: "completed",
                accountId: t.account_id,
                accountName: accountName,
                subportfolioId: t.sub_portfolio_id || null,
                subportfolioName: spName,
                householdName: activeHousehold.name
            };
        });

        // 2. Process Transactions
        const txItems: UnifiedHistoryItem[] = transactions.map(tx => {
            const categoryName = categoryMap.get(tx.category_id) || "Uncategorized";
            const accountName = accountMap.get(tx.account_id) || "Unknown Account";
            // Convert to deposit/withdrawal terminology for the UI if you prefer, or just keep income/expense
            const typeStr = tx.amount < 0 ? "withdrawal" : "deposit";

            return {
                id: `tx-${tx.id}`,
                type: typeStr,
                categoryType: 'transaction',
                assetOrCategory: categoryName,
                amount: Math.abs(Number(tx.amount)),
                shares: null,
                date: new Date(tx.date),
                status: "completed",
                accountId: tx.account_id,
                accountName: accountName,
                subportfolioId: null,
                subportfolioName: null,
                householdName: activeHousehold.name
            };
        });

        // 3. Unify and Sort
        return [...tradeItems, ...txItems].sort((a, b) => b.date.getTime() - a.date.getTime());
    }, [trades, transactions, assets, categories, accounts, subportfolios, activeHousehold.name]);

    const filteredHistory = useMemo(() => {
        return combinedHistory.filter(item => {
            if (filterCategory !== "all" && item.categoryType !== filterCategory) return false;
            if (filterAccount !== "all" && item.accountId !== filterAccount) return false;
            if (filterSubportfolio !== "all") {
                if (filterSubportfolio === "none" && item.subportfolioId !== null) return false;
                if (filterSubportfolio !== "none" && item.subportfolioId !== filterSubportfolio) return false;
            }
            return true;
        });
    }, [combinedHistory, filterCategory, filterAccount, filterSubportfolio]);

    const getIcon = (type: string) => {
        if (type === 'deposit' || type === 'income') return <ArrowDownRight className="h-5 w-5 text-green-500" />
        if (type === 'withdrawal' || type === 'expense') return <ArrowUpRight className="h-5 w-5 text-red-500" />
        return <ArrowRightLeft className="h-5 w-5 text-blue-500" />
    }

    const getAmountColor = (type: string) => {
        if (type === 'deposit' || type === 'income' || type === 'sell') return 'text-green-600'
        return 'text-base-900'
    }

    const formatAmount = (type: string, amount: number) => {
        const prefix = (type === 'deposit' || type === 'income' || type === 'sell') ? '+' : '-'
        return `${prefix}$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    }

    const formatDate = (date: Date) => {
        return date.toLocaleString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    }

    return (
        <div className="flex-1 space-y-6 p-8 relative">
            {isLoading && (
                <div className="absolute top-4 right-8 z-10 flex items-center gap-2 text-sm text-base-500 bg-white/80 px-3 py-1 rounded-full border border-base-200">
                    <div className="w-3 h-3 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
                    Updating...
                </div>
            )}
            <div className="flex items-center justify-between">
                <h2 className="text-3xl font-bold tracking-tight text-base-900">Transaction History</h2>
                <div className="flex gap-2">
                    <Button variant="secondary">Export CSV</Button>
                </div>
            </div>

            {/* Filters */}
            <Card className="bg-base-50/50">
                <CardContent className="pt-6 flex flex-wrap gap-4">
                    <div className="space-y-1">
                        <label className="text-xs font-medium text-base-500">Activity Type</label>
                        <select
                            className="w-full rounded-md border border-base-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                            value={filterCategory}
                            onChange={(e) => setFilterCategory(e.target.value)}
                        >
                            <option value="all">All Activity</option>
                            <option value="trade">Trades Only</option>
                            <option value="transaction">Transactions Only</option>
                        </select>
                    </div>

                    <div className="space-y-1">
                        <label className="text-xs font-medium text-base-500">Account</label>
                        <select
                            className="w-full rounded-md border border-base-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                            value={filterAccount}
                            onChange={(e) => setFilterAccount(e.target.value)}
                        >
                            <option value="all">All Accounts</option>
                            {accounts.map(acc => (
                                <option key={acc.id} value={acc.id}>{acc.name}</option>
                            ))}
                        </select>
                    </div>

                    <div className="space-y-1">
                        <label className="text-xs font-medium text-base-500">Sub-Portfolio</label>
                        <select
                            className="w-full rounded-md border border-base-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                            value={filterSubportfolio}
                            onChange={(e) => setFilterSubportfolio(e.target.value)}
                            disabled={filterCategory === "transaction"}
                        >
                            <option value="all">All Sub-Portfolios</option>
                            <option value="none">No Sub-Portfolio</option>
                            {subportfolios.map(sp => (
                                <option key={sp.id} value={sp.id}>{sp.name}</option>
                            ))}
                        </select>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>All Activity</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {filteredHistory.length === 0 && (
                            <div className="py-8 text-center text-base-500">
                                No historical activity found matching these filters.
                            </div>
                        )}
                        {filteredHistory.map((item) => (
                            <div key={item.id} className="flex items-center justify-between border-b border-base-100 pb-4 last:border-0 last:pb-0">
                                <div className="flex items-center gap-4">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-base-50 shrink-0">
                                        {getIcon(item.type)}
                                    </div>
                                    <div className="space-y-1">
                                        <p className="font-medium text-base-900 capitalize">
                                            {item.type} {item.assetOrCategory !== "UNKNOWN" ? item.assetOrCategory : ""}
                                        </p>
                                        <div className="flex flex-wrap items-center gap-2 text-sm text-base-500">
                                            <span>{formatDate(item.date)}</span>
                                            {item.shares && (
                                                <>
                                                    <span>•</span>
                                                    <span>{item.shares} shares</span>
                                                </>
                                            )}
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2 mt-1">
                                            <Badge variant="neutral">{item.householdName}</Badge>
                                            <Badge variant="neutral">{item.accountName}</Badge>
                                            {item.subportfolioName && (
                                                <Badge variant="neutral">{item.subportfolioName}</Badge>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex flex-col items-end gap-1 shrink-0">
                                    <div className="flex items-center gap-2">
                                        <span className={`font-semibold ${getAmountColor(item.type)}`}>
                                            {formatAmount(item.type, item.amount)}
                                        </span>
                                        <Button 
                                            variant="ghost" 
                                            size="sm" 
                                            className="text-base-400 hover:text-red-600 hover:bg-red-50 h-8 w-8 p-0"
                                            onClick={() => handleDelete(item)}
                                            disabled={isDeleting === item.id}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                    <Badge variant={item.status === 'completed' ? 'success' : 'warning'}>
                                        {item.status}
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
