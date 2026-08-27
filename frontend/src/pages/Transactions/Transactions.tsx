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
import { Input } from "../../components/ui/Input"
import { Select } from "../../components/ui/Select"
import { TopBar } from "../../components/TopBar"
import { OwnershipTag } from "../../components/ui/OwnershipTag"
import { useAuth } from "../../lib/AuthContext"
import { useViewMode } from "../../lib/ViewModeContext"
import type { HistoryGranularity } from "../../lib/historyGroups"
import { LogTransactionDialog } from "./LogTransactionDialog"
import { useTransactionHistory } from "./useTransactionHistory"
import {
    CATEGORY_PERIOD_OPTIONS,
    HISTORY_GRANULARITIES,
    categoryFilterStorageKey,
    categoryIcon,
    historyGranularityStorageKey,
    type CategoryPeriodPreset,
    type UnifiedHistoryItem,
} from "./transactionsHelpers"
import { cn } from "../../lib/utils"

export { transactionsLoader as loader } from "./transactions.loader";

export default function Transactions() {
    const { activeHousehold } = useHousehold()
    const { user } = useAuth();
    const { viewMode, hasHousehold } = useViewMode();
    const { trades = [], transactions = [], assets = [], categories = [], accounts = [], subportfolios = [], currencies = [], mccs = [] } = (useLoaderData() as HistoryLoaderData) || {};
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
        description: "",
        // Optional even when the field is shown — most purchases have no code the
        // user knows, so blank is the normal state, not an error.
        mcc: "",
        // Part of this bill is somebody else's. The amount stays the full sum
        // that leaves the account — this only says whose it was.
        owedBy: "",
        owedAmount: ""
    });
    const [isSplitting, setIsSplitting] = useState(false);

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

    // The catalogue already arrives general-codes-first with the ~400 airline and
    // hotel brands last, so there is nothing to sort here. Select filters on the
    // label, so a brand is still one search away. A blank first option keeps
    // "I don't know it" a click, not a chore of clearing a value.
    const mccOptions = useMemo(() => [
        { value: "", label: "— None —" },
        ...mccs.map(m => ({ value: m.code, label: `${m.code} · ${m.name}` })),
    ], [mccs]);

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
            const owedBy = isSplitting ? formData.owedBy.trim() : "";
            const owedAmount = isSplitting ? parseFloat(formData.owedAmount) : NaN;
            const isSplit = owedBy.length > 0 && Number.isFinite(owedAmount) && owedAmount > 0;
            await api.post("/cashflow/transactions", {
                account_id: formData.accountId,
                category_id: formData.categoryId,
                date: formData.date,
                amount: parseFloat(formData.amount),
                currency: formData.currency,
                description: formData.description,
                // Blank is sent as-is; the API treats "" as "not given" rather than
                // rejecting it, so there is nothing to convert here.
                mcc: formData.mcc,
                // Sent together or not at all — the API rejects half a split.
                ...(isSplit ? { owed_by: owedBy, owed_amount: owedAmount } : {})
            });
            setIsLogModalOpen(false);
            setIsSplitting(false);
            setFormData({
                accountId: defaultAccountId(),
                categoryId: "",
                amount: "",
                currency: activeHousehold?.base_currency || "USD",
                date: new Date().toISOString().split('T')[0] + 'T12:00:00Z',
                description: "",
                mcc: "",
                owedBy: "",
                owedAmount: ""
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

    const toggleHiddenCategory = (id: string) => {
        setHiddenCategoryIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const resetCategoryFilter = () => setHiddenCategoryIds(new Set());

    // Trades + transactions reconciled into one filtered, grouped, charted view.
    const {
        colorForSlice,
        groupedHistory,
        cashflowData,
        expenseCategoryOptions,
        categoryBreakdown,
        pieSlices,
    } = useTransactionHistory({
        trades, transactions, assets, categories, accounts, subportfolios,
        user, viewMode, activeHousehold, baseCurrency,
        filterCategory, filterAccount, filterSubportfolio, filterFlow,
        hiddenCategoryIds, categoryPeriod, categoryPeriodStart, categoryPeriodEnd,
        historyGranularity,
    })

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
                                    onChange={(v) => {
                                        const next = v as CategoryPeriodPreset;
                                        setCategoryPeriod(next);
                                        // Seed an anchor so "Specific month" never silently behaves
                                        // like "All time" under a label that says otherwise.
                                        if (next === "specific_month" && !categoryPeriodStart) {
                                            const now = new Date();
                                            setCategoryPeriodStart(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`);
                                        }
                                    }}
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
                        {categoryPeriod === "specific_month" && (
                            <div className="flex items-center gap-2 mb-4">
                                <Input
                                    type="month"
                                    className="text-xs"
                                    // Stored as a full date; the month input only wants YYYY-MM.
                                    value={categoryPeriodStart.slice(0, 7)}
                                    onChange={(e) => setCategoryPeriodStart(e.target.value ? `${e.target.value}-01` : "")}
                                />
                            </div>
                        )}
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
            <LogTransactionDialog
                isOpen={isLogModalOpen}
                onClose={() => setIsLogModalOpen(false)}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                accounts={accounts}
                categories={categories}
                currencies={currencies}
                mccOptions={mccOptions}
                user={user}
                formData={formData}
                setFormData={setFormData}
                onSubmitTransaction={handleLogTransaction}
                transferData={transferData}
                setTransferData={setTransferData}
                onSubmitTransfer={handleTransfer}
                isSubmitting={isSubmitting}
                isSplitting={isSplitting}
                setIsSplitting={setIsSplitting}
                baseCurrency={baseCurrency}
                isCreatingCategory={isCreatingCategory}
                setIsCreatingCategory={setIsCreatingCategory}
                newCategoryName={newCategoryName}
                setNewCategoryName={setNewCategoryName}
                newCategoryType={newCategoryType}
                setNewCategoryType={setNewCategoryType}
                isSavingCategory={isSavingCategory}
                onCreateCategory={handleCreateCategory}
            />

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
                                                {/*
                                                  The row still shows the full amount, because that is what
                                                  left the account. This says how much of it wasn't yours,
                                                  which is otherwise invisible on a page of full amounts.
                                                */}
                                                {item.split && (
                                                    <p className="text-xs text-amber-600 dark:text-amber-400 leading-tight">
                                                        {formatHomeAmount(item.split.owedAmount)} owed by {item.split.owedBy}
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
