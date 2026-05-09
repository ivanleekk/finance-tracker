import { useState, useMemo, useEffect } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { useHousehold } from "../../lib/HouseholdContext";
import { LiquidityStatus, TaxTreatment } from "../../types/types";
import type { AccountWithHistory, AccountsLoaderData } from "./accounts.loader";
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

export default function Accounts() {
    const { activeHousehold } = useHousehold();
    const { accounts = [], currencies = [] } = (useLoaderData() as AccountsLoaderData) || {};

    // We use fetchers for mutations to avoid full page navigations and to easily keep modals open/closed based on state
    const addAccountFetcher = useFetcher();
    const updateBalanceFetcher = useFetcher();
    const deleteAccountFetcher = useFetcher();

    const [isAddAccountModalOpen, setIsAddAccountModalOpen] = useState(false);
    const [newAccount, setNewAccount] = useState({
        name: "",
        liquidity: LiquidityStatus.Liquid,
        tax_status: TaxTreatment.Taxable,
        balance: "",
        currency: "USD",
        date: new Date().toISOString().split('T')[0]
    });

    const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
    const [updateBalanceData, setUpdateBalanceData] = useState({ accountId: "", date: new Date().toISOString().split('T')[0], balance: "" });

    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [accountToDelete, setAccountToDelete] = useState<{ id: string, name: string } | null>(null);

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
                date: new Date().toISOString().split('T')[0]
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

    const formatCurrency = (value: number, curr?: string) => {
        return new Intl.NumberFormat('en-US', { 
            style: 'currency', 
            currency: curr || activeHousehold?.base_currency || 'USD' 
        }).format(value);
    }

    const getCurrentBalanceDetails = (history: BalanceResponse[]) => {
        if (history.length === 0) return { balance: 0, balanceHome: 0 };
        const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
        const last = sorted[sorted.length - 1];
        return { 
            balance: Number(last.balance), 
            balanceHome: Number(last.balance_home_currency ?? last.balance) 
        };
    }

    // UPDATED: Now maps each account's balance to its name per date
    // ⚡ Bolt: Replaced O(N^2 log N) filter().sort() inside map() with O(N) single-pass approach
    const aggregatedChartData = useMemo(() => {
        const allDatesSet = new Set<string>();

        // Map account IDs/names to their history for quick lookup
        const historyMap: Record<string, Record<string, number>> = {};

        accounts.forEach(acc => {
            historyMap[acc.name] = {};
            acc.history.forEach(h => {
                allDatesSet.add(h.date);
                historyMap[acc.name][h.date] = Number(h.balance_home_currency ?? h.balance);
            });
        });

        const sortedDates = Array.from(allDatesSet).sort((a, b) => a.localeCompare(b));

        // Track running balances
        const currentBalances: Record<string, number> = {};
        accounts.forEach(acc => currentBalances[acc.name] = 0);

        return sortedDates.map(date => {
            const dataPoint: any = { date };

            accounts.forEach(acc => {
                // Update running balance if there's a record for this date
                if (historyMap[acc.name][date] !== undefined) {
                    currentBalances[acc.name] = historyMap[acc.name][date];
                }
                dataPoint[acc.name] = currentBalances[acc.name];
            });

            return dataPoint;
        });
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
        <div className="flex-1 space-y-6 p-8 relative">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight text-base-900 dark:text-base-50">Bank Accounts</h2>
                    <p className="text-base-500 mt-1">Manage and track your cash balances for {activeHousehold.name}.</p>
                </div>
                <Button variant="primary" onClick={() => setIsAddAccountModalOpen(true)}>Add New Account</Button>
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
                            <ResponsiveContainer width="100%" height="100%">
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
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                    <XAxis
                                        dataKey="date"
                                        axisLine={false}
                                        tickLine={false}
                                        tick={{ fill: '#64748b', fontSize: 12 }}
                                        dy={10}
                                    />
                                    <YAxis
                                        axisLine={false}
                                        tickLine={false}
                                        tick={{ fill: '#64748b', fontSize: 12 }}
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

            {/* Table Section */}
            <Card>
                <CardHeader>
                    <CardTitle>Connected Accounts</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm text-base-600">
                            <thead className="border-b border-base-200 bg-base-50/50 text-base-900">
                                <tr>
                                    <th className="px-4 py-3 font-semibold">Account Name</th>
                                    <th className="px-4 py-3 font-semibold">Type</th>
                                    <th className="px-4 py-3 font-semibold text-right">Current Balance</th>
                                    <th className="px-4 py-3 font-semibold text-right">Liquidity</th>
                                    <th className="px-4 py-3 font-semibold">Status</th>
                                    <th className="px-4 py-3 font-semibold"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {accounts.map((acc) => (
                                    <tr key={acc.id} className="border-b border-base-100 hover:bg-base-50/50 transition-colors">
                                        <td className="px-4 py-4 font-medium text-base-900">{acc.name}</td>
                                        <td className="px-4 py-4 capitalize">{acc.tax_status.replace('_', ' ')}</td>
                                        <td className="px-4 py-4 text-right">
                                            <div className="font-medium text-base-900">
                                                {formatCurrency(getCurrentBalanceDetails(acc.history).balanceHome)}
                                            </div>
                                            {acc.currency !== activeHousehold?.base_currency && (
                                                <div className="text-xs text-base-500">
                                                    {formatCurrency(getCurrentBalanceDetails(acc.history).balance, acc.currency)}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-4 py-4 text-right capitalize">{acc.liquidity.replace('_', ' ')}</td>
                                        <td className="px-4 py-4">
                                            <Badge variant="success">
                                                Active
                                            </Badge>
                                        </td>
                                        <td className="px-4 py-4 text-right flex justify-end gap-2">
                                            <Button variant="ghost" size="sm" onClick={() => openUpdateModal(acc.id)}>Update Balance</Button>
                                            <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => {
                                                setAccountToDelete({ id: acc.id, name: acc.name });
                                                setIsDeleteModalOpen(true);
                                            }}>Delete</Button>
                                        </td>
                                    </tr>
                                ))}
                                {accounts.length === 0 && (
                                    <tr>
                                        <td colSpan={6} className="px-4 py-8 text-center text-base-500">
                                            No accounts found for this household.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>

            {/* Add Account Modal */}
            {isAddAccountModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <Card className="w-full max-w-md bg-white shadow-xl">
                        <CardHeader>
                            <CardTitle>Add Manual Account</CardTitle>
                            <CardDescription>Enter your bank account details below.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <addAccountFetcher.Form method="post" className="space-y-4">
                                <input type="hidden" name="_intent" value="addAccount" />
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-base-900">Account Name</label>
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
                                        <label className="text-sm font-medium text-base-900">Liquidity</label>
                                        <select
                                            name="liquidity"
                                            className="w-full rounded-md border border-base-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20"
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
                                            className="w-full rounded-md border border-base-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20"
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
                                        className="w-full rounded-md border border-base-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                                        value={newAccount.currency}
                                        onChange={(e) => setNewAccount({ ...newAccount, currency: e.target.value })}
                                    >
                                        {currencies.map(c => (
                                            <option key={c.code} value={c.code}>{c.code} - {c.name}</option>
                                        ))}
                                    </select>
                                </div>
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
            )}

            {/* Update Balance Modal */}
            {isUpdateModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <Card className="w-full max-w-sm bg-white shadow-xl">
                        <CardHeader>
                            <CardTitle>Update Balance</CardTitle>
                            <CardDescription>Record a historical or current balance.</CardDescription>
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
                                    <label className="text-sm font-medium text-base-900">Balance</label>
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
            )}

            {/* Delete Account Confirmation Modal */}
            {isDeleteModalOpen && accountToDelete && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <Card className="w-full max-w-sm bg-white shadow-xl border-red-100">
                        <CardHeader>
                            <CardTitle className="text-red-600">Delete Account</CardTitle>
                            <CardDescription>
                                Are you sure you want to delete <strong>{accountToDelete.name}</strong>?
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
            )}
        </div>
    )
}
