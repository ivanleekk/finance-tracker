import { useMemo, useState } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { StatCard } from "../../components/ui/StatCard";
import { TopBar } from "../../components/TopBar";
import { useHousehold } from "../../lib/HouseholdContext";
import { counterpartyTotals } from "../../lib/reimbursements";
import type { ReimbursementsLoaderData } from "./reimbursements.loader";

export { loader, action } from "./reimbursements.loader";

const today = () => new Date().toISOString().split("T")[0];

export default function Reimbursements() {
    const { activeHousehold } = useHousehold();
    const { balances = [], accounts = [], categories = [] } =
        (useLoaderData() as ReimbursementsLoaderData) || {};

    const settleFetcher = useFetcher();
    const onBehalfFetcher = useFetcher();

    const [settlingKey, setSettlingKey] = useState<string | null>(null);
    const [settleAmount, setSettleAmount] = useState("");
    const [settleAccountId, setSettleAccountId] = useState("");
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [newExpense, setNewExpense] = useState({
        counterparty_name: "",
        category_id: "",
        amount: "",
        description: "",
    });

    const baseCurrency = activeHousehold?.base_currency || "USD";
    const money = useMemo(
        () => (value: number) =>
            new Intl.NumberFormat(undefined, { style: "currency", currency: baseCurrency }).format(value),
        [baseCurrency],
    );

    const totals = useMemo(() => counterpartyTotals(balances), [balances]);
    const owedToYou = balances.filter((b) => b.direction === "owed_to_you");
    const youOwe = balances.filter((b) => b.direction === "you_owe");

    const expenseCategories = categories.filter((c) => c.type === "expense");

    if (!activeHousehold) {
        return (
            <div className="flex-1 flex items-center justify-center p-8 text-base-500">
                Please select or create a household.
            </div>
        );
    }

    const keyFor = (name: string, direction: string) => `${direction}:${name}`;

    const openSettle = (name: string, direction: string, amount: number) => {
        setSettlingKey(keyFor(name, direction));
        // Prefilled with the whole balance, since settling in full is the common
        // case, but editable — partial repayments are normal.
        setSettleAmount(String(amount));
        setSettleAccountId(accounts[0]?.id || "");
    };

    const renderRow = (row: (typeof balances)[number]) => {
        const key = keyFor(row.counterparty_name, row.direction);
        const isOpen = settlingKey === key;
        const isOwedToYou = row.direction === "owed_to_you";
        return (
            <div key={key} className="border-b border-base-100 dark:border-base-800 last:border-0 py-3">
                <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                        <div className="font-medium text-base-900 dark:text-base-50 truncate">
                            {row.counterparty_name}
                        </div>
                        <div className="text-xs text-base-500 dark:text-base-400">
                            {isOwedToYou ? "Owes you" : "You owe"}
                        </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                        <span
                            className={
                                isOwedToYou
                                    ? "font-semibold text-emerald-600 dark:text-emerald-400"
                                    : "font-semibold text-red-600 dark:text-red-400"
                            }
                        >
                            {money(Number(row.amount))}
                        </span>
                        <Button
                            size="sm"
                            variant={isOpen ? "ghost" : "secondary"}
                            onClick={() =>
                                isOpen
                                    ? setSettlingKey(null)
                                    : openSettle(row.counterparty_name, row.direction, Number(row.amount))
                            }
                        >
                            {isOpen ? "Cancel" : "Settle"}
                        </Button>
                    </div>
                </div>

                {isOpen && (
                    <settleFetcher.Form
                        method="post"
                        className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] items-end rounded-lg bg-base-50 dark:bg-base-900 p-3"
                        onSubmit={() => setSettlingKey(null)}
                    >
                        <input type="hidden" name="_intent" value="settle" />
                        <input type="hidden" name="counterparty_name" value={row.counterparty_name} />
                        <input type="hidden" name="direction" value={row.direction} />
                        <input type="hidden" name="date" value={`${today()}T12:00:00Z`} />
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-base-600 dark:text-base-400">
                                {isOwedToYou ? "Into account" : "From account"}
                            </label>
                            <Select
                                required
                                name="account_id"
                                placeholder="Select account"
                                value={settleAccountId}
                                onChange={setSettleAccountId}
                                options={accounts.map((a) => ({ value: a.id, label: a.name }))}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-base-600 dark:text-base-400">Amount</label>
                            <Input
                                type="number"
                                step="0.01"
                                min="0"
                                required
                                name="amount"
                                value={settleAmount}
                                onChange={(e) => setSettleAmount(e.target.value)}
                            />
                        </div>
                        <Button type="submit" disabled={settleFetcher.state !== "idle"}>
                            {settleFetcher.state !== "idle" ? "Saving…" : "Record"}
                        </Button>
                    </settleFetcher.Form>
                )}
            </div>
        );
    };

    return (
        <div className="flex-1 min-w-0">
            <TopBar
                title="Shared spending"
                cta={
                    <Button onClick={() => setIsAddOpen((open) => !open)}>
                        {isAddOpen ? "Cancel" : "Someone paid for me"}
                    </Button>
                }
            />

            <div className="p-4 sm:p-6 space-y-6">
                <div className="grid gap-4 sm:grid-cols-2">
                    <StatCard
                        title="Owed to you"
                        value={money(totals.owedToYou)}
                        description="Money you fronted and haven't been paid back for"
                    />
                    <StatCard
                        title="You owe"
                        value={money(totals.youOwe)}
                        description="Spending of yours that somebody else paid for"
                    />
                </div>

                {isAddOpen && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Somebody paid for something of yours</CardTitle>
                            <CardDescription>
                                No account of yours moved, so there's nothing to log against one. The cost still
                                counts towards your budget, and you'll owe them for it until you settle up.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <onBehalfFetcher.Form
                                method="post"
                                className="grid gap-4 sm:grid-cols-2"
                                onSubmit={() => {
                                    setIsAddOpen(false);
                                    setNewExpense({ counterparty_name: "", category_id: "", amount: "", description: "" });
                                }}
                            >
                                <input type="hidden" name="_intent" value="onBehalf" />
                                <input type="hidden" name="date" value={`${today()}T12:00:00Z`} />
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-base-700 dark:text-base-300">Who paid</label>
                                    <Input
                                        required
                                        name="counterparty_name"
                                        placeholder="e.g. Bob"
                                        value={newExpense.counterparty_name}
                                        onChange={(e) =>
                                            setNewExpense({ ...newExpense, counterparty_name: e.target.value })
                                        }
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-base-700 dark:text-base-300">Category</label>
                                    <Select
                                        required
                                        name="category_id"
                                        placeholder="Select category"
                                        value={newExpense.category_id}
                                        onChange={(category_id) => setNewExpense({ ...newExpense, category_id })}
                                        options={expenseCategories.map((c) => ({ value: c.id, label: c.name }))}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-base-700 dark:text-base-300">Amount</label>
                                    <Input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        required
                                        name="amount"
                                        placeholder="0.00"
                                        value={newExpense.amount}
                                        onChange={(e) => setNewExpense({ ...newExpense, amount: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-base-700 dark:text-base-300">
                                        Description
                                    </label>
                                    <Input
                                        name="description"
                                        placeholder="e.g. Concert tickets"
                                        value={newExpense.description}
                                        onChange={(e) => setNewExpense({ ...newExpense, description: e.target.value })}
                                    />
                                </div>
                                <div className="sm:col-span-2 flex justify-end">
                                    <Button type="submit" disabled={onBehalfFetcher.state !== "idle"}>
                                        {onBehalfFetcher.state !== "idle" ? "Saving…" : "Record expense"}
                                    </Button>
                                </div>
                            </onBehalfFetcher.Form>
                        </CardContent>
                    </Card>
                )}

                <div className="grid gap-6 lg:grid-cols-2">
                    <Card>
                        <CardHeader>
                            <CardTitle>Owes you</CardTitle>
                            <CardDescription>
                                From bills you paid in full and split. Only your share was ever charged to a budget.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {owedToYou.length === 0 ? (
                                <p className="text-sm text-base-500 dark:text-base-400 py-4">
                                    Nobody owes you anything. When you pay for someone, tick “Someone owes me for part
                                    of this” as you log the transaction.
                                </p>
                            ) : (
                                owedToYou.map(renderRow)
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>You owe</CardTitle>
                            <CardDescription>
                                Spending of yours that somebody else paid for. Already counted in your budgets.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {youOwe.length === 0 ? (
                                <p className="text-sm text-base-500 dark:text-base-400 py-4">
                                    You don't owe anyone.
                                </p>
                            ) : (
                                youOwe.map(renderRow)
                            )}
                        </CardContent>
                    </Card>
                </div>

                {(settleFetcher.data as { error?: string } | undefined)?.error && (
                    <p className="text-sm text-red-600 dark:text-red-400">
                        {(settleFetcher.data as { error?: string }).error}
                    </p>
                )}
                {(onBehalfFetcher.data as { error?: string } | undefined)?.error && (
                    <p className="text-sm text-red-600 dark:text-red-400">
                        {(onBehalfFetcher.data as { error?: string }).error}
                    </p>
                )}
            </div>
        </div>
    );
}
