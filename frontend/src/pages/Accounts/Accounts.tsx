import { useState, useMemo, useEffect } from "react";
import { useLoaderData, useFetcher, Link } from "react-router";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { StatCard } from "../../components/ui/StatCard";
import { OwnershipTag } from "../../components/ui/OwnershipTag";
import { TopBar } from "../../components/TopBar";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { useHousehold } from "../../lib/HouseholdContext";
import { useAuth } from "../../lib/AuthContext";
import { useViewMode, isVisibleInViewMode } from "../../lib/ViewModeContext";
import { LiquidityStatus, TaxTreatment } from "../../types/types";
import type { AccountsLoaderData } from "./accounts.loader";
import type { BalanceResponse } from "../../types/types";

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
];

function initialsFor(name: string) {
    return (name.split(/\s+/)[0] || name).slice(0, 4).toUpperCase();
}

export default function Accounts() {
    const { activeHousehold } = useHousehold();
    const { user } = useAuth();
    const { viewMode, hasHousehold } = useViewMode();
    const { accounts: allAccounts = [], currencies = [] } = (useLoaderData() as AccountsLoaderData) || {};
    const accounts = useMemo(
        () => allAccounts.filter(a => isVisibleInViewMode(a.owner_user_id, viewMode, user?.id)),
        [allAccounts, viewMode, user?.id]
    );

    // We use fetchers for mutations to avoid full page navigations and to easily keep modals open/closed based on state
    const addAccountFetcher = useFetcher();
    const updateBalanceFetcher = useFetcher();
    const deleteAccountFetcher = useFetcher();
    const deleteBalanceFetcher = useFetcher();

    const [isAddAccountModalOpen, setIsAddAccountModalOpen] = useState(false);
    const [newAccount, setNewAccount] = useState<{
        name: string;
        liquidity: LiquidityStatus;
        tax_status: TaxTreatment;
        balance: string;
        currency: string;
        date: string;
        isPrivate: boolean;
    }>({
        name: "",
        liquidity: LiquidityStatus.Liquid,
        tax_status: TaxTreatment.Taxable,
        balance: "",
        currency: "USD",
        date: new Date().toISOString().split('T')[0],
        isPrivate: user?.default_new_items_private ?? true,
    });


    const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
    const [updateBalanceData, setUpdateBalanceData] = useState({ accountId: "", date: new Date().toISOString().split('T')[0], balance: "" });

    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [accountToDelete, setAccountToDelete] = useState<{ id: string, name: string } | null>(null);

    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
    const [historyAccountId, setHistoryAccountId] = useState<string | null>(null);

    // Close modals on successful submission
    useEffect(() => {
        if (addAccountFetcher.state === "idle" && addAccountFetcher.data?.success) {
            setIsAddAccountModalOpen(false);
            setNewAccount({
                name: "",
                liquidity: LiquidityStatus.Liquid,
                tax_status: TaxTreatment.Taxable,
                balance: "",
                currency: "USD",
                date: new Date().toISOString().split('T')[0],
                isPrivate: user?.default_new_items_private ?? true,
            });

        }
    }, [addAccountFetcher.state, addAccountFetcher.data]);

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
            balanceHome: Number(last.balance_home_currency ?? last.balance)
        };
    }

    // ⚡ Bolt Performance Optimization:
    // Replaced O(N^2) nested `.find()` operations inside `.map()`
    // with O(N) hash map lookups to prevent main-thread blocking. Also replaced `localeCompare`.
    const aggregatedChartData = useMemo(() => {
        const allDatesSet = new Set<string>();
        const balancesByDate = new Map<string, Array<{ id: string, name: string, bal: number }>>();

        accounts.forEach(acc => {
            acc.history.forEach(h => {
                allDatesSet.add(h.date);
                const list = balancesByDate.get(h.date) || [];
                list.push({ id: acc.id, name: acc.name, bal: Number(h.balance_home_currency ?? h.balance) });
                balancesByDate.set(h.date, list);
            });
        });

        const sortedDates = Array.from(allDatesSet).sort((a, b) => (a < b ? -1 : (a > b ? 1 : 0)));

        const accountLatestBalances = new Map<string, number>();
        const allAccountNames = Array.from(new Set(accounts.map(acc => acc.name)));

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
    }, [accounts]);

    const historyAccount = useMemo(() => {
        if (!historyAccountId) return null;
        return accounts.find(a => a.id === historyAccountId) || null;
    }, [accounts, historyAccountId]);

    const summaryStats = useMemo(() => {
        let totalAssets = 0, liquidNow = 0, retirement = 0;
        const currencySet = new Set<string>();
        accounts.forEach(acc => {
            const bal = getCurrentBalanceDetails(acc.history).balanceHome;
            totalAssets += bal;
            currencySet.add(acc.currency);
            if (acc.liquidity === LiquidityStatus.Liquid) liquidNow += bal;
            if (acc.liquidity === LiquidityStatus.TimeLocked || acc.liquidity === LiquidityStatus.Retirement) retirement += bal;
        });
        return { totalAssets, liquidNow, retirement, currencies: Array.from(currencySet).sort() };
    }, [accounts]);

    const accountGroups = useMemo(() => {
        return ACCOUNT_GROUPS.map(group => {
            const groupAccounts = accounts
                .filter(acc => group.liquidities.includes(acc.liquidity))
                .sort((a, b) => getCurrentBalanceDetails(b.history).balanceHome - getCurrentBalanceDetails(a.history).balanceHome);
            const groupTotal = groupAccounts.reduce((sum, acc) => sum + getCurrentBalanceDetails(acc.history).balanceHome, 0);
            return { ...group, accounts: groupAccounts, total: groupTotal };
        }).filter(group => group.accounts.length > 0);
    }, [accounts]);

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
                    <StatCard title="Total assets" value={formatCurrency(summaryStats.totalAssets)} />
                    <StatCard title="Liquid now" value={formatCurrency(summaryStats.liquidNow)} />
                    <StatCard title="Retirement" value={formatCurrency(summaryStats.retirement)} />
                    <StatCard title="Currencies" value={summaryStats.currencies.join(" · ") || "—"} />
                </div>

                {/* Chart Section */}
                <Card>
                    <CardHeader>
                        <CardTitle>Total Cash Balance</CardTitle>
                        <CardDescription>Your combined liquid assets over time, broken down by account.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[350px] w-full">
                            {aggregatedChartData.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%" minHeight={350}>
                                    <AreaChart data={aggregatedChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                        <defs>
                                            {/* UPDATED: Map over accounts to generate a gradient for each */}
                                            {accounts.map((acc, index) => (
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
                                        {accounts.map((acc, index) => (
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
                                <span className="font-mono text-xs text-base-500 dark:text-base-400">{formatCurrency(group.total)}</span>
                            </div>
                            <Card className="overflow-hidden">
                                <CardContent className="p-0">
                                    {group.accounts.map(acc => {
                                        const { balance, balanceHome } = getCurrentBalanceDetails(acc.history);
                                        const liquidityMeta = LIQUIDITY_META[acc.liquidity];
                                        const taxMeta = TAX_META[acc.tax_status];
                                        return (
                                            <div key={acc.id} className="flex flex-wrap items-center gap-3 px-4 py-3 border-b last:border-b-0 border-base-100 dark:border-base-800/70 hover:bg-base-50/50 dark:hover:bg-base-900/40 transition-colors">
                                                <div className="w-9 h-9 rounded-lg flex items-center justify-center font-mono text-[10px] font-bold shrink-0 bg-primary-500/10 text-primary-600 dark:text-primary-400">
                                                    {initialsFor(acc.name)}
                                                </div>
                                                <div className="flex-1 min-w-[140px]">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-medium text-base-900 dark:text-base-50">{acc.name}</span>
                                                        <OwnershipTag ownerUserId={acc.owner_user_id} show={hasHousehold && viewMode === "blended"} className="text-[9px] px-1.5 py-0 h-4" />
                                                    </div>
                                                    <div className="text-[10px] font-mono uppercase tracking-wide text-base-400 dark:text-base-500">{acc.currency}</div>
                                                </div>
                                                {liquidityMeta && (
                                                    <span className={`hidden sm:inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-semibold ${liquidityMeta.className}`}>{liquidityMeta.label}</span>
                                                )}
                                                {taxMeta && (
                                                    <span className={`hidden md:inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-semibold ${taxMeta.className}`}>{taxMeta.label}</span>
                                                )}
                                                <div className="text-right min-w-32 shrink-0">
                                                    <div className="font-mono font-semibold text-base-900 dark:text-base-50 whitespace-nowrap">{formatCurrency(balanceHome)}</div>
                                                    {acc.currency !== activeHousehold?.base_currency && (
                                                        <div className="text-[10px] text-base-400 dark:text-base-500 font-mono whitespace-nowrap">{formatCurrency(balance, acc.currency)}</div>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-1 shrink-0 ml-auto">
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
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <label className="text-sm font-medium text-base-900 dark:text-base-50">Liquidity</label>
                                                <select
                                                    name="liquidity"
                                                    className="w-full rounded-md border border-base-200 dark:border-base-800 bg-white dark:bg-base-900 px-3 py-2 text-sm text-base-900 dark:text-base-50 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                                                    value={newAccount.liquidity}
                                                    onChange={(e) => setNewAccount({ ...newAccount, liquidity: e.target.value as LiquidityStatus })}
                                                >
                                                    {Object.values(LiquidityStatus).map(status => (
                                                        <option key={status} value={status}>{status.replace('_', ' ')}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-sm font-medium text-base-900">Tax Status</label>
                                                <select
                                                    name="tax_status"
                                                    className="w-full rounded-md border border-base-200 dark:border-base-800 bg-white dark:bg-base-900 px-3 py-2 text-sm text-base-900 dark:text-base-50 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                                                    value={newAccount.tax_status}
                                                    onChange={(e) => setNewAccount({ ...newAccount, tax_status: e.target.value as TaxTreatment })}
                                                >
                                                    {Object.values(TaxTreatment).map(status => (
                                                        <option key={status} value={status}>{status.replace('_', ' ')}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <label className="text-sm font-medium text-base-900">Initial Balance</label>
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
                                                <label className="text-sm font-medium text-base-900">As of Date</label>
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
                                            <label className="text-sm font-medium text-base-900">Currency</label>
                                            <select
                                                name="currency"
                                                className="w-full rounded-md border border-base-200 dark:border-base-800 bg-white dark:bg-base-900 px-3 py-2 text-sm text-base-900 dark:text-base-50 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                                                value={newAccount.currency}
                                                onChange={(e) => setNewAccount({ ...newAccount, currency: e.target.value })}
                                            >
                                                {currencies.map(c => (
                                                    <option key={c.code} value={c.code}>{c.code} - {c.name}</option>
                                                ))}
                                            </select>
                                        </div>
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
                                            <label className="text-sm font-medium text-base-900">Date</label>
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
