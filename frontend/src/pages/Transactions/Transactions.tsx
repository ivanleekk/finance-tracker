import { useState, useMemo, useEffect } from "react"
import { useLoaderData, useNavigation, useRevalidator } from "react-router"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/Card"
import { Badge } from "../../components/ui/Badge"
import { Button } from "../../components/ui/Button"
import { ArrowUpRight, ArrowDownRight, ArrowRightLeft, Trash2, PlusCircle, ListFilter, RotateCcw } from "lucide-react"
import { Pie, PieChart, Cell, ResponsiveContainer, Tooltip } from "recharts"
import { useHousehold } from "../../lib/HouseholdContext"
import api from "../../lib/api"
import { downloadFromApi } from "../../lib/download"
import type { HistoryLoaderData } from "./transactions.loader"
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "../../components/ui/Dialog"
import { Input } from "../../components/ui/Input"
import { Select } from "../../components/ui/Select"
import { TopBar } from "../../components/TopBar"
import { OwnershipTag } from "../../components/ui/OwnershipTag"
import { useAuth } from "../../lib/AuthContext"
import { useViewMode, isVisibleInViewMode } from "../../lib/ViewModeContext"
import { groupHistory, type HistoryGranularity } from "../../lib/historyGroups"
import { cn } from "../../lib/utils"

export { transactionsLoader as loader } from "./transactions.loader";

const CATEGORY_COLORS = ["var(--chart-cat-1)", "var(--chart-cat-2)", "var(--chart-cat-3)", "var(--chart-cat-4)", "var(--chart-cat-5)"];
// Neutral fallback for buckets that aren't a real household category (the "Other" rollup slice, "Uncategorized").
const OTHER_SLICE_COLOR = "var(--base-400)";

type CategoryPeriodPreset = "all" | "this_month" | "last_month" | "last_3_months" | "last_6_months" | "this_year" | "custom";

const CATEGORY_PERIOD_OPTIONS: { value: CategoryPeriodPreset; label: string }[] = [
    { value: "all", label: "All time" },
    { value: "this_month", label: "This month" },
    { value: "last_month", label: "Last month" },
    { value: "last_3_months", label: "Last 3 months" },
    { value: "last_6_months", label: "Last 6 months" },
    { value: "this_year", label: "This year" },
    { value: "custom", label: "Custom range" },
];

const categoryFilterStorageKey = (householdId: string) => `ft:tx-category-filter:${householdId}`;

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

const HISTORY_GRANULARITIES: { value: HistoryGranularity; label: string }[] = [
    { value: "day", label: "Day" },
    { value: "month", label: "Month" },
    { value: "year", label: "Year" },
];

const historyGranularityStorageKey = (householdId: string) => `ft:tx-group-by:${householdId}`;

/**
 * Best guess at a row's value in the household's base currency: the figure the
 * backend already converted, or the row's own amount when it was already booked
 * in the base currency. Anything else stays `null` — a foreign-currency row with
 * no stored conversion is left out of the group totals rather than distorting them.
 * The iOS and Android ports of this rule live in `HistoryGroups.swift` / `HistoryGroups.kt`.
 */
function homeValueOf(storedHomeAmount: number | null | undefined, nativeAmount: number, nativeCurrency: string | null | undefined, baseCurrency: string): number | null {
    if (storedHomeAmount !== null && storedHomeAmount !== undefined) {
        const n = Math.abs(Number(storedHomeAmount));
        if (Number.isFinite(n)) return n;
    }
    if (nativeCurrency && nativeCurrency === baseCurrency) return Math.abs(nativeAmount);
    return null;
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
    /** Value in the household's base currency, or null when it can't be converted. */
    amountHome: number | null;
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
    const [hiddenCategoryIds, setHiddenCategoryIds] = useState<Set<string>>(new Set())
    const [showCategoryFilter, setShowCategoryFilter] = useState(false)
    const [categoryPeriod, setCategoryPeriod] = useState<CategoryPeriodPreset>("all")
    const [categoryPeriodStart, setCategoryPeriodStart] = useState("")
    const [categoryPeriodEnd, setCategoryPeriodEnd] = useState("")
    const [historyGranularity, setHistoryGranularity] = useState<HistoryGranularity>("day")

    // Restore the saved top-categories filter/period whenever the active household changes,
    // so a user doesn't have to re-hide the same categories every time they come back.
    useEffect(() => {
        if (!activeHousehold) return;
        try {
            const raw = localStorage.getItem(categoryFilterStorageKey(activeHousehold.id));
            const saved = raw ? JSON.parse(raw) : null;
            setHiddenCategoryIds(new Set(saved?.hiddenCategoryIds || []));
            setCategoryPeriod(saved?.categoryPeriod || "all");
            setCategoryPeriodStart(saved?.categoryPeriodStart || "");
            setCategoryPeriodEnd(saved?.categoryPeriodEnd || "");
        } catch {
            setHiddenCategoryIds(new Set());
            setCategoryPeriod("all");
            setCategoryPeriodStart("");
            setCategoryPeriodEnd("");
        }
    }, [activeHousehold?.id])

    useEffect(() => {
        if (!activeHousehold) return;
        localStorage.setItem(categoryFilterStorageKey(activeHousehold.id), JSON.stringify({
            hiddenCategoryIds: Array.from(hiddenCategoryIds),
            categoryPeriod,
            categoryPeriodStart,
            categoryPeriodEnd,
        }));
    }, [activeHousehold?.id, hiddenCategoryIds, categoryPeriod, categoryPeriodStart, categoryPeriodEnd])

    // Remember how the activity list was last bucketed, per household.
    useEffect(() => {
        if (!activeHousehold) return;
        const saved = localStorage.getItem(historyGranularityStorageKey(activeHousehold.id));
        setHistoryGranularity(saved === "month" || saved === "year" ? saved : "day");
    }, [activeHousehold?.id])

    useEffect(() => {
        if (!activeHousehold) return;
        localStorage.setItem(historyGranularityStorageKey(activeHousehold.id), historyGranularity);
    }, [activeHousehold?.id, historyGranularity])

    const [isDeleting, setIsDeleting] = useState<string | null>(null);
    const [isLogModalOpen, setIsLogModalOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [activeTab, setActiveTab] = useState<'transaction' | 'transfer'>('transaction');

    // Inline "new category" mini-form inside the log-transaction dialog
    const [isCreatingCategory, setIsCreatingCategory] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState("");
    const [newCategoryType, setNewCategoryType] = useState<'expense' | 'income'>('expense');
    const [isSavingCategory, setIsSavingCategory] = useState(false);

    // Preselect the user's default expense account when it's still visible in this household's list.
    const defaultAccountId = () => (user?.default_account_id && accounts.some(a => a.id === user.default_account_id))
        ? user.default_account_id
        : "";

    // Form state for normal transactions
    const [formData, setFormData] = useState({
        accountId: defaultAccountId(),
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

    const baseCurrency = activeHousehold.base_currency || "USD";

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

    const handleCreateCategory = async () => {
        if (!newCategoryName.trim()) return;
        setIsSavingCategory(true);
        try {
            const res = await api.post("/cashflow/categories", {
                household_id: activeHousehold.id,
                name: newCategoryName.trim(),
                type: newCategoryType,
            });
            setFormData(f => ({ ...f, categoryId: res.data.id }));
            setNewCategoryName("");
            setIsCreatingCategory(false);
            revalidator.revalidate();
        } catch (error) {
            console.error("Failed to create category", error);
            alert("Failed to create category. Please try again.");
        } finally {
            setIsSavingCategory(false);
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
                accountId: defaultAccountId(),
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

    const transactionMap = useMemo(
        () => new Map(transactions.map(tx => [tx.id, tx])),
        [transactions]
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
            // A trade only has a home-currency figure through the funding transaction it
            // settled against. Cash-settled trades (settle_from_cash) never create one, so
            // they stay out of the group totals rather than being summed in the wrong currency.
            const fundingTx = t.transaction_id ? transactionMap.get(t.transaction_id) : undefined;
            const homeAmount = homeValueOf(fundingTx?.amount_home_currency, nativeAmount, t.currency || account?.currency, baseCurrency);

            return {
                id: `trade-${t.id}`,
                type: t.type, // 'buy' or 'sell'
                categoryType: 'trade',
                assetOrCategory: ticker,
                amountNative: nativeAmount,
                currencyNative: t.currency || "USD",
                amountAccount: accountAmount,
                currencyAccount: account?.currency || "USD",
                amountHome: homeAmount,
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
                const homeAmount = homeValueOf(tx.amount_home_currency, nativeAmount, tx.currency || account?.currency, baseCurrency);

                return {
                    id: `tx-${tx.id}`,
                    type: typeStr,
                    categoryType: 'transaction',
                    assetOrCategory: categoryName,
                    amountNative: nativeAmount,
                    currencyNative: tx.currency || account?.currency || "USD",
                    amountAccount: accountAmount,
                    currencyAccount: account?.currency || "USD",
                    amountHome: homeAmount,
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
    }, [trades, transactions, assets, categories, accounts, subportfolios, activeHousehold.name, tradeTransactionIds, transactionMap, baseCurrency]);

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

    const groupedHistory = useMemo(
        () => groupHistory(filteredHistory, historyGranularity),
        [filteredHistory, historyGranularity]
    );

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

    // Date window the top-categories card (chips + pie chart) is scoped to. Kept separate from
    // the "Activity Type/Account/Sub-Portfolio" filters below, which apply to the full history list.
    const categoryPeriodRange = useMemo(() => {
        const now = new Date();
        switch (categoryPeriod) {
            case "this_month":
                return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: null as Date | null };
            case "last_month":
                return { start: new Date(now.getFullYear(), now.getMonth() - 1, 1), end: new Date(now.getFullYear(), now.getMonth(), 1) };
            case "last_3_months":
                return { start: new Date(now.getFullYear(), now.getMonth() - 2, 1), end: null };
            case "last_6_months":
                return { start: new Date(now.getFullYear(), now.getMonth() - 5, 1), end: null };
            case "this_year":
                return { start: new Date(now.getFullYear(), 0, 1), end: null };
            case "custom":
                return {
                    start: categoryPeriodStart ? new Date(`${categoryPeriodStart}T00:00:00`) : null,
                    end: categoryPeriodEnd ? new Date(`${categoryPeriodEnd}T23:59:59.999`) : null,
                };
            default:
                return null;
        }
    }, [categoryPeriod, categoryPeriodStart, categoryPeriodEnd]);

    const isInCategoryPeriod = (date: Date) => {
        if (!categoryPeriodRange) return true;
        if (categoryPeriodRange.start && date < categoryPeriodRange.start) return false;
        if (categoryPeriodRange.end && date >= categoryPeriodRange.end) return false;
        return true;
    };

    // Every expense category that's actually shown up in the selected period, used to populate the
    // filter chips (independent of which ones are currently hidden, so a hidden chip stays visible to re-enable).
    const expenseCategoryOptions = useMemo(() => {
        const seen = new Map<string, string>();
        transactions.forEach(tx => {
            if (tx.transaction_type !== 'expense' || tradeTransactionIds.has(tx.id)) return;
            if (!isInCategoryPeriod(new Date(tx.date))) return;
            const account = accounts.find(a => a.id === tx.account_id);
            if (!isVisibleInViewMode(account?.owner_user_id ?? null, viewMode, user?.id)) return;
            const id = tx.category_id || "uncategorized";
            if (!seen.has(id)) {
                const name = categories.find(c => c.id === tx.category_id)?.name || "Uncategorized";
                seen.set(id, name);
            }
        });
        return Array.from(seen.entries())
            .map(([id, name]) => ({ id, name }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [transactions, categories, accounts, viewMode, user?.id, tradeTransactionIds, categoryPeriodRange]);

    // Stable id -> color mapping derived from the household's full expense-category list (sorted by
    // id, not by amount), so a category keeps the same pie/legend color no matter what's hidden or
    // which period is selected. "Other"/"Uncategorized" always get the same neutral fallback.
    const categoryColorMap = useMemo(() => {
        const expenseCats = categories
            .filter(c => c.type === 'expense')
            .slice()
            .sort((a, b) => a.id.localeCompare(b.id));
        const map = new Map<string, string>();
        expenseCats.forEach((c, i) => map.set(c.id, CATEGORY_COLORS[i % CATEGORY_COLORS.length]));
        return map;
    }, [categories]);

    const colorForSlice = (id: string) => categoryColorMap.get(id) ?? OTHER_SLICE_COLOR;

    const toggleHiddenCategory = (id: string) => {
        setHiddenCategoryIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const resetCategoryFilter = () => setHiddenCategoryIds(new Set());

    const categoryBreakdown = useMemo(() => {
        const categoryMap = new Map(categories.map(c => [c.id, c.name]));
        const byCategory = new Map<string, { name: string; amount: number }>();
        transactions.forEach(tx => {
            if (tx.transaction_type !== 'expense' || tradeTransactionIds.has(tx.id)) return;
            if (!isInCategoryPeriod(new Date(tx.date))) return;
            const account = accounts.find(a => a.id === tx.account_id);
            if (!isVisibleInViewMode(account?.owner_user_id ?? null, viewMode, user?.id)) return;
            const catId = tx.category_id || "uncategorized";
            if (hiddenCategoryIds.has(catId)) return;
            const name = categoryMap.get(tx.category_id) || "Uncategorized";
            const homeAmount = Math.abs(Number(tx.amount_home_currency ?? tx.amount));
            const existing = byCategory.get(catId);
            byCategory.set(catId, { name, amount: (existing?.amount ?? 0) + homeAmount });
        });
        const all = Array.from(byCategory.entries())
            .map(([id, v]) => ({ id, name: v.name, amount: v.amount, icon: categoryIcon(v.name) }))
            .sort((a, b) => b.amount - a.amount);
        const total = all.reduce((sum, c) => sum + c.amount, 0);
        const top = all.slice(0, 4);
        const max = Math.max(1, ...top.map(c => c.amount));
        return { all, top, max, total };
    }, [transactions, categories, accounts, viewMode, user?.id, tradeTransactionIds, hiddenCategoryIds, categoryPeriodRange]);

    // Cap the pie chart at 6 slices + "Other" so it stays legible once a household has a long tail of categories.
    const pieSlices = useMemo(() => {
        const items = categoryBreakdown.all;
        if (items.length <= 6) return items;
        const top = items.slice(0, 6);
        const otherAmount = items.slice(6).reduce((sum, c) => sum + c.amount, 0);
        return [...top, { id: "other", name: "Other", amount: otherAmount, icon: "•" }];
    }, [categoryBreakdown.all]);

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

    const formatHomeAmount = (amount: number) => {
        const symbol = currencies.find(c => c.code === baseCurrency)?.symbol || baseCurrency;
        return `${symbol}${Math.abs(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
            <div className="flex-1 overflow-y-auto space-y-6 p-4 sm:p-6 lg:p-8 relative">
            {isLoading && (
                <div className="absolute top-4 right-8 z-10 flex items-center gap-2 text-sm text-base-500 bg-white/80 dark:bg-base-800/80 px-3 py-1 rounded-full border border-base-200 dark:border-base-800">
                    <div className="w-3 h-3 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
                    Updating...
                </div>
            )}
            <div className="flex justify-end">
                <Button
                    variant="secondary"
                    onClick={() => activeHousehold && downloadFromApi(`/exports/household/${activeHousehold.id}/csv/transactions`)}
                >
                    Export CSV
                </Button>
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
                        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                            <CardTitle className="text-sm">Top categories</CardTitle>
                            <div className="flex items-center gap-2">
                                <Select
                                    className="min-w-32"
                                    value={categoryPeriod}
                                    onChange={(v) => setCategoryPeriod(v as CategoryPeriodPreset)}
                                    options={CATEGORY_PERIOD_OPTIONS}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowCategoryFilter(v => !v)}
                                    className={cn(
                                        "flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md transition-colors",
                                        showCategoryFilter || hiddenCategoryIds.size > 0
                                            ? "text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/30"
                                            : "text-base-500 dark:text-base-400 hover:text-base-700 dark:hover:text-base-200"
                                    )}
                                >
                                    <ListFilter className="h-3.5 w-3.5" />
                                    Filter{hiddenCategoryIds.size > 0 ? ` (${hiddenCategoryIds.size} hidden)` : ""}
                                </button>
                            </div>
                        </div>
                        {categoryPeriod === "custom" && (
                            <div className="flex items-center gap-2 mb-4">
                                <Input
                                    type="date"
                                    className="text-xs"
                                    value={categoryPeriodStart}
                                    onChange={(e) => setCategoryPeriodStart(e.target.value)}
                                />
                                <span className="text-xs text-base-400">to</span>
                                <Input
                                    type="date"
                                    className="text-xs"
                                    value={categoryPeriodEnd}
                                    onChange={(e) => setCategoryPeriodEnd(e.target.value)}
                                />
                            </div>
                        )}
                        {showCategoryFilter && (
                            <div className="flex flex-wrap items-center gap-1.5 mb-4 pb-4 border-b border-base-100 dark:border-base-800">
                                {expenseCategoryOptions.length === 0 ? (
                                    <span className="text-xs text-base-400">No expense categories in this period.</span>
                                ) : expenseCategoryOptions.map(opt => {
                                    const hidden = hiddenCategoryIds.has(opt.id);
                                    return (
                                        <button
                                            key={opt.id}
                                            type="button"
                                            onClick={() => toggleHiddenCategory(opt.id)}
                                            className={cn(
                                                "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
                                                hidden
                                                    ? "bg-base-100 dark:bg-base-900 text-base-400 dark:text-base-600 line-through"
                                                    : "bg-secondary-100 dark:bg-secondary-900/40 text-secondary-700 dark:text-secondary-300"
                                            )}
                                        >
                                            <span
                                                className="h-2 w-2 rounded-full shrink-0"
                                                style={{ backgroundColor: hidden ? undefined : colorForSlice(opt.id) }}
                                            />
                                            {opt.name}
                                        </button>
                                    );
                                })}
                                {hiddenCategoryIds.size > 0 && (
                                    <button
                                        type="button"
                                        onClick={resetCategoryFilter}
                                        className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors"
                                    >
                                        <RotateCcw className="h-3 w-3" />
                                        Reset
                                    </button>
                                )}
                            </div>
                        )}
                        {categoryBreakdown.all.length === 0 ? (
                            <div className="text-sm text-base-500 py-4 text-center">
                                {hiddenCategoryIds.size > 0 ? "All categories are hidden." : "No expenses in this period."}
                            </div>
                        ) : (
                            <>
                                <div className="h-[140px] w-full mb-4">
                                    <ResponsiveContainer width="100%" height="100%" minHeight={140}>
                                        <PieChart>
                                            <Pie
                                                data={pieSlices}
                                                dataKey="amount"
                                                nameKey="name"
                                                innerRadius="55%"
                                                outerRadius="90%"
                                                paddingAngle={2}
                                                stroke="none"
                                            >
                                                {pieSlices.map((slice) => (
                                                    <Cell key={slice.id} fill={colorForSlice(slice.id)} />
                                                ))}
                                            </Pie>
                                            <Tooltip
                                                content={({ active, payload }) => {
                                                    if (!active || !payload || !payload.length) return null;
                                                    const slice = payload[0].payload as { name: string; amount: number };
                                                    const pct = categoryBreakdown.total > 0 ? (slice.amount / categoryBreakdown.total) * 100 : 0;
                                                    return (
                                                        <div className="bg-base-50 dark:bg-base-900 border border-base-200 dark:border-base-800 p-2.5 rounded-lg shadow-xl">
                                                            <p className="text-sm font-semibold text-base-900 dark:text-base-50">{slice.name}</p>
                                                            <p className="text-sm font-bold text-base-900 dark:text-base-50">
                                                                {slice.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                                                <span className="text-base-400 ml-1.5 font-normal">{pct.toFixed(0)}%</span>
                                                            </p>
                                                        </div>
                                                    );
                                                }}
                                            />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                                <div className="space-y-3">
                                    {categoryBreakdown.top.map(cat => {
                                        const pct = categoryBreakdown.total > 0 ? (cat.amount / categoryBreakdown.total) * 100 : 0;
                                        return (
                                            <div key={cat.id}>
                                                <div className="flex items-center justify-between mb-1.5">
                                                    <span className="flex items-center gap-1.5 text-sm text-base-700 dark:text-base-300">
                                                        <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: colorForSlice(cat.id) }} />
                                                        {cat.icon} {cat.name}
                                                    </span>
                                                    <span className="font-mono text-xs text-base-500">
                                                        {cat.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                                        <span className="text-base-400 ml-1">· {pct.toFixed(0)}%</span>
                                                    </span>
                                                </div>
                                                <div className="h-1.5 rounded-full bg-base-100 dark:bg-base-800 overflow-hidden">
                                                    <div className="h-full" style={{ width: `${(cat.amount / categoryBreakdown.max) * 100}%`, backgroundColor: colorForSlice(cat.id) }} />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </>
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
                                <Select
                                    required
                                    placeholder="Select Account"
                                    value={formData.accountId}
                                    onChange={(accountId) => setFormData({ ...formData, accountId })}
                                    options={accounts.map(acc => ({ value: acc.id, label: acc.name }))}
                                />
                            </div>
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <label className="text-sm font-medium text-base-700 dark:text-base-300">Category</label>
                                    <button
                                        type="button"
                                        onClick={() => setIsCreatingCategory(!isCreatingCategory)}
                                        className="text-xs text-primary-600 hover:underline"
                                    >
                                        {isCreatingCategory ? "Cancel" : "+ New Category"}
                                    </button>
                                </div>
                                {isCreatingCategory ? (
                                    <div className="space-y-2 rounded-lg border border-dashed border-base-300 dark:border-base-700 p-2">
                                        <Input
                                            placeholder="e.g. Food, Salary"
                                            value={newCategoryName}
                                            onChange={(e) => setNewCategoryName(e.target.value)}
                                        />
                                        <div className="flex items-center gap-2">
                                            <div className="flex flex-1 p-0.5 bg-base-100 dark:bg-base-900 rounded-md">
                                                {(["expense", "income"] as const).map(t => (
                                                    <button
                                                        key={t}
                                                        type="button"
                                                        onClick={() => setNewCategoryType(t)}
                                                        className={`flex-1 py-1 text-xs font-medium rounded transition-all capitalize ${newCategoryType === t ? 'bg-white dark:bg-base-700 shadow-sm text-base-900 dark:text-base-50' : 'text-base-500 dark:text-base-400'}`}
                                                    >
                                                        {t}
                                                    </button>
                                                ))}
                                            </div>
                                            <Button
                                                type="button"
                                                size="sm"
                                                disabled={!newCategoryName.trim() || isSavingCategory}
                                                onClick={handleCreateCategory}
                                            >
                                                {isSavingCategory ? "Adding…" : "Add"}
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <Select
                                        required
                                        placeholder="Select Category"
                                        value={formData.categoryId}
                                        onChange={(categoryId) => setFormData({ ...formData, categoryId })}
                                        options={categories.map(cat => ({ value: cat.id, label: `${cat.name} (${cat.type})` }))}
                                    />
                                )}
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-base-700 dark:text-base-300">Currency</label>
                                <Select
                                    required
                                    placeholder="Select Currency"
                                    value={formData.currency}
                                    onChange={(currency) => setFormData({ ...formData, currency })}
                                    options={currencies.map(curr => ({ value: curr.code, label: `${curr.code} - ${curr.name}` }))}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-base-700 dark:text-base-300">Amount</label>
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
                                <label className="text-sm font-medium text-base-700 dark:text-base-300">Date</label>
                                <Input
                                    type="date"
                                    required
                                    value={formData.date.split('T')[0]}
                                    onChange={(e) => setFormData({ ...formData, date: e.target.value + 'T12:00:00Z' })}
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-base-700 dark:text-base-300">Description</label>
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
                                <label className="text-sm font-medium text-base-700 dark:text-base-300">From Account</label>
                                <Select
                                    required
                                    placeholder="Select Source"
                                    value={transferData.fromAccountId}
                                    onChange={(fromAccountId) => setTransferData({ ...transferData, fromAccountId })}
                                    options={accounts.map(acc => ({ value: acc.id, label: acc.name, disabled: acc.id === transferData.toAccountId }))}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-base-700 dark:text-base-300">To Account</label>
                                <Select
                                    required
                                    placeholder="Select Destination"
                                    value={transferData.toAccountId}
                                    onChange={(toAccountId) => setTransferData({ ...transferData, toAccountId })}
                                    options={accounts.map(acc => ({ value: acc.id, label: acc.name, disabled: acc.id === transferData.fromAccountId }))}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-base-700 dark:text-base-300">Amount</label>
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
                                <label className="text-sm font-medium text-base-700 dark:text-base-300">Date</label>
                                <Input
                                    type="date"
                                    required
                                    value={transferData.date.split('T')[0]}
                                    onChange={(e) => setTransferData({ ...transferData, date: e.target.value + 'T12:00:00Z' })}
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-base-700 dark:text-base-300">Description</label>
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
                        <Select
                            className="min-w-40"
                            value={filterCategory}
                            onChange={setFilterCategory}
                            options={[
                                { value: "all", label: "All Activity" },
                                { value: "trade", label: "Trades Only" },
                                { value: "transaction", label: "Transactions Only" },
                            ]}
                        />
                    </div>

                    <div className="space-y-1">
                        <label className="text-xs font-medium text-base-500 dark:text-base-400">Account</label>
                        <Select
                            className="min-w-40"
                            value={filterAccount}
                            onChange={setFilterAccount}
                            options={[
                                { value: "all", label: "All Accounts" },
                                ...accounts.map(acc => ({ value: acc.id, label: acc.name })),
                            ]}
                        />
                    </div>

                    <div className="space-y-1">
                        <label className="text-xs font-medium text-base-500 dark:text-base-400">Sub-Portfolio</label>
                        <Select
                            className="min-w-40"
                            value={filterSubportfolio}
                            onChange={setFilterSubportfolio}
                            disabled={filterCategory === "transaction"}
                            options={[
                                { value: "all", label: "All Sub-Portfolios" },
                                { value: "none", label: "No Sub-Portfolio" },
                                ...subportfolios.map(sp => ({ value: sp.id, label: sp.name })),
                            ]}
                        />
                    </div>
                </CardContent>
            </Card>

            <Card className="overflow-hidden">
                <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap">
                    <CardTitle>All Activity</CardTitle>
                    <div className="flex items-center gap-1 rounded-lg bg-base-100 dark:bg-base-800 p-0.5" role="group" aria-label="Group activity by">
                        {HISTORY_GRANULARITIES.map(g => (
                            <button
                                key={g.value}
                                type="button"
                                onClick={() => setHistoryGranularity(g.value)}
                                aria-pressed={historyGranularity === g.value}
                                className={cn(
                                    "px-3 py-1 text-xs font-medium rounded-md transition-colors",
                                    historyGranularity === g.value
                                        ? "bg-white dark:bg-base-700 text-base-900 dark:text-base-50 shadow-sm"
                                        : "text-base-500 dark:text-base-400 hover:text-base-900 dark:hover:text-base-100"
                                )}
                            >
                                {g.label}
                            </button>
                        ))}
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    {groupedHistory.length === 0 && (
                        <div className="py-8 text-center text-base-500">
                            No historical activity found matching these filters.
                        </div>
                    )}
                    {groupedHistory.map(({ key, label, items, summary }) => (
                        <div key={key}>
                            <div className="flex items-center justify-between gap-3 flex-wrap px-6 py-2 text-[10px] font-mono font-semibold uppercase tracking-wider text-base-400 dark:text-base-500 bg-base-50/50 dark:bg-base-900/50 border-y border-base-100 dark:border-base-800">
                                <span>{label}</span>
                                <span className="flex items-center gap-3 normal-case tracking-normal">
                                    {summary.inflow > 0 && (
                                        <span className="text-emerald-600 dark:text-emerald-400">+{formatHomeAmount(summary.inflow)}</span>
                                    )}
                                    {summary.outflow > 0 && (
                                        <span className="text-red-500">−{formatHomeAmount(summary.outflow)}</span>
                                    )}
                                    {(summary.inflow > 0 && summary.outflow > 0) && (
                                        <span className={cn("text-base-600 dark:text-base-300", summary.net > 0 && "text-emerald-600 dark:text-emerald-400", summary.net < 0 && "text-red-500")}>
                                            net {summary.net < 0 ? "−" : "+"}{formatHomeAmount(summary.net)}
                                        </span>
                                    )}
                                    {summary.unconverted > 0 && (
                                        <span
                                            className="text-base-400 dark:text-base-500"
                                            title={`${summary.unconverted} ${summary.unconverted === 1 ? "entry has" : "entries have"} no ${baseCurrency} value and ${summary.unconverted === 1 ? "is" : "are"} not included`}
                                        >
                                            partial
                                        </span>
                                    )}
                                </span>
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
