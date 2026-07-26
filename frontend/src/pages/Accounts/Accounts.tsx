import { useState, useMemo, useEffect } from "react";
import { useLoaderData, useFetcher, Link } from "react-router";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { StatCard } from "../../components/ui/StatCard";
import { OwnershipTag } from "../../components/ui/OwnershipTag";
import { TopBar } from "../../components/TopBar";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { useHousehold } from "../../lib/HouseholdContext";
import { useAuth } from "../../lib/AuthContext";
import { useViewMode, isVisibleInViewMode } from "../../lib/ViewModeContext";
import { summarizeAccounts, cashChartAccountsOf, latestBalanceHome } from "../../lib/networth";
import { AccountKind, LiquidityStatus, TaxTreatment } from "../../types/types";
import type { AccountsLoaderData } from "./accounts.loader";
import type { AccountResponse, BalanceResponse, LoanScheduleResponse } from "../../types/types";

export { loader, action } from "./accounts.loader";

// Add a color palette for the different accounts
const CHART_COLORS = [
    "#0ea5e9", // Sky blue
    "#10b981", // Emerald green
    "#8b5cf6", // Violet
    "#f59e0b", // Amber
    "#ec4899", // Pink
    "#14b8a6", // Teal
    "#f43f5e", // Rose
    "#6366f1", // Indigo
];

const LIQUIDITY_META: Record<string, { label: string; className: string }> = {
    [LiquidityStatus.Liquid]: { label: "LIQUID", className: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10" },
    [LiquidityStatus.MarketLiquid]: { label: "MARKET", className: "text-primary-600 dark:text-primary-400 bg-primary-500/10" },
    [LiquidityStatus.TimeLocked]: { label: "TIME-LOCK", className: "text-amber-600 dark:text-amber-400 bg-amber-500/10" },
    [LiquidityStatus.Retirement]: { label: "RETIREMENT", className: "text-amber-600 dark:text-amber-400 bg-amber-500/10" },
    [LiquidityStatus.Illiquid]: { label: "PROPERTY", className: "text-violet-600 dark:text-violet-400 bg-violet-500/10" },
};

const LIQUIDITY_LABELS: Record<string, string> = {
    [LiquidityStatus.Liquid]: "liquid — cash you can spend today",
    [LiquidityStatus.MarketLiquid]: "market — sellable investments",
    [LiquidityStatus.TimeLocked]: "time-locked — fixed deposits, CPF",
    [LiquidityStatus.Retirement]: "retirement — SRS, pension",
    [LiquidityStatus.Illiquid]: "property — home, car, physical assets",
};

const TAX_META: Record<string, { label: string; className: string }> = {
    [TaxTreatment.Taxable]: { label: "TAXABLE", className: "text-base-500 dark:text-base-400 bg-base-200/60 dark:bg-base-800" },
    [TaxTreatment.TaxDeferred]: { label: "TAX-DEFER", className: "text-secondary-600 dark:text-secondary-400 bg-secondary-500/10" },
    [TaxTreatment.TaxFree]: { label: "TAX-FREE", className: "text-secondary-600 dark:text-secondary-400 bg-secondary-500/10" },
};

const ACCOUNT_GROUPS: { key: string; label: string; liquidities: LiquidityStatus[] }[] = [
    { key: "cash", label: "Cash & liquid", liquidities: [LiquidityStatus.Liquid] },
    { key: "invest", label: "Investments", liquidities: [LiquidityStatus.MarketLiquid] },
    { key: "retirement", label: "Retirement · CPF & SRS", liquidities: [LiquidityStatus.TimeLocked, LiquidityStatus.Retirement] },
    { key: "property", label: "Property & physical assets", liquidities: [LiquidityStatus.Illiquid] },
];

function initialsFor(name: string) {
    return (name.split(/\s+/)[0] || name).slice(0, 4).toUpperCase();
}

/**
 * Whether a liability has enough detail to be amortized. Mirrors
 * `loan_terms_for` on the backend: without all four the account keeps its
 * flat manual balance and there is no schedule to show.
 */
export function hasLoanTerms(account: Pick<AccountResponse, "kind" | "original_principal" | "interest_rate_annual" | "loan_term_months" | "loan_start_date">) {
    return (
        account.kind === AccountKind.Liability &&
        Number(account.original_principal) > 0 &&
        account.interest_rate_annual != null &&
        Number(account.loan_term_months) > 0 &&
        !!account.loan_start_date
    );
}

export default function Accounts() {
    const { activeHousehold } = useHousehold();
    const { user } = useAuth();
    const { viewMode, hasHousehold } = useViewMode();
    const { accounts: allAccounts = [], currencies = [], equity: allEquity = [] } = (useLoaderData() as AccountsLoaderData) || {};
    const accounts = useMemo(
        () => allAccounts.filter(a => isVisibleInViewMode(a.owner_user_id, viewMode, user?.id)),
        [allAccounts, viewMode, user?.id]
    );
    // Liabilities (loans, mortgages) are excluded from the cash chart and
    // subtracted — not added — in the summary aggregates.
    const assetAccounts = useMemo(() => accounts.filter(a => a.kind !== AccountKind.Liability), [accounts]);
    // The balance chart is about spendable money over time. A house is an asset
    // and belongs in net worth, but stacking a 500k valuation onto the cash
    // chart would flatten every other account into the baseline.
    const cashChartAccounts = useMemo(() => cashChartAccountsOf(accounts), [accounts]);
    const equityRows = useMemo(
        () => allEquity.filter(row => accounts.some(a => a.id === row.asset_account_id)),
        [allEquity, accounts]
    );
    // Candidates a loan can be secured against.
    const propertyAccounts = useMemo(
        () => assetAccounts.filter(a => a.liquidity === LiquidityStatus.Illiquid),
        [assetAccounts]
    );

    // We use fetchers for mutations to avoid full page navigations and to easily keep modals open/closed based on state
    const addAccountFetcher = useFetcher();
    const editAccountFetcher = useFetcher();
    const updateBalanceFetcher = useFetcher();
    const deleteAccountFetcher = useFetcher();
    const deleteBalanceFetcher = useFetcher();
    // The amortization schedule is large and only wanted on demand, so it is
    // fetched from the API directly rather than loaded with the page.
    const loanScheduleFetcher = useFetcher<LoanScheduleResponse>();

    const [isAddAccountModalOpen, setIsAddAccountModalOpen] = useState(false);
    const emptyNewAccount = {
        name: "",
        liquidity: LiquidityStatus.Liquid as LiquidityStatus,
        tax_status: TaxTreatment.Taxable as TaxTreatment,
        kind: AccountKind.Asset as AccountKind,
        balance: "",
        currency: "USD",
        date: new Date().toISOString().split('T')[0],
        isPrivate: user?.default_new_items_private ?? true,
        // Optional loan terms — blank means "no terms", i.e. the old flat-balance
        // behaviour.
        original_principal: "",
        interest_rate_annual: "",
        loan_term_months: "",
        monthly_payment: "",
        loan_start_date: "",
        // Optional property terms.
        appreciation_rate_annual: "",
        linked_account_id: "",
    };
    const [newAccount, setNewAccount] = useState(emptyNewAccount);


    const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
    const [updateBalanceData, setUpdateBalanceData] = useState({ accountId: "", date: new Date().toISOString().split('T')[0], balance: "" });

    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [accountToDelete, setAccountToDelete] = useState<{ id: string, name: string } | null>(null);

    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
    const [historyAccountId, setHistoryAccountId] = useState<string | null>(null);

    const [editAccountId, setEditAccountId] = useState<string | null>(null);
    const [scheduleAccountId, setScheduleAccountId] = useState<string | null>(null);

    const openScheduleModal = (accountId: string) => {
        setScheduleAccountId(accountId);
        loanScheduleFetcher.load(`/accounts/loan-schedule/${accountId}`);
    };

    // Close modals on successful submission
    useEffect(() => {
        if (addAccountFetcher.state === "idle" && addAccountFetcher.data?.success) {
            setIsAddAccountModalOpen(false);
            setNewAccount(emptyNewAccount);
        }
    }, [addAccountFetcher.state, addAccountFetcher.data]);

    useEffect(() => {
        if (editAccountFetcher.state === "idle" && editAccountFetcher.data?.success) {
            setEditAccountId(null);
        }
    }, [editAccountFetcher.state, editAccountFetcher.data]);

    useEffect(() => {
        if (updateBalanceFetcher.state === "idle" && updateBalanceFetcher.data?.success) {
            setIsUpdateModalOpen(false);
        }
    }, [updateBalanceFetcher.state, updateBalanceFetcher.data]);

    useEffect(() => {
        if (deleteAccountFetcher.state === "idle" && deleteAccountFetcher.data?.success) {
            setIsDeleteModalOpen(false);
            setAccountToDelete(null);
        }
    }, [deleteAccountFetcher.state, deleteAccountFetcher.data]);

    useEffect(() => {
        if (deleteBalanceFetcher.state === "idle" && deleteBalanceFetcher.data?.error) {
            alert(deleteBalanceFetcher.data.error);
        }
    }, [deleteBalanceFetcher.state, deleteBalanceFetcher.data]);

    const formatCurrency = (value: number, curr?: string) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: curr || activeHousehold?.base_currency || 'USD'
        }).format(value);
    }

    const getCurrentBalanceDetails = (history: BalanceResponse[]) => {
        if (history.length === 0) return { balance: 0, balanceHome: 0 };
        // ⚡ Bolt Performance Optimization: Replace O(N log N) sorting with an O(N) single-pass reduce
        const last = history.reduce((max, current) => current.date > max.date ? current : max, history[0]);
        return {
            balance: Number(last.balance),
            balanceHome: latestBalanceHome(history)
        };
    }

    // ⚡ Bolt Performance Optimization:
    // Replaced O(N^2) nested `.find()` operations inside `.map()`
    // with O(N) hash map lookups to prevent main-thread blocking. Also replaced `localeCompare`.
    const aggregatedChartData = useMemo(() => {
        const allDatesSet = new Set<string>();
        const balancesByDate = new Map<string, Array<{ id: string, name: string, bal: number }>>();

        cashChartAccounts.forEach(acc => {
            acc.history.forEach(h => {
                allDatesSet.add(h.date);
                const list = balancesByDate.get(h.date) || [];
                list.push({ id: acc.id, name: acc.name, bal: Number(h.balance_home_currency ?? h.balance) });
                balancesByDate.set(h.date, list);
            });
        });

        const sortedDates = Array.from(allDatesSet).sort((a, b) => (a < b ? -1 : (a > b ? 1 : 0)));

        const accountLatestBalances = new Map<string, number>();
        const allAccountNames = Array.from(new Set(cashChartAccounts.map(acc => acc.name)));

        return sortedDates.map(date => {
            const dataPoint: any = { date };

            const updates = balancesByDate.get(date);
            if (updates) {
                updates.forEach(u => accountLatestBalances.set(u.name, u.bal));
            }

            allAccountNames.forEach(name => {
                dataPoint[name] = accountLatestBalances.get(name) || 0;
            });

            return dataPoint;
        });
    }, [cashChartAccounts]);

    const editAccount = useMemo(
        () => accounts.find(a => a.id === editAccountId) || null,
        [accounts, editAccountId]
    );
    const loanSchedule = loanScheduleFetcher.data?.schedule ?? null;

    const historyAccount = useMemo(() => {
        if (!historyAccountId) return null;
        return accounts.find(a => a.id === historyAccountId) || null;
    }, [accounts, historyAccountId]);

    const summaryStats = useMemo(() => summarizeAccounts(accounts), [accounts]);

    const totalEquity = useMemo(
        () => equityRows.reduce((sum, row) => sum + Number(row.equity), 0),
        [equityRows]
    );

    const accountGroups = useMemo(() => {
        const groups = ACCOUNT_GROUPS.map(group => {
            const groupAccounts = assetAccounts
                .filter(acc => group.liquidities.includes(acc.liquidity))
                .sort((a, b) => getCurrentBalanceDetails(b.history).balanceHome - getCurrentBalanceDetails(a.history).balanceHome);
            const groupTotal = groupAccounts.reduce((sum, acc) => sum + getCurrentBalanceDetails(acc.history).balanceHome, 0);
            return { ...group, accounts: groupAccounts, total: groupTotal, isLiability: false };
        });
        const liabilityAccounts = accounts
            .filter(acc => acc.kind === AccountKind.Liability)
            .sort((a, b) => getCurrentBalanceDetails(b.history).balanceHome - getCurrentBalanceDetails(a.history).balanceHome);
        groups.push({
            key: "liabilities",
            label: "Loans & liabilities",
            liquidities: [],
            accounts: liabilityAccounts,
            total: -liabilityAccounts.reduce((sum, acc) => sum + getCurrentBalanceDetails(acc.history).balanceHome, 0),
            isLiability: true,
        });
        return groups.filter(group => group.accounts.length > 0);
    }, [accounts, assetAccounts]);

    const openUpdateModal = (accountId: string) => {
        setUpdateBalanceData({ accountId, date: new Date().toISOString().split('T')[0], balance: "" });
        setIsUpdateModalOpen(true);
    }

    if (!activeHousehold) {
        return (
            <div className="flex-1 flex items-center justify-center p-8 text-base-500">
                Please select or create a household to view accounts.
            </div>
        )
    }

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            <TopBar
                title="Accounts"
                commandPlaceholder="Log or find…"
                cta={<Button variant="cta" onClick={() => setIsAddAccountModalOpen(true)}>+ Link account</Button>}
            />
            <div className="flex-1 overflow-y-auto space-y-6 p-8 relative">
                <p className="text-base-500 dark:text-base-400 -mt-2">Manage and track your cash balances for {activeHousehold.name}.</p>

                {/* Summary stats */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <StatCard
                        title={summaryStats.liabilities > 0 ? "Net in accounts" : "In accounts"}
                        value={formatCurrency(summaryStats.net)}
                        description={summaryStats.liabilities > 0
                            ? `${formatCurrency(summaryStats.totalAssets)} assets − ${formatCurrency(summaryStats.liabilities)} debt`
                            : undefined}
                    />
                    <StatCard title="Liquid now" value={formatCurrency(summaryStats.liquidNow)} />
                    {summaryStats.property > 0 ? (
                        <StatCard
                            title="Home equity"
                            value={formatCurrency(totalEquity)}
                            description={`${formatCurrency(summaryStats.property)} property − ${formatCurrency(summaryStats.property - totalEquity)} secured debt`}
                        />
                    ) : (
                        <StatCard title="Retirement" value={formatCurrency(summaryStats.retirement)} />
                    )}
                    <StatCard title="Currencies" value={summaryStats.currencies.join(" · ") || "—"} />
                </div>

                {/* Home equity — property netted against the loan secured on it */}
                {equityRows.length > 0 && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Property & equity</CardTitle>
                            <CardDescription>What you actually own, after the debt secured against it.</CardDescription>
                        </CardHeader>
                        <CardContent className="p-0">
                            {equityRows.map(row => {
                                const owned = Math.max(0, Math.min(100, Number(row.equity_percent ?? 0)));
                                return (
                                    <div key={row.asset_account_id} className="px-4 py-3 border-b last:border-b-0 border-base-100 dark:border-base-800/70">
                                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                                            <span className="font-medium text-base-900 dark:text-base-50">{row.asset_account_name}</span>
                                            <span className="font-mono font-semibold text-base-900 dark:text-base-50">
                                                {formatCurrency(Number(row.equity))} equity
                                            </span>
                                        </div>
                                        <div className="mt-2 h-2 w-full rounded-full bg-red-500/20 overflow-hidden">
                                            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${owned}%` }} />
                                        </div>
                                        <div className="mt-1.5 flex flex-wrap justify-between gap-2 text-[11px] font-mono text-base-500 dark:text-base-400">
                                            <span>{formatCurrency(Number(row.asset_value))} value</span>
                                            <span>
                                                {row.loan_account_name
                                                    ? `${formatCurrency(Number(row.loan_balance))} owed on ${row.loan_account_name}`
                                                    : "no loan linked"}
                                            </span>
                                            <span>{owned.toFixed(1)}% owned</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </CardContent>
                    </Card>
                )}

                {/* Chart Section */}
                <Card>
                    <CardHeader>
                        <CardTitle>Total Cash Balance</CardTitle>
                        <CardDescription>Your combined liquid assets over time, broken down by account. Property is excluded — see net worth on the dashboard.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[350px] w-full">
                            {aggregatedChartData.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%" minHeight={350}>
                                    <AreaChart data={aggregatedChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                        <defs>
                                            {/* UPDATED: Map over accounts to generate a gradient for each */}
                                            {cashChartAccounts.map((acc, index) => (
                                                <linearGradient key={`color-${acc.id}`} id={`color-${acc.id}`} x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor={CHART_COLORS[index % CHART_COLORS.length]} stopOpacity={0.4} />
                                                    <stop offset="95%" stopColor={CHART_COLORS[index % CHART_COLORS.length]} stopOpacity={0} />
                                                </linearGradient>
                                            ))}
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-base-200)" className="dark:opacity-10" />
                                        <XAxis
                                            dataKey="date"
                                            axisLine={false}
                                            tickLine={false}
                                            tick={{ fill: 'var(--color-base-400)', fontSize: 12 }}
                                            dy={10}
                                        />
                                        <YAxis
                                            axisLine={false}
                                            tickLine={false}
                                            tick={{ fill: 'var(--color-base-400)', fontSize: 12 }}
                                            tickFormatter={(value) => `$${value / 1000}k`}
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
                                                                            {entry.name}
                                                                        </span>
                                                                        <span className="text-sm font-bold text-base-900 dark:text-base-50">
                                                                            {formatCurrency(entry.value)}
                                                                        </span>
                                                                    </div>
                                                                ))}
                                                                <div className="pt-1.5 mt-1.5 border-t border-base-200 dark:border-base-800 flex items-center justify-between gap-4">
                                                                    <span className="text-sm font-medium text-base-900 dark:text-base-50">Total</span>
                                                                    <span className="text-sm font-bold text-base-900 dark:text-base-50">
                                                                        {formatCurrency(payload.reduce((sum: number, entry: any) => sum + Number(entry.value), 0))}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                }
                                                return null;
                                            }}
                                        />
                                        {/* UPDATED: Map over accounts to render a stacked area for each */}
                                        {cashChartAccounts.map((acc, index) => (
                                            <Area
                                                key={acc.id}
                                                type="monotone"
                                                dataKey={acc.name}
                                                stackId="1" // This stacks them on top of each other!
                                                stroke={CHART_COLORS[index % CHART_COLORS.length]}
                                                strokeWidth={2}
                                                fillOpacity={1}
                                                fill={`url(#color-${acc.id})`}
                                            />
                                        ))}
                                    </AreaChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="flex h-full items-center justify-center text-base-400">
                                    No balance history available yet.
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* Grouped accounts */}
                <div className="space-y-5">
                    {accountGroups.map(group => (
                        <div key={group.key}>
                            <div className="flex items-baseline gap-2 mb-2 px-1">
                                <h3 className="font-display font-bold text-sm text-base-900 dark:text-base-50">{group.label}</h3>
                                <span className={`font-mono text-xs ${group.isLiability ? "text-red-600 dark:text-red-400" : "text-base-500 dark:text-base-400"}`}>{formatCurrency(group.total)}</span>
                            </div>
                            <Card className="overflow-hidden">
                                <CardContent className="p-0">
                                    {group.accounts.map(acc => {
                                        const { balance, balanceHome } = getCurrentBalanceDetails(acc.history);
                                        const isLiability = acc.kind === AccountKind.Liability;
                                        const liquidityMeta = LIQUIDITY_META[acc.liquidity];
                                        const taxMeta = TAX_META[acc.tax_status];
                                        return (
                                            <div key={acc.id} className="flex flex-wrap items-center gap-3 px-4 py-3 border-b last:border-b-0 border-base-100 dark:border-base-800/70 hover:bg-base-50/50 dark:hover:bg-base-900/40 transition-colors">
                                                <div className={`w-9 h-9 rounded-lg flex items-center justify-center font-mono text-[10px] font-bold shrink-0 ${isLiability ? "bg-red-500/10 text-red-600 dark:text-red-400" : "bg-primary-500/10 text-primary-600 dark:text-primary-400"}`}>
                                                    {initialsFor(acc.name)}
                                                </div>
                                                <div className="flex-1 min-w-[140px]">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-medium text-base-900 dark:text-base-50">{acc.name}</span>
                                                        <OwnershipTag ownerUserId={acc.owner_user_id} show={hasHousehold && viewMode === "blended"} className="text-[9px] px-1.5 py-0 h-4" />
                                                    </div>
                                                    <div className="text-[10px] font-mono uppercase tracking-wide text-base-400 dark:text-base-500">{acc.currency}</div>
                                                </div>
                                                {isLiability ? (
                                                    <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-semibold text-red-600 dark:text-red-400 bg-red-500/10">LIABILITY</span>
                                                ) : liquidityMeta && (
                                                    <span className={`hidden sm:inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-semibold ${liquidityMeta.className}`}>{liquidityMeta.label}</span>
                                                )}
                                                {taxMeta && (
                                                    <span className={`hidden md:inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-semibold ${taxMeta.className}`}>{taxMeta.label}</span>
                                                )}
                                                <div className="text-right min-w-32 shrink-0">
                                                    <div className={`font-mono font-semibold whitespace-nowrap ${isLiability ? "text-red-600 dark:text-red-400" : "text-base-900 dark:text-base-50"}`}>{formatCurrency(isLiability ? -balanceHome : balanceHome)}</div>
                                                    {acc.currency !== activeHousehold?.base_currency && (
                                                        <div className="text-[10px] text-base-400 dark:text-base-500 font-mono whitespace-nowrap">{formatCurrency(isLiability ? -balance : balance, acc.currency)}</div>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-1 shrink-0 ml-auto">
                                                    {hasLoanTerms(acc) && (
                                                        <Button variant="ghost" size="sm" onClick={() => openScheduleModal(acc.id)}>Schedule</Button>
                                                    )}
                                                    <Button variant="ghost" size="sm" onClick={() => setEditAccountId(acc.id)}>Edit</Button>
                                                    <Button variant="ghost" size="sm" onClick={() => {
                                                        setHistoryAccountId(acc.id);
                                                        setIsHistoryModalOpen(true);
                                                    }}>History</Button>
                                                    <Link to={`/trade?account_id=${acc.id}`}>
                                                        <Button variant="ghost" size="sm">Trade</Button>
                                                    </Link>
                                                    <Button variant="ghost" size="sm" className="text-secondary-600 dark:text-secondary-400" onClick={() => openUpdateModal(acc.id)}>Update</Button>
                                                    <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => {
                                                        setAccountToDelete({ id: acc.id, name: acc.name });
                                                        setIsDeleteModalOpen(true);
                                                    }}>Delete</Button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </CardContent>
                            </Card>
                        </div>
                    ))}
                    {accounts.length === 0 && (
                        <Card>
                            <CardContent className="py-8 text-center text-base-500">
                                No accounts found for this household.
                            </CardContent>
                        </Card>
                    )}
                </div>

                {/* Add Account Modal */}
                {
                    isAddAccountModalOpen && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                            <Card className="w-full max-w-md bg-white dark:bg-base-900 shadow-xl border-base-200 dark:border-base-800">
                                <CardHeader>
                                    <CardTitle>Add Manual Account</CardTitle>
                                    <CardDescription>Enter your bank account details below.</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <addAccountFetcher.Form method="post" className="space-y-4">
                                        <input type="hidden" name="_intent" value="addAccount" />
                                        <input type="hidden" name="current_user_id" value={user?.id ?? ""} />
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium text-base-900 dark:text-base-50">Account Name</label>
                                            <Input
                                                name="name"
                                                placeholder="e.g. Chase Checking"
                                                value={newAccount.name}
                                                onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })}
                                                required
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium text-base-900 dark:text-base-50">Account Type</label>
                                            <Select
                                                name="kind"
                                                value={newAccount.kind}
                                                onChange={(kind) => setNewAccount({ ...newAccount, kind: kind as AccountKind })}
                                                options={[
                                                    { value: AccountKind.Asset, label: "Asset — cash, savings, investments" },
                                                    { value: AccountKind.Liability, label: "Liability — loan, mortgage, credit" },
                                                ]}
                                            />
                                            {newAccount.kind === AccountKind.Liability && (
                                                <p className="text-xs text-base-500 dark:text-base-400">Enter the outstanding balance as a positive number — it will be subtracted from your net worth.</p>
                                            )}
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <label className="text-sm font-medium text-base-900 dark:text-base-50">Liquidity</label>
                                                <Select
                                                    name="liquidity"
                                                    value={newAccount.liquidity}
                                                    onChange={(liquidity) => setNewAccount({ ...newAccount, liquidity: liquidity as LiquidityStatus })}
                                                    options={Object.values(LiquidityStatus).map(status => ({ value: status, label: LIQUIDITY_LABELS[status] ?? status.replace('_', ' ') }))}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-sm font-medium text-base-900 dark:text-base-50">Tax Status</label>
                                                <Select
                                                    name="tax_status"
                                                    value={newAccount.tax_status}
                                                    onChange={(tax_status) => setNewAccount({ ...newAccount, tax_status: tax_status as TaxTreatment })}
                                                    options={Object.values(TaxTreatment).map(status => ({ value: status, label: status.replace('_', ' ') }))}
                                                />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <label className="text-sm font-medium text-base-900 dark:text-base-50">Initial Balance</label>
                                                <Input
                                                    name="balance"
                                                    type="number"
                                                    step="0.01"
                                                    placeholder="0.00"
                                                    value={newAccount.balance}
                                                    onChange={(e) => setNewAccount({ ...newAccount, balance: e.target.value })}
                                                    required
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-sm font-medium text-base-900 dark:text-base-50">As of Date</label>
                                                <Input
                                                    name="date"
                                                    type="date"
                                                    value={newAccount.date}
                                                    onChange={(e) => setNewAccount({ ...newAccount, date: e.target.value })}
                                                    required
                                                />
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium text-base-900 dark:text-base-50">Currency</label>
                                            <Select
                                                name="currency"
                                                value={newAccount.currency}
                                                onChange={(currency) => setNewAccount({ ...newAccount, currency })}
                                                options={currencies.map(c => ({ value: c.code, label: `${c.code} - ${c.name}` }))}
                                            />
                                        </div>
                                        {/* Loan terms — only meaningful for a liability. Filling these
                                            in lets the app amortize the debt down on its own instead of
                                            waiting for the user to retype the balance each month. */}
                                        {newAccount.kind === AccountKind.Liability && (
                                            <div className="space-y-3 rounded-lg border border-base-200 dark:border-base-800 p-3">
                                                <div>
                                                    <p className="text-sm font-medium text-base-900 dark:text-base-50">Loan terms <span className="font-normal text-base-500">(optional)</span></p>
                                                    <p className="text-xs text-base-500 dark:text-base-400">Add these and we'll project the balance down to zero and show your payoff date.</p>
                                                </div>
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div className="space-y-1.5">
                                                        <label className="text-xs font-medium text-base-700 dark:text-base-300">Amount borrowed</label>
                                                        <Input
                                                            name="original_principal"
                                                            type="number"
                                                            step="0.01"
                                                            min="0"
                                                            placeholder="400000"
                                                            value={newAccount.original_principal}
                                                            onChange={(e) => setNewAccount({ ...newAccount, original_principal: e.target.value })}
                                                        />
                                                    </div>
                                                    <div className="space-y-1.5">
                                                        <label className="text-xs font-medium text-base-700 dark:text-base-300">Interest rate % / yr</label>
                                                        <Input
                                                            name="interest_rate_annual"
                                                            type="number"
                                                            step="0.01"
                                                            min="0"
                                                            max="100"
                                                            placeholder="3.5"
                                                            value={newAccount.interest_rate_annual}
                                                            onChange={(e) => setNewAccount({ ...newAccount, interest_rate_annual: e.target.value })}
                                                        />
                                                    </div>
                                                    <div className="space-y-1.5">
                                                        <label className="text-xs font-medium text-base-700 dark:text-base-300">Term (months)</label>
                                                        <Input
                                                            name="loan_term_months"
                                                            type="number"
                                                            step="1"
                                                            min="1"
                                                            max="720"
                                                            placeholder="300"
                                                            value={newAccount.loan_term_months}
                                                            onChange={(e) => setNewAccount({ ...newAccount, loan_term_months: e.target.value })}
                                                        />
                                                    </div>
                                                    <div className="space-y-1.5">
                                                        <label className="text-xs font-medium text-base-700 dark:text-base-300">First payment</label>
                                                        <Input
                                                            name="loan_start_date"
                                                            type="date"
                                                            value={newAccount.loan_start_date}
                                                            onChange={(e) => setNewAccount({ ...newAccount, loan_start_date: e.target.value })}
                                                        />
                                                    </div>
                                                </div>
                                                <div className="space-y-1.5">
                                                    <label className="text-xs font-medium text-base-700 dark:text-base-300">Monthly payment <span className="font-normal text-base-500">— leave blank to calculate</span></label>
                                                    <Input
                                                        name="monthly_payment"
                                                        type="number"
                                                        step="0.01"
                                                        min="0"
                                                        placeholder="Calculated from the terms above"
                                                        value={newAccount.monthly_payment}
                                                        onChange={(e) => setNewAccount({ ...newAccount, monthly_payment: e.target.value })}
                                                    />
                                                </div>
                                                <div className="space-y-1.5">
                                                    <label className="text-xs font-medium text-base-700 dark:text-base-300">Secured against</label>
                                                    <Select
                                                        name="linked_account_id"
                                                        value={newAccount.linked_account_id}
                                                        onChange={(linked_account_id) => setNewAccount({ ...newAccount, linked_account_id })}
                                                        options={[
                                                            { value: "", label: "Nothing — unsecured" },
                                                            ...propertyAccounts.map(a => ({ value: a.id, label: a.name })),
                                                        ]}
                                                    />
                                                </div>
                                            </div>
                                        )}

                                        {/* Property terms — only for physical assets. */}
                                        {newAccount.kind === AccountKind.Asset && newAccount.liquidity === LiquidityStatus.Illiquid && (
                                            <div className="space-y-1.5 rounded-lg border border-base-200 dark:border-base-800 p-3">
                                                <label className="text-sm font-medium text-base-900 dark:text-base-50">Expected appreciation % / yr <span className="font-normal text-base-500">(optional)</span></label>
                                                <Input
                                                    name="appreciation_rate_annual"
                                                    type="number"
                                                    step="0.1"
                                                    min="-100"
                                                    max="100"
                                                    placeholder="Leave blank to hold today's value flat"
                                                    value={newAccount.appreciation_rate_annual}
                                                    onChange={(e) => setNewAccount({ ...newAccount, appreciation_rate_annual: e.target.value })}
                                                />
                                                <p className="text-xs text-base-500 dark:text-base-400">Used only for the net worth projection. Your recorded valuations are never overwritten.</p>
                                            </div>
                                        )}

                                        {hasHousehold && (
                                            <label className="flex items-center gap-2.5 rounded-lg border border-base-200 dark:border-base-800 px-3 py-2.5 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    name="is_private"
                                                    checked={newAccount.isPrivate}
                                                    onChange={(e) => setNewAccount({ ...newAccount, isPrivate: e.target.checked })}
                                                    className="accent-secondary-500"
                                                />
                                                <span className="text-sm text-base-700 dark:text-base-300">🔒 Private — only visible to you</span>
                                            </label>
                                        )}
                                        <div className="flex gap-3 justify-end pt-4">
                                            <Button variant="ghost" type="button" onClick={() => setIsAddAccountModalOpen(false)}>Cancel</Button>
                                            <Button variant="primary" type="submit" disabled={addAccountFetcher.state !== "idle"}>
                                                {addAccountFetcher.state !== "idle" ? "Saving..." : "Add Account"}
                                            </Button>
                                        </div>
                                    </addAccountFetcher.Form>
                                </CardContent>
                            </Card>
                        </div>
                    )
                }

                {/* Edit Account Modal — the only way to add loan or property
                    terms to an account that already exists. */}
                {editAccountId && editAccount && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                        <Card className="w-full max-w-md bg-white dark:bg-base-900 shadow-xl border-base-200 dark:border-base-800 flex flex-col max-h-[85vh]">
                            <CardHeader>
                                <CardTitle>Edit {editAccount.name}</CardTitle>
                                <CardDescription>
                                    {editAccount.kind === AccountKind.Liability
                                        ? "Loan terms let us amortize this debt and show your payoff date."
                                        : "Property terms are used for the net worth projection."}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="overflow-y-auto">
                                <editAccountFetcher.Form method="post" className="space-y-4">
                                    <input type="hidden" name="_intent" value="editAccount" />
                                    <input type="hidden" name="accountId" value={editAccount.id} />
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-base-900 dark:text-base-50">Account Name</label>
                                        <Input name="name" defaultValue={editAccount.name} required />
                                    </div>

                                    {editAccount.kind === AccountKind.Liability && (
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="space-y-1.5">
                                                <label className="text-xs font-medium text-base-700 dark:text-base-300">Amount borrowed</label>
                                                <Input name="original_principal" type="number" step="0.01" min="0" defaultValue={editAccount.original_principal ?? ""} />
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-xs font-medium text-base-700 dark:text-base-300">Interest rate % / yr</label>
                                                <Input name="interest_rate_annual" type="number" step="0.01" min="0" max="100" defaultValue={editAccount.interest_rate_annual ?? ""} />
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-xs font-medium text-base-700 dark:text-base-300">Term (months)</label>
                                                <Input name="loan_term_months" type="number" step="1" min="1" max="720" defaultValue={editAccount.loan_term_months ?? ""} />
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-xs font-medium text-base-700 dark:text-base-300">First payment</label>
                                                <Input name="loan_start_date" type="date" defaultValue={editAccount.loan_start_date ?? ""} />
                                            </div>
                                            <div className="space-y-1.5 col-span-2">
                                                <label className="text-xs font-medium text-base-700 dark:text-base-300">Monthly payment <span className="font-normal text-base-500">— blank to calculate</span></label>
                                                <Input name="monthly_payment" type="number" step="0.01" min="0" defaultValue={editAccount.monthly_payment ?? ""} />
                                            </div>
                                            <div className="space-y-1.5 col-span-2">
                                                <label className="text-xs font-medium text-base-700 dark:text-base-300">Secured against</label>
                                                <select
                                                    name="linked_account_id"
                                                    defaultValue={editAccount.linked_account_id ?? ""}
                                                    className="w-full rounded-lg border border-base-200 dark:border-base-800 bg-transparent px-3 py-2 text-sm text-base-900 dark:text-base-50"
                                                >
                                                    <option value="">Nothing — unsecured</option>
                                                    {propertyAccounts.map(a => (
                                                        <option key={a.id} value={a.id}>{a.name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                    )}

                                    {editAccount.kind === AccountKind.Asset && editAccount.liquidity === LiquidityStatus.Illiquid && (
                                        <div className="space-y-1.5">
                                            <label className="text-sm font-medium text-base-900 dark:text-base-50">Expected appreciation % / yr</label>
                                            <Input
                                                name="appreciation_rate_annual"
                                                type="number"
                                                step="0.1"
                                                min="-100"
                                                max="100"
                                                placeholder="Blank holds today's value flat"
                                                defaultValue={editAccount.appreciation_rate_annual ?? ""}
                                            />
                                        </div>
                                    )}

                                    {editAccountFetcher.data?.error && (
                                        <p className="text-sm text-red-600 dark:text-red-400">{editAccountFetcher.data.error}</p>
                                    )}

                                    <div className="flex gap-3 justify-end pt-4">
                                        <Button variant="ghost" type="button" onClick={() => setEditAccountId(null)}>Cancel</Button>
                                        <Button variant="primary" type="submit" disabled={editAccountFetcher.state !== "idle"}>
                                            {editAccountFetcher.state !== "idle" ? "Saving..." : "Save Changes"}
                                        </Button>
                                    </div>
                                </editAccountFetcher.Form>
                            </CardContent>
                        </Card>
                    </div>
                )}

                {/* Loan Schedule Modal */}
                {scheduleAccountId && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
                        <Card className="w-full max-w-3xl bg-white dark:bg-base-900 shadow-2xl border-base-200 dark:border-base-800 flex flex-col max-h-[85vh]">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 border-b border-base-100 dark:border-base-800">
                                <div>
                                    <CardTitle>Payoff schedule</CardTitle>
                                    <CardDescription>Every payment, split into interest and principal.</CardDescription>
                                </div>
                                <Button variant="ghost" size="sm" onClick={() => setScheduleAccountId(null)}>✕</Button>
                            </CardHeader>
                            <CardContent className="overflow-y-auto pt-4">
                                {loanScheduleFetcher.state !== "idle" && (
                                    <p className="py-8 text-center text-base-500">Calculating…</p>
                                )}
                                {loanScheduleFetcher.state === "idle" && loanScheduleFetcher.data?.error && (
                                    <p className="py-8 text-center text-red-600 dark:text-red-400">{loanScheduleFetcher.data.error}</p>
                                )}
                                {loanScheduleFetcher.state === "idle" && loanSchedule && (
                                    <div className="space-y-4">
                                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                            <div>
                                                <div className="text-[10px] uppercase tracking-wider text-base-500">Monthly payment</div>
                                                <div className="font-mono font-semibold text-base-900 dark:text-base-50">{formatCurrency(Number(loanSchedule.monthly_payment), loanSchedule.currency)}</div>
                                            </div>
                                            <div>
                                                <div className="text-[10px] uppercase tracking-wider text-base-500">Paid off</div>
                                                <div className="font-mono font-semibold text-base-900 dark:text-base-50">
                                                    {loanSchedule.payoff_date
                                                        ? new Date(loanSchedule.payoff_date).toLocaleDateString('default', { month: 'short', year: 'numeric', timeZone: 'UTC' })
                                                        : "never at this payment"}
                                                </div>
                                            </div>
                                            <div>
                                                <div className="text-[10px] uppercase tracking-wider text-base-500">Interest remaining</div>
                                                <div className="font-mono font-semibold text-red-600 dark:text-red-400">{formatCurrency(Number(loanSchedule.remaining_interest), loanSchedule.currency)}</div>
                                            </div>
                                            <div>
                                                <div className="text-[10px] uppercase tracking-wider text-base-500">Total interest</div>
                                                <div className="font-mono font-semibold text-base-900 dark:text-base-50">{formatCurrency(Number(loanSchedule.total_interest), loanSchedule.currency)}</div>
                                            </div>
                                        </div>
                                        <table className="w-full text-left text-sm">
                                            <thead className="text-base-500 uppercase text-[10px] font-bold tracking-wider">
                                                <tr>
                                                    <th className="px-2 py-2">Date</th>
                                                    <th className="px-2 py-2 text-right">Payment</th>
                                                    <th className="px-2 py-2 text-right">Interest</th>
                                                    <th className="px-2 py-2 text-right">Principal</th>
                                                    <th className="px-2 py-2 text-right">Balance</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-base-100 dark:divide-base-800">
                                                {loanSchedule.schedule.map(row => (
                                                    <tr key={row.period} className="hover:bg-base-50 dark:hover:bg-base-800/50 transition-colors">
                                                        <td className="px-2 py-2 text-base-700 dark:text-base-300">
                                                            {new Date(row.date).toLocaleDateString('default', { month: 'short', year: 'numeric', timeZone: 'UTC' })}
                                                        </td>
                                                        <td className="px-2 py-2 text-right font-mono">{formatCurrency(Number(row.payment), loanSchedule.currency)}</td>
                                                        <td className="px-2 py-2 text-right font-mono text-red-600 dark:text-red-400">{formatCurrency(Number(row.interest), loanSchedule.currency)}</td>
                                                        <td className="px-2 py-2 text-right font-mono text-emerald-600 dark:text-emerald-400">{formatCurrency(Number(row.principal), loanSchedule.currency)}</td>
                                                        <td className="px-2 py-2 text-right font-mono text-base-900 dark:text-base-50">{formatCurrency(Number(row.balance), loanSchedule.currency)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                )}

                {/* Update Balance Modal */}
                {
                    isUpdateModalOpen && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                            <Card className="w-full max-w-sm bg-white dark:bg-base-900 shadow-xl border-base-200 dark:border-base-800">
                                <CardHeader>
                                    <CardTitle>Update Balance</CardTitle>
                                    <CardDescription>
                                        Record a balance checkpoint for <strong>{accounts.find(a => a.id === updateBalanceData.accountId)?.name}</strong>.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <updateBalanceFetcher.Form method="post" className="space-y-4">
                                        <input type="hidden" name="_intent" value="updateBalance" />
                                        <input type="hidden" name="accountId" value={updateBalanceData.accountId} />
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium text-base-900 dark:text-base-50">Date</label>
                                            <Input
                                                name="date"
                                                type="date"
                                                value={updateBalanceData.date}
                                                onChange={(e) => setUpdateBalanceData({ ...updateBalanceData, date: e.target.value })}
                                                required
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium text-base-900 dark:text-base-100">
                                                Balance ({accounts.find(a => a.id === updateBalanceData.accountId)?.currency})
                                            </label>
                                            <Input
                                                name="balance"
                                                type="number"
                                                step="0.01"
                                                placeholder="0.00"
                                                value={updateBalanceData.balance}
                                                onChange={(e) => setUpdateBalanceData({ ...updateBalanceData, balance: e.target.value })}
                                                required
                                            />
                                        </div>
                                        <div className="flex gap-3 justify-end pt-4">
                                            <Button variant="ghost" type="button" onClick={() => setIsUpdateModalOpen(false)}>Cancel</Button>
                                            <Button variant="primary" type="submit" disabled={updateBalanceFetcher.state !== "idle"}>
                                                {updateBalanceFetcher.state !== "idle" ? "Saving..." : "Save Balance"}
                                            </Button>
                                        </div>
                                    </updateBalanceFetcher.Form>
                                </CardContent>
                            </Card>
                        </div>
                    )
                }

                {/* Delete Account Confirmation Modal */}
                {
                    isDeleteModalOpen && accountToDelete && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                            <Card className="w-full max-w-sm bg-white dark:bg-base-900 shadow-xl border-red-100 dark:border-red-900/30">
                                <CardHeader>
                                    <CardTitle className="text-red-600 dark:text-red-400">Delete Account</CardTitle>
                                    <CardDescription>
                                        Are you sure you want to delete <strong className="text-base-900 dark:text-base-50">{accountToDelete.name}</strong>?
                                        This action cannot be undone and will delete all associated balance history.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <deleteAccountFetcher.Form method="post" className="space-y-4">
                                        <input type="hidden" name="_intent" value="deleteAccount" />
                                        <input type="hidden" name="accountId" value={accountToDelete.id} />
                                        <div className="flex gap-3 justify-end pt-4">
                                            <Button variant="ghost" type="button" onClick={() => {
                                                setIsDeleteModalOpen(false);
                                                setAccountToDelete(null);
                                            }}>Cancel</Button>
                                            <Button variant="primary" type="submit" className="bg-red-600 hover:bg-red-700 text-white border-none" disabled={deleteAccountFetcher.state !== "idle"}>
                                                {deleteAccountFetcher.state !== "idle" ? "Deleting..." : "Delete Account"}
                                            </Button>
                                        </div>
                                    </deleteAccountFetcher.Form>
                                </CardContent>
                            </Card>
                        </div>
                    )
                }

                {/* Balance History Modal */}
                {
                    isHistoryModalOpen && historyAccount && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
                            <Card className="w-full max-w-2xl bg-white dark:bg-base-900 shadow-2xl border-base-200 dark:border-base-800 flex flex-col max-h-[80vh]">
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 border-b border-base-100 dark:border-base-800">
                                    <div>
                                        <CardTitle>Balance History: {historyAccount.name}</CardTitle>
                                        <CardDescription>Manual balance checkpoints for this account.</CardDescription>
                                    </div>
                                    <Button variant="ghost" size="sm" onClick={() => setIsHistoryModalOpen(false)}>✕</Button>
                                </CardHeader>
                                <CardContent className="overflow-y-auto pt-4">
                                    <div className="space-y-4">
                                        <table className="w-full text-left text-sm">
                                            <thead className="text-base-500 uppercase text-[10px] font-bold tracking-wider">
                                                <tr>
                                                    <th className="px-2 py-2">Date</th>
                                                    <th className="px-2 py-2 text-right">Balance</th>
                                                    <th className="px-2 py-2 text-center">Type</th>
                                                    <th className="px-2 py-2"></th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-base-100 dark:divide-base-800">
                                                {historyAccount.history
                                                    .filter(h => h.is_manual)
                                                    .sort((a, b) => (b.date < a.date ? -1 : (b.date > a.date ? 1 : 0)))
                                                    .map((h) => (
                                                        <tr key={h.id} className="group hover:bg-base-50 dark:hover:bg-base-800/50 transition-colors">
                                                            <td className="px-2 py-3 font-medium text-base-900 dark:text-base-50">
                                                                {new Date(h.date).toLocaleDateString('default', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}
                                                            </td>
                                                            <td className="px-2 py-3 text-right font-mono text-base-700 dark:text-base-300">
                                                                {formatCurrency(Number(h.balance), historyAccount.currency)}
                                                            </td>
                                                            <td className="px-2 py-3 text-center">
                                                                <Badge variant="neutral" className="text-[10px] uppercase font-bold py-0 h-5">Manual</Badge>
                                                            </td>
                                                            <td className="px-2 py-3 text-right relative z-10">
                                                                <deleteBalanceFetcher.Form method="post" className="inline">
                                                                    <input type="hidden" name="_intent" value="deleteBalance" />
                                                                    <input type="hidden" name="balanceId" value={h.id} />
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="sm"
                                                                        className="text-red-600 hover:text-red-700 hover:bg-red-50 py-0 h-8"
                                                                        disabled={deleteBalanceFetcher.state !== "idle"}
                                                                    >
                                                                        Delete
                                                                    </Button>
                                                                </deleteBalanceFetcher.Form>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                {historyAccount.history.filter(h => h.is_manual).length === 0 && (
                                                    <tr>
                                                        <td colSpan={4} className="px-2 py-8 text-center text-base-500">
                                                            No manual balance entries found.
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    )
                }
            </div>
        </div >
    )
}
