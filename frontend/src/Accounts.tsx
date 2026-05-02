import { useState, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./components/ui/Card"
import { Badge } from "./components/ui/Badge"
import { Button } from "./components/ui/Button"
import { Input } from "./components/ui/Input"
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts"

type AccountHistory = {
    date: string;
    balance: number;
}

type Account = {
    id: string;
    name: string;
    type: string;
    apy: string;
    status: string;
    history: AccountHistory[];
}

export default function Accounts() {
    const [accounts, setAccounts] = useState<Account[]>([
        { 
            id: "acc-1", name: "Chase Checking", type: "Checking", apy: "0.01%", status: "active",
            history: [
                { date: "2026-01-01", balance: 10000.00 },
                { date: "2026-02-01", balance: 11000.00 },
                { date: "2026-03-01", balance: 12450.00 }
            ]
        },
        { 
            id: "acc-2", name: "Amex High Yield Savings", type: "Savings", apy: "4.30%", status: "active",
            history: [
                { date: "2026-01-01", balance: 60000.00 },
                { date: "2026-02-01", balance: 62000.00 },
                { date: "2026-03-01", balance: 65000.00 }
            ]
        },
        { 
            id: "acc-3", name: "Wells Fargo Everyday", type: "Checking", apy: "0.01%", status: "warning",
            history: [
                { date: "2026-01-01", balance: 1500.00 },
                { date: "2026-03-01", balance: 1200.00 }
            ]
        },
        { 
            id: "acc-4", name: "Ally CD", type: "CD", apy: "5.00%", status: "locked",
            history: [
                { date: "2026-01-01", balance: 5000.00 }
            ]
        }
    ])

    const [isAddAccountModalOpen, setIsAddAccountModalOpen] = useState(false)
    const [newAccount, setNewAccount] = useState({ name: "", type: "", balance: "", apy: "", date: new Date().toISOString().split('T')[0] })

    const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false)
    const [updateBalanceData, setUpdateBalanceData] = useState({ accountId: "", date: new Date().toISOString().split('T')[0], balance: "" })

    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
    }

    const getCurrentBalance = (history: AccountHistory[]) => {
        if (history.length === 0) return 0;
        const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
        return sorted[sorted.length - 1].balance;
    }

    const aggregatedChartData = useMemo(() => {
        const allDatesSet = new Set<string>();
        accounts.forEach(acc => acc.history.forEach(h => allDatesSet.add(h.date)));
        
        const sortedDates = Array.from(allDatesSet).sort((a, b) => a.localeCompare(b));
        
        return sortedDates.map(date => {
            let totalBalance = 0;
            accounts.forEach(acc => {
                const pastOrCurrentEntries = acc.history.filter(h => h.date <= date).sort((a, b) => a.date.localeCompare(b.date));
                if (pastOrCurrentEntries.length > 0) {
                    totalBalance += pastOrCurrentEntries[pastOrCurrentEntries.length - 1].balance;
                }
            });
            return { date, balance: totalBalance };
        });
    }, [accounts]);

    const handleAddAccount = (e: React.FormEvent) => {
        e.preventDefault()
        const id = `acc-${Date.now()}`
        setAccounts([...accounts, { 
            id, 
            name: newAccount.name, 
            type: newAccount.type, 
            apy: newAccount.apy, 
            status: "active",
            history: [
                { date: newAccount.date, balance: parseFloat(newAccount.balance) || 0 }
            ]
        }])
        setIsAddAccountModalOpen(false)
        setNewAccount({ name: "", type: "", balance: "", apy: "", date: new Date().toISOString().split('T')[0] })
    }

    const handleUpdateBalance = (e: React.FormEvent) => {
        e.preventDefault()
        setAccounts(accounts.map(acc => {
            if (acc.id === updateBalanceData.accountId) {
                // If an entry for this date already exists, update it, otherwise add it.
                const existingEntryIndex = acc.history.findIndex(h => h.date === updateBalanceData.date);
                let newHistory = [...acc.history];
                if (existingEntryIndex >= 0) {
                    newHistory[existingEntryIndex].balance = parseFloat(updateBalanceData.balance) || 0;
                } else {
                    newHistory.push({ date: updateBalanceData.date, balance: parseFloat(updateBalanceData.balance) || 0 });
                }
                newHistory.sort((a, b) => a.date.localeCompare(b.date));
                return { ...acc, history: newHistory };
            }
            return acc;
        }));
        setIsUpdateModalOpen(false);
    }

    const openUpdateModal = (accountId: string) => {
        setUpdateBalanceData({ accountId, date: new Date().toISOString().split('T')[0], balance: "" });
        setIsUpdateModalOpen(true);
    }

    return (
        <div className="flex-1 space-y-6 p-8 relative">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight text-base-900">Bank Accounts</h2>
                    <p className="text-base-500 mt-1">Manage and track your cash balances.</p>
                </div>
                <Button variant="primary" onClick={() => setIsAddAccountModalOpen(true)}>Link New Account</Button>
            </div>

            {/* Chart Section */}
            <Card>
                <CardHeader>
                    <CardTitle>Total Cash Balance</CardTitle>
                    <CardDescription>Your combined liquid assets over time.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="h-[350px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={aggregatedChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3}/>
                                        <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/>
                                    </linearGradient>
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
                                    formatter={(value: any) => [formatCurrency(value as number), "Balance"]}
                                    contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                />
                                <Area 
                                    type="monotone" 
                                    dataKey="balance" 
                                    stroke="#0ea5e9" 
                                    strokeWidth={3}
                                    fillOpacity={1} 
                                    fill="url(#colorBalance)" 
                                />
                            </AreaChart>
                        </ResponsiveContainer>
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
                                    <th className="px-4 py-3 font-semibold">APY</th>
                                    <th className="px-4 py-3 font-semibold">Status</th>
                                    <th className="px-4 py-3 font-semibold"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {accounts.map((acc) => (
                                    <tr key={acc.id} className="border-b border-base-100 hover:bg-base-50/50 transition-colors">
                                        <td className="px-4 py-4 font-medium text-base-900">{acc.name}</td>
                                        <td className="px-4 py-4">{acc.type}</td>
                                        <td className="px-4 py-4 text-right font-medium text-base-900">{formatCurrency(getCurrentBalance(acc.history))}</td>
                                        <td className="px-4 py-4">{acc.apy}</td>
                                        <td className="px-4 py-4">
                                            <Badge variant={acc.status === 'active' ? 'success' : acc.status === 'warning' ? 'warning' : 'neutral'}>
                                                {acc.status}
                                            </Badge>
                                        </td>
                                        <td className="px-4 py-4 text-right">
                                            <Button variant="ghost" size="sm" onClick={() => openUpdateModal(acc.id)}>Update Balance</Button>
                                        </td>
                                    </tr>
                                ))}
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
                                        onChange={(e) => setNewAccount({...newAccount, name: e.target.value})}
                                        required
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-base-900">Account Type</label>
                                    <Input 
                                        placeholder="e.g. Checking, Savings" 
                                        value={newAccount.type}
                                        onChange={(e) => setNewAccount({...newAccount, type: e.target.value})}
                                        required
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-base-900">Initial Balance</label>
                                        <Input 
                                            type="number" 
                                            step="0.01" 
                                            placeholder="0.00" 
                                            value={newAccount.balance}
                                            onChange={(e) => setNewAccount({...newAccount, balance: e.target.value})}
                                            required
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-base-900">As of Date</label>
                                        <Input 
                                            type="date" 
                                            value={newAccount.date}
                                            onChange={(e) => setNewAccount({...newAccount, date: e.target.value})}
                                            required
                                        />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-base-900">APY (%)</label>
                                    <Input 
                                        placeholder="e.g. 4.5%" 
                                        value={newAccount.apy}
                                        onChange={(e) => setNewAccount({...newAccount, apy: e.target.value})}
                                    />
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
                                        onChange={(e) => setUpdateBalanceData({...updateBalanceData, date: e.target.value})}
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
                                        onChange={(e) => setUpdateBalanceData({...updateBalanceData, balance: e.target.value})}
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
