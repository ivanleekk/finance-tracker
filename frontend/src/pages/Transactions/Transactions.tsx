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

export { transactionsLoader as loader } from "./transactions.loader";

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
};

export default function Transactions() {
    const { activeHousehold } = useHousehold()
    const { trades = [], transactions = [], assets = [], categories = [], accounts = [], subportfolios = [], currencies = [] } = (useLoaderData() as HistoryLoaderData) || {};
    const navigation = useNavigation()
    const revalidator = useRevalidator()

    const [filterCategory, setFilterCategory] = useState<string>("all")
    const [filterAccount, setFilterAccount] = useState<string>("all")
    const [filterSubportfolio, setFilterSubportfolio] = useState<string>("all")

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

    const combinedHistory = useMemo(() => {
        // Maps for O(1) lookups
        const assetMap = new Map(assets.map(a => [a.id, a.ticker]));
        const categoryMap = new Map(categories.map(c => [c.id, c.name]));
        const accountMap = new Map(accounts.map(a => [a.id, a.name]));
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
                description: t.description || null
            };
        });

        // 2. Process Transactions (Filtering out those linked to trades)
        const tradeTransactionIds = new Set(trades.map(t => t.transaction_id).filter(Boolean));

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
                    description: tx.description || null
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
        <div className="flex-1 space-y-4 sm:space-y-6 p-4 sm:p-6 md:p-8 relative">
            {isLoading && (
                <div className="absolute top-4 right-4 sm:right-8 z-10 flex items-center gap-2 text-sm text-base-500 bg-white/80 dark:bg-base-800/80 px-3 py-1 rounded-full border border-base-200 dark:border-base-800">
                    <div className="w-3 h-3 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
                    Updating...
                </div>
            )}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-base-900 dark:text-base-50">Transactions</h2>
                <div className="flex gap-2 w-full sm:w-auto">
                    <Button onClick={() => setIsLogModalOpen(true)} className="flex items-center justify-center gap-2 w-full sm:w-auto min-h-[44px]">
                        <PlusCircle className="h-4 w-4" />
                        Log Transaction
                    </Button>
                    <Button variant="secondary">Export CSV</Button>
                </div>
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
                <CardContent className="pt-6 flex flex-col sm:flex-row flex-wrap gap-4">
                    <div className="space-y-1 flex-1 min-w-[200px]">
                        <label className="text-xs font-medium text-base-500 dark:text-base-400">Activity Type</label>
                        <select
                            className="w-full rounded-md border border-base-200 dark:border-base-800 bg-white dark:bg-base-900 px-3 py-2 text-sm text-base-900 dark:text-base-50 focus:outline-none focus:ring-2 focus:ring-primary-500/20 min-h-[44px]"
                            value={filterCategory}
                            onChange={(e) => setFilterCategory(e.target.value)}
                        >
                            <option value="all">All Activity</option>
                            <option value="trade">Trades Only</option>
                            <option value="transaction">Transactions Only</option>
                        </select>
                    </div>

                    <div className="space-y-1 flex-1 min-w-[200px]">
                        <label className="text-xs font-medium text-base-500">Account</label>
                        <select
                            className="w-full rounded-md border border-base-200 dark:border-base-800 bg-white dark:bg-base-900 px-3 py-2 text-sm text-base-900 dark:text-base-50 focus:outline-none focus:ring-2 focus:ring-primary-500/20 min-h-[44px]"
                            value={filterAccount}
                            onChange={(e) => setFilterAccount(e.target.value)}
                        >
                            <option value="all">All Accounts</option>
                            {accounts.map(acc => (
                                <option key={acc.id} value={acc.id}>{acc.name}</option>
                            ))}
                        </select>
                    </div>

                    <div className="space-y-1 flex-1 min-w-[200px]">
                        <label className="text-xs font-medium text-base-500">Sub-Portfolio</label>
                        <select
                            className="w-full rounded-md border border-base-200 dark:border-base-800 bg-white dark:bg-base-900 px-3 py-2 text-sm text-base-900 dark:text-base-50 focus:outline-none focus:ring-2 focus:ring-primary-500/20 min-h-[44px]"
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
                            <div key={item.id} className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-base-100 dark:border-base-800 pb-4 last:border-0 last:pb-0 gap-4 sm:gap-0">
                                <div className="flex items-start sm:items-center gap-4">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-base-50 dark:bg-base-800 shrink-0 mt-1 sm:mt-0">
                                        {getIcon(item.type)}
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
                                        </div>
                                    </div>
                                </div>
                                <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-2 sm:gap-0.5 shrink-0 w-full sm:w-auto mt-2 sm:mt-0 border-t sm:border-0 border-base-100 pt-2 sm:pt-0">
                                    <div className="flex items-center gap-2">
                                        <span className={`font-semibold ${getAmountColor(item.type)}`}>
                                            {formatAmount(item.type, item.amountAccount, item.currencyAccount)}
                                        </span>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="text-base-400 hover:text-red-600 hover:bg-red-50 min-h-[44px] min-w-[44px] sm:h-8 sm:w-8 p-0"
                                            onClick={() => handleDelete(item)}
                                            disabled={isDeleting === item.id}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                    <div className="flex items-center gap-2">
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
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
