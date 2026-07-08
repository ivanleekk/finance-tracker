import { useState, useMemo } from "react"
import { useLoaderData, useNavigation, useRevalidator } from "react-router"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/Card"
import { Badge } from "../../components/ui/Badge"
import { Button } from "../../components/ui/Button"
import { ArrowUpRight, ArrowDownRight, ArrowRightLeft, Trash2, PlusCircle } from "lucide-react"
import { useHousehold } from "../../lib/HouseholdContext"
import api from "../../lib/api"
import type { HistoryLoaderData } from "./transactions.loader"
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "../../components/ui/Dialog"
import { Input } from "../../components/ui/Input"
import { TopBar } from "../../components/TopBar"
import { OwnershipTag } from "../../components/ui/OwnershipTag"
import { useAuth } from "../../lib/AuthContext"
import { useViewMode, isVisibleInViewMode } from "../../lib/ViewModeContext"
import { cn } from "../../lib/utils"

export { transactionsLoader as loader } from "./transactions.loader";

function categoryIcon(name: string): string {
    const low = name.toLowerCase();
    if (/(food|dining|restaurant|cafe|coffee|lunch|dinner)/.test(low)) return "☕";
    if (/(transport|taxi|grab|uber|mrt|bus|fuel|petrol)/.test(low)) return "🚕";
    if (/(grocery|groceries|supermarket|fairprice)/.test(low)) return "🛒";
    if (/(entertain|movie|netflix|game)/.test(low)) return "🎬";
    if (/(shop|retail)/.test(low)) return "🛍️";
    if (/(hous|rent|mortgage)/.test(low)) return "🏠";
    if (/(salary|income|payroll)/.test(low)) return "💰";
    if (/(invest|dividend)/.test(low)) return "💵";
    return "💳";
}

type UnifiedHistoryItem = {
    id: string;
    type: string; // 'buy', 'sell', 'deposit', 'withdrawal', 'income', 'expense'
    categoryType: 'trade' | 'transaction';
    assetOrCategory: string;
    amountNative: number;
    currencyNative: string;
    amountAccount: number;
    currencyAccount: string;
    shares: number | null;
    date: Date;
    status: string;
    accountId: string;
    accountName: string;
    subportfolioId: string | null;
    subportfolioName: string | null;
    householdName: string;
    description: string | null;
    ownerUserId: string | null;
};

export default function Transactions() {
    const { activeHousehold } = useHousehold()
    const { user } = useAuth();
    const { viewMode, hasHousehold } = useViewMode();
    const { trades = [], transactions = [], assets = [], categories = [], accounts = [], subportfolios = [], currencies = [] } = (useLoaderData() as HistoryLoaderData) || {};
    const navigation = useNavigation()
    const revalidator = useRevalidator()

    const [filterCategory, setFilterCategory] = useState<string>("all")
    const [filterAccount, setFilterAccount] = useState<string>("all")
    const [filterSubportfolio, setFilterSubportfolio] = useState<string>("all")
    const [filterFlow, setFilterFlow] = useState<"all" | "income" | "expense">("all")

    const [isDeleting, setIsDeleting] = useState<string | null>(null);
    const [isLogModalOpen, setIsLogModalOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [activeTab, setActiveTab] = useState<'transaction' | 'transfer'>('transaction');

    // Form state for normal transactions
    const [formData, setFormData] = useState({
        accountId: "",
        categoryId: "",
        amount: "",
        currency: activeHousehold?.base_currency || "USD",
        date: new Date().toISOString().split('T')[0] + 'T12:00:00Z',
        description: ""
    });

    // Form state for transfers
    const [transferData, setTransferData] = useState({
        fromAccountId: "",
        toAccountId: "",
        amount: "",
        date: new Date().toISOString().split('T')[0] + 'T12:00:00Z',
        description: ""
    });

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

    const handleLogTransaction = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        try {
            await api.post("/cashflow/transactions", {
                account_id: formData.accountId,
                category_id: formData.categoryId,
                date: formData.date,
                amount: parseFloat(formData.amount),
                currency: formData.currency,
                description: formData.description
            });
            setIsLogModalOpen(false);
            setFormData({
                accountId: "",
                categoryId: "",
                amount: "",
                currency: activeHousehold?.base_currency || "USD",
                date: new Date().toISOString().split('T')[0] + 'T12:00:00Z',
                description: ""
            });
            revalidator.revalidate();
        } catch (error) {
            console.error("Failed to log transaction", error);
            alert("Failed to log transaction. Please check all fields.");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleTransfer = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        try {
            await api.post("/cashflow/transfers", {
                from_account_id: transferData.fromAccountId,
                to_account_id: transferData.toAccountId,
                amount: parseFloat(transferData.amount),
                date: transferData.date,
                description: transferData.description
            });
            setIsLogModalOpen(false);
            setTransferData({
                fromAccountId: "",
                toAccountId: "",
                amount: "",
                date: new Date().toISOString().split('T')[0] + 'T12:00:00Z',
                description: ""
            });
            revalidator.revalidate();
        } catch (error) {
            console.error("Failed to perform transfer", error);
            alert("Failed to perform transfer. Please check all fields.");
        } finally {
            setIsSubmitting(false);
        }
    };

    const isLoading = navigation.state === "loading";

    const tradeTransactionIds = useMemo(
        () => new Set(trades.map(t => t.transaction_id).filter(Boolean)),
        [trades]
    );

    const combinedHistory = useMemo(() => {
        // Maps for O(1) lookups
        const assetMap = new Map(assets.map(a => [a.id, a.ticker]));
        const categoryMap = new Map(categories.map(c => [c.id, c.name]));
        const subportfolioMap = new Map(subportfolios.map(sp => [sp.id, sp.name]));

        // 1. Process Trades
        const tradeItems: UnifiedHistoryItem[] = trades.map(t => {
            const ticker = assetMap.get(t.asset_id) || "UNKNOWN";
            const account = accounts.find(a => a.id === t.account_id);
            const accountName = account?.name || "Unknown Account";
            const spName = t.sub_portfolio_id ? (subportfolioMap.get(t.sub_portfolio_id) || "Unknown Sub-Portfolio") : null;
            
            const nativeAmount = Number(t.quantity) * Number(t.price);
            const accountAmount = nativeAmount * Number(t.exchange_rate);

            return {
                id: `trade-${t.id}`,
                type: t.type, // 'buy' or 'sell'
                categoryType: 'trade',
                assetOrCategory: ticker,
                amountNative: nativeAmount,
                currencyNative: t.currency || "USD",
                amountAccount: accountAmount,
                currencyAccount: account?.currency || "USD",
                shares: Number(t.quantity),
                date: new Date(t.date),
                status: "completed",
                accountId: t.account_id,
                accountName: accountName,
                subportfolioId: t.sub_portfolio_id || null,
                subportfolioName: spName,
                householdName: activeHousehold.name,
                description: t.description || null,
                ownerUserId: account?.owner_user_id || null
            };
        });

        // 2. Process Transactions (Filtering out those linked to trades)
        const txItems: UnifiedHistoryItem[] = transactions
            .filter(tx => !tradeTransactionIds.has(tx.id))
            .map(tx => {
                const categoryName = categoryMap.get(tx.category_id) || "Uncategorized";
                const account = accounts.find(a => a.id === tx.account_id);
                const accountName = account?.name || "Unknown Account";

                const isExpense = tx.transaction_type === 'expense';
                let typeStr = isExpense ? "withdrawal" : "deposit";
                if (tx.transfer_id) {
                    typeStr = isExpense ? "transfer_out" : "transfer_in";
                }

                const nativeAmount = Math.abs(Number(tx.amount));
                const accountAmount = nativeAmount * (Number(tx.exchange_rate) || 1);

                return {
                    id: `tx-${tx.id}`,
                    type: typeStr,
                    categoryType: 'transaction',
                    assetOrCategory: categoryName,
                    amountNative: nativeAmount,
                    currencyNative: tx.currency || account?.currency || "USD",
                    amountAccount: accountAmount,
                    currencyAccount: account?.currency || "USD",
                    shares: null,
                    date: new Date(tx.date),
                    status: "completed",
                    accountId: tx.account_id,
                    accountName: accountName,
                    subportfolioId: null,
                    subportfolioName: null,
                    householdName: activeHousehold.name,
                    description: tx.description || null,
                    ownerUserId: account?.owner_user_id || null
                };
            });

        // 3. Unify and Sort
        return [...tradeItems, ...txItems].sort((a, b) => b.date.getTime() - a.date.getTime());
    }, [trades, transactions, assets, categories, accounts, subportfolios, activeHousehold.name, tradeTransactionIds]);

    const isInflow = (type: string) => ['deposit', 'income', 'sell', 'transfer_in'].includes(type);

    const filteredHistory = useMemo(() => {
        return combinedHistory.filter(item => {
            if (!isVisibleInViewMode(item.ownerUserId, viewMode, user?.id)) return false;
            if (filterCategory !== "all" && item.categoryType !== filterCategory) return false;
            if (filterAccount !== "all" && item.accountId !== filterAccount) return false;
            if (filterSubportfolio !== "all") {
                if (filterSubportfolio === "none" && item.subportfolioId !== null) return false;
                if (filterSubportfolio !== "none" && item.subportfolioId !== filterSubportfolio) return false;
            }
            if (filterFlow !== "all" && (filterFlow === "income") !== isInflow(item.type)) return false;
            return true;
        });
    }, [combinedHistory, filterCategory, filterAccount, filterSubportfolio, filterFlow, viewMode, user?.id]);

    const groupedHistory = useMemo(() => {
        const groups = new Map<string, UnifiedHistoryItem[]>();
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
        filteredHistory.forEach(item => {
            const d = new Date(item.date); d.setHours(0, 0, 0, 0);
            const dayLabel = item.date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
            let label: string;
            if (d.getTime() === today.getTime()) label = `Today · ${dayLabel}`;
            else if (d.getTime() === yesterday.getTime()) label = `Yesterday · ${dayLabel}`;
            else label = item.date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
            if (!groups.has(label)) groups.set(label, []);
            groups.get(label)!.push(item);
        });
        return Array.from(groups.entries());
    }, [filteredHistory]);

    const cashflowData = useMemo(() => {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const weeks = [0, 1, 2, 3, 4].map(() => ({ in: 0, out: 0 }));
        let totalIn = 0, totalOut = 0;
        transactions.forEach(tx => {
            if (tradeTransactionIds.has(tx.id)) return;
            const d = new Date(tx.date);
            if (d < monthStart) return;
            const account = accounts.find(a => a.id === tx.account_id);
            if (!isVisibleInViewMode(account?.owner_user_id ?? null, viewMode, user?.id)) return;
            const homeAmount = Math.abs(Number(tx.amount_home_currency ?? tx.amount));
            const weekIdx = Math.min(4, Math.floor((d.getDate() - 1) / 7));
            if (tx.transaction_type === 'income') {
                weeks[weekIdx].in += homeAmount;
                totalIn += homeAmount;
            } else {
                weeks[weekIdx].out += homeAmount;
                totalOut += homeAmount;
            }
        });
        const max = Math.max(1, ...weeks.map(w => Math.max(w.in, w.out)));
        return { weeks, totalIn, totalOut, max, monthLabel: now.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) };
    }, [transactions, accounts, viewMode, user?.id, tradeTransactionIds]);

    const topCategories = useMemo(() => {
        const categoryMap = new Map(categories.map(c => [c.id, c.name]));
        const byCategory = new Map<string, number>();
        transactions.forEach(tx => {
            if (tx.transaction_type !== 'expense' || tradeTransactionIds.has(tx.id)) return;
            const account = accounts.find(a => a.id === tx.account_id);
            if (!isVisibleInViewMode(account?.owner_user_id ?? null, viewMode, user?.id)) return;
            const name = categoryMap.get(tx.category_id) || "Uncategorized";
            const homeAmount = Math.abs(Number(tx.amount_home_currency ?? tx.amount));
            byCategory.set(name, (byCategory.get(name) || 0) + homeAmount);
        });
        const items = Array.from(byCategory.entries())
            .map(([name, amount]) => ({ name, amount, icon: categoryIcon(name) }))
            .sort((a, b) => b.amount - a.amount)
            .slice(0, 4);
        const max = Math.max(1, ...items.map(c => c.amount));
        return { items, max };
    }, [transactions, categories, accounts, viewMode, user?.id, tradeTransactionIds]);

    const getIcon = (type: string) => {
        if (type === 'deposit' || type === 'income' || type === 'transfer_in') return <ArrowDownRight className="h-5 w-5 text-green-500" />
        if (type === 'withdrawal' || type === 'expense' || type === 'transfer_out') return <ArrowUpRight className="h-5 w-5 text-red-500" />
        return <ArrowRightLeft className="h-5 w-5 text-blue-500" />
    }

    const getAmountColor = (type: string) => {
        if (type === 'deposit' || type === 'income' || type === 'sell' || type === 'transfer_in') return 'text-green-600'
        if (type === 'withdrawal' || type === 'expense' || type === 'buy' || type === 'transfer_out') return 'text-red-600'
        return 'text-base-900'
    }

    const formatAmount = (type: string, amount: number, currencyCode: string) => {
        const prefix = (type === 'deposit' || type === 'income' || type === 'sell' || type === 'transfer_in') ? '+' : '-'
        const currency = currencies.find(c => c.code === currencyCode);
        const symbol = currency?.symbol || currencyCode;
        return `${prefix}${symbol}${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    }

    const formatDate = (date: Date) => {
        return date.toLocaleString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    }

    return (
        <div className="flex-1 flex flex-col overflow-hidden relative">
            <TopBar
                title="Transactions"
                commandPlaceholder="coffee 5.20…"
                cta={
                    <Button variant="cta" onClick={() => setIsLogModalOpen(true)} className="flex items-center gap-2">
                        <PlusCircle className="h-4 w-4" />
                        Log Transaction
                    </Button>
                }
            />
            <div className="flex-1 overflow-y-auto space-y-6 p-8 relative">
            {isLoading && (
                <div className="absolute top-4 right-8 z-10 flex items-center gap-2 text-sm text-base-500 bg-white/80 dark:bg-base-800/80 px-3 py-1 rounded-full border border-base-200 dark:border-base-800">
                    <div className="w-3 h-3 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
                    Updating...
                </div>
            )}
            <div className="flex justify-end">
                <Button variant="secondary">Export CSV</Button>
            </div>

            {/* Cashflow + Top categories */}
            <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-6">
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                            <CardTitle className="text-sm">Cashflow · {cashflowData.monthLabel}</CardTitle>
                            <div className="flex items-center gap-4 font-mono text-xs font-semibold">
                                <span className="text-emerald-600 dark:text-emerald-400">+{cashflowData.totalIn.toLocaleString(undefined, { maximumFractionDigits: 0 })} in</span>
                                <span className="text-red-500">−{cashflowData.totalOut.toLocaleString(undefined, { maximumFractionDigits: 0 })} out</span>
                            </div>
                        </div>
                        <div className="flex items-end gap-4 h-28">
                            {cashflowData.weeks.map((w, i) => (
                                <div key={i} className="flex-1 flex items-end justify-center gap-1 h-full">
                                    <div className="w-3 rounded-t bg-emerald-500" style={{ height: `${(w.in / cashflowData.max) * 100}%` }} title={`+${w.in.toFixed(0)}`} />
                                    <div className="w-3 rounded-t bg-red-400" style={{ height: `${(w.out / cashflowData.max) * 100}%` }} title={`-${w.out.toFixed(0)}`} />
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6">
                        <CardTitle className="text-sm mb-4">Top categories</CardTitle>
                        {topCategories.items.length === 0 ? (
                            <div className="text-sm text-base-500 py-4 text-center">No expenses yet.</div>
                        ) : (
                            <div className="space-y-3">
                                {topCategories.items.map(cat => (
                                    <div key={cat.name}>
                                        <div className="flex items-center justify-between mb-1.5">
                                            <span className="text-sm text-base-700 dark:text-base-300">{cat.icon} {cat.name}</span>
                                            <span className="font-mono text-xs text-base-500">{cat.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                                        </div>
                                        <div className="h-1.5 rounded-full bg-base-100 dark:bg-base-800 overflow-hidden">
                                            <div className="h-full bg-secondary-500" style={{ width: `${(cat.amount / topCategories.max) * 100}%` }} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Flow filter chips */}
            <div className="flex items-center gap-2 flex-wrap">
                {(["all", "income", "expense"] as const).map(f => (
                    <button
                        key={f}
                        onClick={() => setFilterFlow(f)}
                        className={cn(
                            "px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors",
                            filterFlow === f
                                ? "bg-gradient-to-br from-secondary-500 to-secondary-700 text-white"
                                : "bg-base-100 dark:bg-base-900 border border-base-200 dark:border-base-800 text-base-500 dark:text-base-400 hover:text-base-700 dark:hover:text-base-200"
                        )}
                    >
                        {f}
                    </button>
                ))}
            </div>

            {/* Log Transaction Modal */}
            <Dialog isOpen={isLogModalOpen} onClose={() => setIsLogModalOpen(false)}>
                <DialogHeader>
                    <DialogTitle className="text-base-900 dark:text-base-50">{activeTab === 'transaction' ? 'Log Daily Transaction' : 'Internal Transfer'}</DialogTitle>
                    <p className="text-sm text-base-500 dark:text-base-400">
                        {activeTab === 'transaction'
                            ? 'Record food, retail, or income items manually.'
                            : 'Move money between your accounts seamlessly.'}
                    </p>
                </DialogHeader>

                {/* Tab Switcher */}
                <div className="flex p-1 bg-base-100 dark:bg-base-900 rounded-lg mb-6">
                    <button
                        type="button"
                        className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${activeTab === 'transaction' ? 'bg-white dark:bg-base-700 shadow-sm text-primary-600 dark:text-primary-400' : 'text-base-500 dark:text-base-400 hover:text-base-700 dark:hover:text-base-200'}`}
                        onClick={() => setActiveTab('transaction')}
                    >
                        Income/Expense
                    </button>
                    <button
                        type="button"
                        className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${activeTab === 'transfer' ? 'bg-white dark:bg-base-700 shadow-sm text-secondary-600 dark:text-secondary-400' : 'text-base-500 dark:text-base-400 hover:text-base-700 dark:hover:text-base-200'}`}
                        onClick={() => setActiveTab('transfer')}
                    >
                        Transfer
                    </button>
                </div>

                {activeTab === 'transaction' ? (
                    <form onSubmit={handleLogTransaction} className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-base-700 dark:text-base-300">Account</label>
                                <select
                                    required
                                    className="w-full rounded-lg border border-base-200 dark:border-base-800 bg-white dark:bg-base-900 px-3 py-2 text-sm text-base-900 dark:text-base-50 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                                    value={formData.accountId}
                                    onChange={(e) => setFormData({ ...formData, accountId: e.target.value })}
                                >
                                    <option value="">Select Account</option>
                                    {accounts.map(acc => (
                                        <option key={acc.id} value={acc.id}>{acc.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <label className="text-sm font-medium text-base-700">Category</label>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const name = prompt("Enter category name (e.g. Food, Salary):");
                                            const type = prompt("Enter type (income/expense):") as "income" | "expense";
                                            if (name && type) {
                                                api.post("/cashflow/categories", {
                                                    household_id: activeHousehold.id,
                                                    name,
                                                    type
                                                }).then(() => revalidator.revalidate());
                                            }
                                        }}
                                        className="text-xs text-primary-600 hover:underline"
                                    >
                                        + New Category
                                    </button>
                                </div>
                                <select
                                    required
                                    className="w-full rounded-lg border border-base-200 dark:border-base-800 bg-white dark:bg-base-900 px-3 py-2 text-sm text-base-900 dark:text-base-50 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                                    value={formData.categoryId}
                                    onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
                                >
                                    <option value="">Select Category</option>
                                    {categories.map(cat => (
                                        <option key={cat.id} value={cat.id}>{cat.name} ({cat.type})</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-base-700">Currency</label>
                                <select
                                    required
                                    className="w-full rounded-lg border border-base-200 dark:border-base-800 bg-white dark:bg-base-900 px-3 py-2 text-sm text-base-900 dark:text-base-50 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                                    value={formData.currency}
                                    onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                                >
                                    <option value="">Select Currency</option>
                                    {currencies.map(curr => (
                                        <option key={curr.code} value={curr.code}>{curr.code} - {curr.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-base-700">Amount</label>
                                <Input
                                    type="number"
                                    step="0.01"
                                    required
                                    placeholder="0.00"
                                    value={formData.amount}
                                    onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-base-700">Date</label>
                                <Input
                                    type="date"
                                    required
                                    value={formData.date.split('T')[0]}
                                    onChange={(e) => setFormData({ ...formData, date: e.target.value + 'T12:00:00Z' })}
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-base-700">Description</label>
                            <Input
                                placeholder="e.g. Groceries, Dinner, Salary..."
                                value={formData.description}
                                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            />
                        </div>

                        <DialogFooter>
                            <Button type="button" variant="ghost" onClick={() => setIsLogModalOpen(false)}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={isSubmitting}>
                                {isSubmitting ? "Logging..." : "Log Transaction"}
                            </Button>
                        </DialogFooter>
                    </form>
                ) : (
                    <form onSubmit={handleTransfer} className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-base-700">From Account</label>
                                <select
                                    required
                                    className="w-full rounded-lg border border-base-200 dark:border-base-800 bg-white dark:bg-base-900 px-3 py-2 text-sm text-base-900 dark:text-base-50 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                                    value={transferData.fromAccountId}
                                    onChange={(e) => setTransferData({ ...transferData, fromAccountId: e.target.value })}
                                >
                                    <option value="">Select Source</option>
                                    {accounts.map(acc => (
                                        <option key={acc.id} value={acc.id} disabled={acc.id === transferData.toAccountId}>{acc.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-base-700">To Account</label>
                                <select
                                    required
                                    className="w-full rounded-lg border border-base-200 dark:border-base-800 bg-white dark:bg-base-900 px-3 py-2 text-sm text-base-900 dark:text-base-50 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                                    value={transferData.toAccountId}
                                    onChange={(e) => setTransferData({ ...transferData, toAccountId: e.target.value })}
                                >
                                    <option value="">Select Destination</option>
                                    {accounts.map(acc => (
                                        <option key={acc.id} value={acc.id} disabled={acc.id === transferData.fromAccountId}>{acc.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-base-700">Amount</label>
                                <Input
                                    type="number"
                                    step="0.01"
                                    required
                                    placeholder="0.00"
                                    value={transferData.amount}
                                    onChange={(e) => setTransferData({ ...transferData, amount: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-base-700">Date</label>
                                <Input
                                    type="date"
                                    required
                                    value={transferData.date.split('T')[0]}
                                    onChange={(e) => setTransferData({ ...transferData, date: e.target.value + 'T12:00:00Z' })}
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-base-700">Description</label>
                            <Input
                                placeholder="e.g. Savings transfer, Monthly rent..."
                                value={transferData.description}
                                onChange={(e) => setTransferData({ ...transferData, description: e.target.value })}
                            />
                        </div>

                        <DialogFooter>
                            <Button type="button" variant="ghost" onClick={() => setIsLogModalOpen(false)}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={isSubmitting}>
                                {isSubmitting ? "Processing..." : "Transfer Funds"}
                            </Button>
                        </DialogFooter>
                    </form>
                )}
            </Dialog>

            {/* Filters */}
            <Card className="bg-base-50/50 dark:bg-base-900/50">
                <CardContent className="pt-6 flex flex-wrap gap-4">
                    <div className="space-y-1">
                        <label className="text-xs font-medium text-base-500 dark:text-base-400">Activity Type</label>
                        <select
                            className="w-full rounded-md border border-base-200 dark:border-base-800 bg-white dark:bg-base-900 px-3 py-2 text-sm text-base-900 dark:text-base-50 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
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
                            className="w-full rounded-md border border-base-200 dark:border-base-800 bg-white dark:bg-base-900 px-3 py-2 text-sm text-base-900 dark:text-base-50 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
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
                            className="w-full rounded-md border border-base-200 dark:border-base-800 bg-white dark:bg-base-900 px-3 py-2 text-sm text-base-900 dark:text-base-50 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
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

            <Card className="overflow-hidden">
                <CardHeader>
                    <CardTitle>All Activity</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    {groupedHistory.length === 0 && (
                        <div className="py-8 text-center text-base-500">
                            No historical activity found matching these filters.
                        </div>
                    )}
                    {groupedHistory.map(([label, items]) => (
                        <div key={label}>
                            <div className="px-6 py-2 text-[10px] font-mono font-semibold uppercase tracking-wider text-base-400 dark:text-base-500 bg-base-50/50 dark:bg-base-900/50 border-y border-base-100 dark:border-base-800">
                                {label}
                            </div>
                            <div className="divide-y divide-base-100 dark:divide-base-800">
                                {items.map((item) => (
                                    <div key={item.id} className="flex items-center justify-between px-6 py-4">
                                        <div className="flex items-center gap-4">
                                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-base-50 dark:bg-base-800 shrink-0 text-lg">
                                                {item.categoryType === 'transaction' && !item.type.startsWith('transfer')
                                                    ? categoryIcon(item.assetOrCategory)
                                                    : getIcon(item.type)}
                                            </div>
                                            <div className="space-y-1">
                                                <p className="font-medium text-base-900 dark:text-base-50 capitalize">
                                                    {item.type.startsWith('transfer') ? 'Transfer' : item.type} {item.assetOrCategory !== "UNKNOWN" ? item.assetOrCategory : ""}
                                                </p>
                                                {item.description && (
                                                    <p className="text-xs text-base-400 dark:text-base-500 leading-tight">
                                                        {item.description}
                                                    </p>
                                                )}
                                                <div className="flex flex-wrap items-center gap-2 text-sm text-base-500 dark:text-base-400">
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
                                                    <OwnershipTag ownerUserId={item.ownerUserId} show={hasHousehold && viewMode === "blended"} />
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex flex-col items-end gap-0.5 shrink-0">
                                            <div className="flex items-center gap-2">
                                                <span className={`font-semibold ${getAmountColor(item.type)}`}>
                                                    {formatAmount(item.type, item.amountAccount, item.currencyAccount)}
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
                                            {item.currencyNative !== item.currencyAccount && (
                                                <span className="text-xs font-medium text-base-500 dark:text-base-400">
                                                    {formatAmount(item.type, item.amountNative, item.currencyNative)} {item.currencyNative}
                                                </span>
                                            )}
                                            <Badge variant={item.status === 'completed' ? 'success' : 'warning'}>
                                                {item.status}
                                            </Badge>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </CardContent>
            </Card>
            </div>
        </div>
    )
}
