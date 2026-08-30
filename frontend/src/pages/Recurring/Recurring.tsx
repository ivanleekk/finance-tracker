import { useState, useMemo, useEffect } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { StatCard } from "../../components/ui/StatCard";
import { TopBar } from "../../components/TopBar";
import { OwnershipTag } from "../../components/ui/OwnershipTag";
import { useHousehold } from "../../lib/HouseholdContext";
import { useAuth } from "../../lib/AuthContext";
import { useViewMode, isVisibleInViewMode } from "../../lib/ViewModeContext";
import { RecurrenceFrequency, TransactionType } from "../../types/types";
import type { CategoryResponse, RecurringTransactionResponse } from "../../types/types";
import { frequencyLabel, groupOccurrencesByMonth, netUpcoming } from "../../lib/budgets";
import type { RecurringLoaderData } from "./recurring.loader";

export { loader, action } from "./recurring.loader";

export default function Recurring() {
    const { activeHousehold } = useHousehold();
    const { user } = useAuth();
    const { viewMode, hasHousehold } = useViewMode();
    const {
        rules: allRules = [],
        upcoming = [],
        accounts = [],
        categories = [],
    } = (useLoaderData() as RecurringLoaderData) || {};

    const createFetcher = useFetcher();
    const runFetcher = useFetcher();

    const [isAddOpen, setIsAddOpen] = useState(false);
    const emptyRule = {
        account_id: "",
        category_id: "",
        amount: "",
        description: "",
        frequency: RecurrenceFrequency.Monthly as string,
        start_date: new Date().toISOString().split("T")[0],
        end_date: "",
        isPrivate: user?.default_new_items_private ?? true,
    };
    const [newRule, setNewRule] = useState(emptyRule);

    useEffect(() => {
        if (createFetcher.state === "idle" && createFetcher.data?.success) {
            setIsAddOpen(false);
            setNewRule(emptyRule);
        }
    }, [createFetcher.state, createFetcher.data]);

    const rules = useMemo(
        () => allRules.filter(r => isVisibleInViewMode(r.owner_user_id, viewMode, user?.id)),
        [allRules, viewMode, user?.id]
    );

    const currency = activeHousehold?.base_currency || "USD";
    const formatCurrency = (value: number, curr?: string) =>
        new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: curr || currency,
            maximumFractionDigits: 0,
        }).format(value);

    const accountName = useMemo(() => {
        const map = new Map(accounts.map(a => [a.id, a.name]));
        return (id: string) => map.get(id) ?? "Unknown account";
    }, [accounts]);

    const categoryById = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories]);

    // Only accounts that can actually hold cash flow make sense as a target.
    const selectableAccounts = useMemo(
        () => accounts.filter(a => isVisibleInViewMode(a.owner_user_id, viewMode, user?.id)),
        [accounts, viewMode, user?.id]
    );

    // System categories (Transfer, Balance Adjustment, ...) are bookkeeping the
    // app files for itself, not something a user's rule should post under —
    // filing rent under "Balance Adjustment" would misclassify it and fight
    // the reconciliation logic that owns that category.
    const selectableCategories = useMemo(
        () => categories.filter(c => !c.is_system),
        [categories]
    );

    const monthlyCommitted = useMemo(() => {
        // Normalize every active rule to a monthly figure so "what am I
        // committed to each month" is one comparable number.
        const perMonth: Record<string, number> = {
            [RecurrenceFrequency.Weekly]: 52 / 12,
            [RecurrenceFrequency.Biweekly]: 26 / 12,
            [RecurrenceFrequency.Monthly]: 1,
            [RecurrenceFrequency.Quarterly]: 1 / 3,
            [RecurrenceFrequency.Yearly]: 1 / 12,
        };
        let income = 0;
        let expense = 0;
        rules.filter(r => r.is_active).forEach(rule => {
            const category = categoryById.get(rule.category_id);
            const multiplier = perMonth[rule.frequency] ?? 1;
            const value = Number(rule.amount) * multiplier;
            if (!Number.isFinite(value)) return;
            if (category?.type === TransactionType.Income) income += value;
            else expense += value;
        });
        return { income, expense, net: income - expense };
    }, [rules, categoryById]);

    const visibleUpcoming = useMemo(() => {
        const visibleRuleIds = new Set(rules.map(r => r.id));
        return upcoming.filter(o => visibleRuleIds.has(o.recurring_transaction_id));
    }, [upcoming, rules]);

    const upcomingGroups = useMemo(() => groupOccurrencesByMonth(visibleUpcoming), [visibleUpcoming]);

    const dueNow = useMemo(() => {
        const today = new Date().toISOString().split("T")[0];
        return rules.filter(r => r.is_active && r.next_due_date <= today).length;
    }, [rules]);

    if (!activeHousehold) {
        return (
            <div className="flex-1 flex items-center justify-center p-8 text-base-500">
                Please select or create a household.
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            <TopBar
                title="Recurring"
                commandPlaceholder="Log or find…"
                cta={
                    <Button variant="cta" onClick={() => setIsAddOpen(true)} disabled={accounts.length === 0 || selectableCategories.length === 0}>
                        + Add recurring
                    </Button>
                }
            />
            <div className="flex-1 overflow-y-auto space-y-6 p-4 sm:p-6 lg:p-8">
                <p className="text-base-500 dark:text-base-400 -mt-2">
                    Salary, rent, subscriptions — set them once and they post themselves.
                </p>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <StatCard title="Committed each month" value={formatCurrency(monthlyCommitted.expense)} description="recurring expenses" />
                    <StatCard title="Expected each month" value={formatCurrency(monthlyCommitted.income)} description="recurring income" />
                    <StatCard
                        title="Net monthly"
                        value={formatCurrency(monthlyCommitted.net)}
                        description={monthlyCommitted.net >= 0 ? "income covers commitments" : "commitments exceed income"}
                    />
                    <StatCard
                        title="Next 90 days"
                        value={formatCurrency(netUpcoming(visibleUpcoming))}
                        description="net of scheduled items"
                    />
                </div>

                {/* Anything overdue can be posted without waiting for the nightly job. */}
                {dueNow > 0 && (
                    <Card>
                        <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <p className="font-medium text-base-900 dark:text-base-50">
                                    {dueNow} recurring {dueNow === 1 ? "transaction is" : "transactions are"} due
                                </p>
                                <p className="text-sm text-base-500 dark:text-base-400">
                                    These post automatically overnight — or post them now.
                                </p>
                            </div>
                            <runFetcher.Form method="post">
                                <input type="hidden" name="_intent" value="runNow" />
                                <Button variant="primary" type="submit" disabled={runFetcher.state !== "idle"}>
                                    {runFetcher.state !== "idle" ? "Posting…" : "Post due now"}
                                </Button>
                            </runFetcher.Form>
                        </CardContent>
                    </Card>
                )}

                {runFetcher.data?.success && runFetcher.state === "idle" && (
                    <p className="text-sm text-emerald-600 dark:text-emerald-400">
                        Posted {runFetcher.data.posted} transaction{runFetcher.data.posted === 1 ? "" : "s"}.
                    </p>
                )}

                {/* Rules */}
                <Card>
                    <CardHeader>
                        <CardTitle>Your recurring transactions</CardTitle>
                        <CardDescription>Pause one to stop it posting without losing its schedule.</CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                        {rules.map(rule => (
                            <RuleRow
                                key={rule.id}
                                rule={rule}
                                category={categoryById.get(rule.category_id)}
                                accountLabel={accountName(rule.account_id)}
                                formatCurrency={formatCurrency}
                                showOwnershipTag={hasHousehold && viewMode === "blended"}
                            />
                        ))}

                        {rules.length === 0 && (
                            <div className="py-10 text-center space-y-2">
                                <p className="text-base-500 dark:text-base-400">Nothing recurring yet.</p>
                                <p className="text-sm text-base-400 dark:text-base-500">
                                    Add your salary and rent first — they're the two that make the
                                    rest of the picture accurate.
                                </p>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Upcoming agenda */}
                {upcomingGroups.length > 0 && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Coming up</CardTitle>
                            <CardDescription>The next 90 days of scheduled money movements.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {upcomingGroups.map(group => (
                                <div key={group.month}>
                                    <h4 className="font-display font-bold text-xs text-base-500 uppercase tracking-wider mb-1.5">
                                        {group.label}
                                    </h4>
                                    <div className="space-y-1">
                                        {group.items.map((item, index) => (
                                            <div
                                                key={`${item.recurring_transaction_id}-${item.date}-${index}`}
                                                className="flex items-center justify-between gap-3 text-sm py-1.5 border-b last:border-b-0 border-base-100 dark:border-base-800/60"
                                            >
                                                <span className="font-mono text-xs text-base-400 w-14 shrink-0">
                                                    {new Date(item.date).toLocaleDateString("default", { day: "numeric", month: "short", timeZone: "UTC" })}
                                                </span>
                                                <span className="flex-1 text-base-900 dark:text-base-50 truncate">
                                                    {item.description || item.category_name}
                                                </span>
                                                <span className="text-xs text-base-400 hidden sm:block">{item.account_name}</span>
                                                <span className={`font-mono font-semibold shrink-0 ${item.transaction_type === TransactionType.Income ? "text-emerald-600 dark:text-emerald-400" : "text-base-900 dark:text-base-50"}`}>
                                                    {item.transaction_type === TransactionType.Income ? "+" : "−"}
                                                    {formatCurrency(Number(item.amount), item.currency || undefined)}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                )}

                {/* Add rule modal */}
                {isAddOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                        <Card className="w-full max-w-md bg-white dark:bg-base-900 shadow-xl border-base-200 dark:border-base-800 flex flex-col max-h-[85vh]">
                            <CardHeader>
                                <CardTitle>Add a recurring transaction</CardTitle>
                                <CardDescription>
                                    It posts on its own from the start date onward — back-date the
                                    start and we'll catch up what you've already paid.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="overflow-y-auto">
                                <createFetcher.Form method="post" className="space-y-4">
                                    <input type="hidden" name="_intent" value="createRule" />
                                    <input type="hidden" name="current_user_id" value={user?.id ?? ""} />

                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-base-900 dark:text-base-50">Description</label>
                                        <Input
                                            name="description"
                                            placeholder="e.g. Monthly rent"
                                            value={newRule.description}
                                            onChange={(e) => setNewRule({ ...newRule, description: e.target.value })}
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-base-900 dark:text-base-50">Category</label>
                                        <Select
                                            name="category_id"
                                            value={newRule.category_id}
                                            onChange={(category_id) => setNewRule({ ...newRule, category_id })}
                                            options={[
                                                { value: "", label: "Choose a category…" },
                                                ...selectableCategories.map(c => ({
                                                    value: c.id,
                                                    label: `${c.name} (${c.type})`,
                                                })),
                                            ]}
                                        />
                                        <p className="text-xs text-base-500 dark:text-base-400">
                                            An income category adds to the account; an expense category subtracts.
                                        </p>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-base-900 dark:text-base-50">Account</label>
                                        <Select
                                            name="account_id"
                                            value={newRule.account_id}
                                            onChange={(account_id) => setNewRule({ ...newRule, account_id })}
                                            options={[
                                                { value: "", label: "Choose an account…" },
                                                ...selectableAccounts.map(a => ({ value: a.id, label: a.name })),
                                            ]}
                                        />
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium text-base-900 dark:text-base-50">Amount</label>
                                            <Input
                                                name="amount"
                                                type="number"
                                                step="0.01"
                                                min="0.01"
                                                placeholder="1800"
                                                value={newRule.amount}
                                                onChange={(e) => setNewRule({ ...newRule, amount: e.target.value })}
                                                required
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium text-base-900 dark:text-base-50">Frequency</label>
                                            <Select
                                                name="frequency"
                                                value={newRule.frequency}
                                                onChange={(frequency) => setNewRule({ ...newRule, frequency })}
                                                options={Object.values(RecurrenceFrequency).map(f => ({
                                                    value: f,
                                                    label: frequencyLabel(f),
                                                }))}
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium text-base-900 dark:text-base-50">First occurrence</label>
                                            <Input
                                                name="start_date"
                                                type="date"
                                                value={newRule.start_date}
                                                onChange={(e) => setNewRule({ ...newRule, start_date: e.target.value })}
                                                required
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium text-base-900 dark:text-base-50">
                                                Ends <span className="font-normal text-base-500">(optional)</span>
                                            </label>
                                            <Input
                                                name="end_date"
                                                type="date"
                                                value={newRule.end_date}
                                                onChange={(e) => setNewRule({ ...newRule, end_date: e.target.value })}
                                            />
                                        </div>
                                    </div>

                                    {hasHousehold && (
                                        <label className="flex items-center gap-2.5 rounded-lg border border-base-200 dark:border-base-800 px-3 py-2.5 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                name="is_private"
                                                checked={newRule.isPrivate}
                                                onChange={(e) => setNewRule({ ...newRule, isPrivate: e.target.checked })}
                                                className="accent-secondary-500"
                                            />
                                            <span className="text-sm text-base-700 dark:text-base-300">🔒 Private — only visible to you</span>
                                        </label>
                                    )}

                                    {createFetcher.data?.error && (
                                        <p className="text-sm text-red-600 dark:text-red-400">{createFetcher.data.error}</p>
                                    )}

                                    <div className="flex gap-3 justify-end pt-4">
                                        <Button variant="ghost" type="button" onClick={() => setIsAddOpen(false)}>Cancel</Button>
                                        <Button
                                            variant="primary"
                                            type="submit"
                                            disabled={createFetcher.state !== "idle" || !newRule.account_id || !newRule.category_id}
                                        >
                                            {createFetcher.state !== "idle" ? "Saving…" : "Add recurring"}
                                        </Button>
                                    </div>
                                </createFetcher.Form>
                            </CardContent>
                        </Card>
                    </div>
                )}
            </div>
        </div>
    );
}

function RuleRow({
    rule,
    category,
    accountLabel,
    formatCurrency,
    showOwnershipTag,
}: {
    rule: RecurringTransactionResponse;
    category: CategoryResponse | undefined;
    accountLabel: string;
    formatCurrency: (value: number, curr?: string) => string;
    showOwnershipTag: boolean;
}) {
    // Each row gets its own fetchers — sharing one across every row in the list
    // meant two rows' submissions could stomp on each other's pending/error state.
    const toggleFetcher = useFetcher();
    const deleteFetcher = useFetcher();
    const isIncome = category?.type === TransactionType.Income;
    const isDeleting = deleteFetcher.state !== "idle";

    return (
        <div
            className={`flex flex-wrap items-center gap-3 px-4 py-3 border-b last:border-b-0 border-base-100 dark:border-base-800/70 ${rule.is_active ? "" : "opacity-55"}`}
        >
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${isIncome ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-primary-500/10 text-primary-600 dark:text-primary-400"}`}>
                {isIncome ? "↓" : "↑"}
            </div>
            <div className="flex-1 min-w-[160px]">
                <div className="flex items-center gap-2">
                    <span className="font-medium text-base-900 dark:text-base-50">
                        {rule.description || category?.name || "Recurring"}
                    </span>
                    <OwnershipTag
                        ownerUserId={rule.owner_user_id}
                        show={showOwnershipTag}
                        className="text-[9px] px-1.5 py-0 h-4"
                    />
                    {!rule.is_active && (
                        <span className="text-[10px] font-mono uppercase tracking-wide text-base-400">paused</span>
                    )}
                </div>
                <div className="text-[11px] text-base-500 dark:text-base-400">
                    {frequencyLabel(rule.frequency)} · {category?.name ?? "—"} · {accountLabel}
                </div>
                {deleteFetcher.data?.error && (
                    <p className="text-[11px] text-red-600 dark:text-red-400 mt-0.5">{deleteFetcher.data.error}</p>
                )}
                {toggleFetcher.data?.error && (
                    <p className="text-[11px] text-red-600 dark:text-red-400 mt-0.5">{toggleFetcher.data.error}</p>
                )}
            </div>
            <div className="text-right min-w-28 shrink-0">
                <div className={`font-mono font-semibold ${isIncome ? "text-emerald-600 dark:text-emerald-400" : "text-base-900 dark:text-base-50"}`}>
                    {isIncome ? "+" : "−"}{formatCurrency(Number(rule.amount), rule.currency || undefined)}
                </div>
                <div className="text-[10px] font-mono text-base-400">
                    {rule.is_active
                        ? `next ${new Date(rule.next_due_date).toLocaleDateString("default", { day: "numeric", month: "short", timeZone: "UTC" })}`
                        : "paused"}
                </div>
            </div>
            <div className="flex items-center gap-1 shrink-0 ml-auto">
                <toggleFetcher.Form method="post" className="inline">
                    <input type="hidden" name="_intent" value="toggleRule" />
                    <input type="hidden" name="ruleId" value={rule.id} />
                    <input type="hidden" name="is_active" value={String(!rule.is_active)} />
                    <Button variant="ghost" size="sm" type="submit" disabled={toggleFetcher.state !== "idle"}>
                        {rule.is_active ? "Pause" : "Resume"}
                    </Button>
                </toggleFetcher.Form>
                <deleteFetcher.Form
                    method="post"
                    className="inline"
                    onSubmit={(e) => {
                        if (!window.confirm(`Delete "${rule.description || category?.name || "this recurring transaction"}"? This won't affect transactions it already posted.`)) {
                            e.preventDefault();
                        }
                    }}
                >
                    <input type="hidden" name="_intent" value="deleteRule" />
                    <input type="hidden" name="ruleId" value={rule.id} />
                    <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700" type="submit" disabled={isDeleting}>
                        {isDeleting ? "Deleting…" : "Delete"}
                    </Button>
                </deleteFetcher.Form>
            </div>
        </div>
    );
}
