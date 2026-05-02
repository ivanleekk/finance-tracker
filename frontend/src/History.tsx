import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/Card"
import { Badge } from "./components/ui/Badge"
import { Button } from "./components/ui/Button"
import { ArrowUpRight, ArrowDownRight, ArrowRightLeft } from "lucide-react"

export default function History() {
    const transactions = [
        { id: "tx-1", type: "buy", asset: "AAPL", amount: 1500.00, shares: 10, date: "2026-05-02 10:23 AM", status: "completed" },
        { id: "tx-2", type: "deposit", asset: "USD", amount: 4200.00, shares: null, date: "2026-05-01 09:00 AM", status: "completed" },
        { id: "tx-3", type: "buy", asset: "TSLA", amount: 850.00, shares: 5, date: "2026-05-01 02:15 PM", status: "pending" },
        { id: "tx-4", type: "sell", asset: "MSFT", amount: 3100.00, shares: 10, date: "2026-04-28 11:30 AM", status: "completed" },
        { id: "tx-5", type: "withdrawal", asset: "USD", amount: 500.00, shares: null, date: "2026-04-25 04:45 PM", status: "completed" }
    ]

    const getIcon = (type: string) => {
        if (type === 'deposit') return <ArrowDownRight className="h-5 w-5 text-green-500" />
        if (type === 'withdrawal') return <ArrowUpRight className="h-5 w-5 text-red-500" />
        return <ArrowRightLeft className="h-5 w-5 text-blue-500" />
    }

    const getAmountColor = (type: string) => {
        if (type === 'deposit' || type === 'sell') return 'text-green-600'
        return 'text-base-900'
    }

    const formatAmount = (type: string, amount: number) => {
        const prefix = (type === 'deposit' || type === 'sell') ? '+' : '-'
        return `${prefix}$${amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
    }

    return (
        <div className="flex-1 space-y-6 p-8">
            <div className="flex items-center justify-between">
                <h2 className="text-3xl font-bold tracking-tight text-base-900">Transaction History</h2>
                <div className="flex gap-2">
                    <Button variant="secondary">Filter</Button>
                    <Button variant="secondary">Export CSV</Button>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>All Transactions</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {transactions.map((tx) => (
                            <div key={tx.id} className="flex items-center justify-between border-b border-base-100 pb-4 last:border-0 last:pb-0">
                                <div className="flex items-center gap-4">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-base-50">
                                        {getIcon(tx.type)}
                                    </div>
                                    <div>
                                        <p className="font-medium text-base-900 capitalize">
                                            {tx.type} {tx.asset}
                                        </p>
                                        <div className="flex items-center gap-2 text-sm text-base-500">
                                            <span>{tx.date}</span>
                                            {tx.shares && (
                                                <>
                                                    <span>•</span>
                                                    <span>{tx.shares} shares</span>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex flex-col items-end gap-1">
                                    <span className={`font-semibold ${getAmountColor(tx.type)}`}>
                                        {formatAmount(tx.type, tx.amount)}
                                    </span>
                                    <Badge variant={tx.status === 'completed' ? 'success' : 'warning'}>
                                        {tx.status}
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