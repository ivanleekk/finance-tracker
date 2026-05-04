import { useState, useMemo, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../components/ui/Card"
import { Badge } from "../../components/ui/Badge"
import { Button } from "../../components/ui/Button"
import { Input } from "../../components/ui/Input"
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts"
import api from "../../lib/api"
import { useHousehold } from "../../lib/HouseholdContext"
import { LiquidityStatus, TaxTreatment } from "../../types/types"
import { Loader2 } from "lucide-react"
import { accountsLoader, type AccountWithHistory } from "./accounts.loader"
import type { AccountResponse, BalanceResponse } from "../../types/types"

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
    const [accounts, setAccounts] = useState<AccountWithHistory[]>([])
    const [isLoading, setIsLoading] = useState(true)

    const [isAddAccountModalOpen, setIsAddAccountModalOpen] = useState(false)
    const [newAccount, setNewAccount] = useState({
        name: "",
        liquidity: LiquidityStatus.Liquid,
        tax_status: TaxTreatment.Taxable,
        balance: "",
        currency: "USD",
        date: new Date().toISOString().split('T')[0]
    })

    const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false)
    const [updateBalanceData, setUpdateBalanceData] = useState({ accountId: "", date: new Date().toISOString().split('T')[0], balance: "" })

    const fetchAccounts = async () => {
        if (!activeHousehold) return;
        setIsLoading(true);
        try {
            const data = await accountsLoader(activeHousehold.id);
            setAccounts(data);
        } catch (error) {
            console.error("Failed to fetch accounts", error);
        } finally {
            setIsLoading(false);
        }
    }

    useEffect(() => {
        fetchAccounts();
    }, [activeHousehold?.id]);

    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
    }

    const getCurrentBalance = (history: BalanceResponse[]) => {
        if (history.length === 0) return 0;
        const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
        return Number(sorted[sorted.length - 1].balance);
    }

    // UPDATED: Now maps each account's balance to its name per date
    const aggregatedChartData = useMemo(() => {
        const allDatesSet = new Set<string>();
        accounts.forEach(acc => acc.history.forEach(h => allDatesSet.add(h.date)));

        const sortedDates = Array.from(allDatesSet).sort((a, b) => a.localeCompare(b));

        return sortedDates.map(date => {
            const dataPoint: any = { date };

            accounts.forEach(acc => {
                const pastOrCurrentEntries = acc.history
                    .filter(h => h.date <= date)
                    .sort((a, b) => a.date.localeCompare(b.date));

                if (pastOrCurrentEntries.length > 0) {
                    dataPoint[acc.name] = Number(pastOrCurrentEntries[pastOrCurrentEntries.length - 1].balance);
                } else {
                    dataPoint[acc.name] = 0;
                }
            });

            return dataPoint;
        });
    }, [accounts]);

    const handleAddAccount = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!activeHousehold) return;

        try {
            const accRes = await api.post<AccountResponse>("/accounts/", {
                household_id: activeHousehold.id,
                name: newAccount.name,
                liquidity: newAccount.liquidity,
                tax_status: newAccount.tax_status,
                currency: newAccount.currency
            });

            await api.post("/accounts/balances", {
                account_id: accRes.data.id,
                date: newAccount.date,
                balance: parseFloat(newAccount.balance) || 0
            });

            setIsAddAccountModalOpen(false)
            setNewAccount({
                name: "",
                liquidity: LiquidityStatus.Liquid,
                tax_status: TaxTreatment.Taxable,
                balance: "",
                currency: "USD",
                date: new Date().toISOString().split('T')[0]
            })
            fetchAccounts();
        } catch (error) {
            console.error("Failed to add account", error);
        }
    }

    const handleUpdateBalance = async (e: React.FormEvent) => {
        e.preventDefault()
        try {
            await api.post("/accounts/balances", {
                account_id: updateBalanceData.accountId,
                date: updateBalanceData.date,
                balance: parseFloat(updateBalanceData.balance) || 0
            });
            setIsUpdateModalOpen(false);
            fetchAccounts();
        } catch (error) {
            console.error("Failed to update balance", error);
        }
    }

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

    if (isLoading && accounts.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center p-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
            </div>
        )
    }

    return (
        <div className="flex-1 space-y-6 p-8 relative">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight text-base-900">Bank Accounts</h2>
                    <p className="text-base-500 mt-1">Manage and track your cash balances for {activeHousehold.name}.</p>
                </div>
                <Button variant="primary" onClick={() => setIsAddAccountModalOpen(true)}>Link New Account</Button>
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
                                        // UPDATED: Automatically uses the dataKey (account name) for the label
                                        formatter={(value: any, name: string) => [formatCurrency(value as number), name]}
                                        contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
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
                                        <td className="px-4 py-4 text-right font-medium text-base-900">{formatCurrency(getCurrentBalance(acc.history))}</td>
                                        <td className="px-4 py-4 text-right capitalize">{acc.liquidity.replace('_', ' ')}</td>
                                        <td className="px-4 py-4">
                                            <Badge variant="success">
                                                Active
                                            </Badge>
                                        </td>
                                        <td className="px-4 py-4 text-right">
                                            <Button variant="ghost" size="sm" onClick={() => openUpdateModal(acc.id)}>Update Balance</Button>
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
                            <form onSubmit={handleAddAccount} className="space-y-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-base-900">Account Name</label>
                                    <Input
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
                                            type="date"
                                            value={newAccount.date}
                                            onChange={(e) => setNewAccount({ ...newAccount, date: e.target.value })}
                                            required
                                        />
                                    </div>
                                </div>
                                <div className="flex gap-3 justify-end pt-4">
                                    <Button variant="ghost" type="button" onClick={() => setIsAddAccountModalOpen(false)}>Cancel</Button>
                                    <Button variant="primary" type="submit">Add Account</Button>
                                </div>
                            </form>
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
                            <form onSubmit={handleUpdateBalance} className="space-y-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-base-900">Date</label>
                                    <Input
                                        type="date"
                                        value={updateBalanceData.date}
                                        onChange={(e) => setUpdateBalanceData({ ...updateBalanceData, date: e.target.value })}
                                        required
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-base-900">Balance</label>
                                    <Input
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
                                    <Button variant="primary" type="submit">Save Balance</Button>
                                </div>
                            </form>
                        </CardContent>
                    </Card>
                </div>
            )}
        </div>
    )
}