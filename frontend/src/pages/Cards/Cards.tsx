import { useState } from "react";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { CreditCard, Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { Dialog } from "../../components/ui/Dialog";
import { TopBar } from "../../components/TopBar";
import { useHousehold } from "../../lib/HouseholdContext";
import { cycleLabel } from "../../lib/cards";
import type { CardsLoaderData } from "./cards.loader";
import { CategorySpendList, LimitMeter, LimitRow } from "./CardMeters";

export { loader, action } from "./cards.loader";

/**
 * Per-card spend limits.
 *
 * The reviewing surface: meters with their cycle dates, and the setup that
 * feeds them. The number that actually changes a decision lives elsewhere — in
 * the category picker when logging a transaction — because a meter you have to
 * go and look at will not stop anyone overspending.
 */
export default function Cards() {
    const { cards, statuses, availableAccounts } = useLoaderData() as CardsLoaderData;
    const actionData = useActionData() as { error?: string; success?: boolean } | undefined;
    const navigation = useNavigation();
    const { activeHousehold } = useHousehold();
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [managingCardId, setManagingCardId] = useState<string | null>(null);

    const isSubmitting = navigation.state === "submitting";
    const baseCurrency = activeHousehold?.base_currency || "USD";

    const managing = cards.find(c => c.id === managingCardId) ?? null;

    // Cards can be in different currencies from each other and from the
    // household, and the issuer's cap is in the card's own — so the formatter
    // is per card rather than one for the page.
    const amountFormatter = (currency: string | null) => (value: number) =>
        new Intl.NumberFormat(undefined, {
            style: "currency",
            currency: currency || baseCurrency,
            maximumFractionDigits: 0,
        }).format(value);

    return (
        <div className="space-y-6">
            <TopBar title="Cards" />

            {actionData?.error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                    {actionData.error}
                </div>
            )}

            <div className="flex items-center justify-between gap-3">
                <p className="max-w-2xl text-sm text-base-500 dark:text-base-400">
                    Track spending against each card's bonus caps and minimum spends, measured on
                    that card's own statement cycle.
                </p>
                {availableAccounts.length > 0 && (
                    <Button variant="cta" onClick={() => setIsAddOpen(true)} className="shrink-0 gap-2">
                        <Plus className="h-4 w-4" /> Set up a card
                    </Button>
                )}
            </div>

            {cards.length === 0 && (
                <Card>
                    <CardContent className="py-10 text-center">
                        <CreditCard className="mx-auto mb-3 h-8 w-8 text-base-300 dark:text-base-700" />
                        <p className="text-sm text-base-600 dark:text-base-400">
                            No cards set up yet.
                        </p>
                        <p className="mt-1 text-xs text-base-500 dark:text-base-500">
                            {availableAccounts.length === 0
                                ? "Add a liability account on the Accounts page first — a card's balance is money owed."
                                : "Set one up on a liability account to start metering its spending."}
                        </p>
                    </CardContent>
                </Card>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
                {cards.map(card => {
                    const status = statuses[card.id];
                    const money = amountFormatter(card.currency);
                    return (
                        <Card key={card.id}>
                            <CardHeader className="flex-row items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <CardTitle className="truncate">{card.account_name}</CardTitle>
                                    <p className="text-xs text-base-500 dark:text-base-400">
                                        {status
                                            ? cycleLabel(status.cycle_start, status.cycle_end)
                                            : card.cycle_basis === "calendar"
                                              ? "Calendar month"
                                              : `Closes on the ${card.statement_day}`}
                                    </p>
                                </div>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => setManagingCardId(card.id)}
                                    className="shrink-0"
                                >
                                    Manage
                                </Button>
                            </CardHeader>
                            <CardContent className="space-y-5">
                                {status && status.limits.length > 0 ? (
                                    <div className="space-y-4">
                                        {status.limits.map(row => (
                                            <LimitMeter key={row.limit_id} row={row} formatAmount={money} />
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-sm text-base-500 dark:text-base-400">
                                        No limits yet. Add a cap or a minimum spend under Manage, and
                                        this card's spending will be measured against it.
                                    </p>
                                )}

                                {status && (
                                    <div className="border-t border-base-100 pt-4 dark:border-base-800">
                                        <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-base-500 dark:text-base-400">
                                            This cycle
                                        </h4>
                                        <CategorySpendList rows={status.categories} formatAmount={money} />
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    );
                })}
            </div>

            {/* --- Set up a card --- */}
            <Dialog isOpen={isAddOpen} onClose={() => setIsAddOpen(false)}>
                <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-base-900">
                    <h3 className="mb-1 text-lg font-semibold text-base-900 dark:text-base-50">
                        Set up a card
                    </h3>
                    <p className="mb-4 text-sm text-base-500 dark:text-base-400">
                        Pick the liability account this card already uses.
                    </p>
                    <Form method="post" onSubmit={() => setIsAddOpen(false)} className="space-y-4">
                        <input type="hidden" name="_intent" value="createCard" />
                        <Select
                            label="Account"
                            name="financial_account_id"
                            required
                            value=""
                            onChange={() => {}}
                            options={availableAccounts.map(a => ({ value: a.id, label: a.name }))}
                        />
                        <Select
                            label="Limits reset on"
                            name="cycle_basis"
                            value=""
                            onChange={() => {}}
                            options={[
                                { value: "statement", label: "The statement cycle" },
                                { value: "calendar", label: "The calendar month" },
                            ]}
                            helperText="Some issuers reset bonus caps on the calendar month whatever day the statement closes. It isn't derivable from the statement date, so it has to be stated."
                        />
                        <Input
                            label="Statement closes on day"
                            name="statement_day"
                            type="number"
                            min="1"
                            max="31"
                            defaultValue="1"
                            helperText="Clamped in shorter months, so 31 still closes in February."
                        />
                        <div className="flex justify-end gap-2">
                            <Button type="button" variant="secondary" onClick={() => setIsAddOpen(false)}>
                                Cancel
                            </Button>
                            <Button type="submit" variant="cta" disabled={isSubmitting}>
                                Set up
                            </Button>
                        </div>
                    </Form>
                </div>
            </Dialog>

            {/* --- Manage one card --- */}
            <Dialog isOpen={managing !== null} onClose={() => setManagingCardId(null)}>
                {managing && (
                    <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-base-900">
                        <h3 className="mb-4 text-lg font-semibold text-base-900 dark:text-base-50">
                            {managing.account_name}
                        </h3>

                        <section className="mb-6">
                            <h4 className="mb-2 text-sm font-medium text-base-900 dark:text-base-50">
                                Limits
                            </h4>
                            {managing.limits.length > 0 ? (
                                <ul className="mb-3 space-y-1.5">
                                    {managing.limits.map(limit => (
                                        <LimitRow
                                            key={limit.id}
                                            limitId={limit.id}
                                            name={limit.name}
                                            amount={limit.amount}
                                            direction={limit.direction}
                                            formatAmount={amountFormatter(managing.currency)}
                                        />
                                    ))}
                                </ul>
                            ) : (
                                <p className="mb-3 text-sm text-base-500 dark:text-base-400">
                                    None yet.
                                </p>
                            )}
                            <Form method="post" className="grid grid-cols-2 gap-2">
                                <input type="hidden" name="_intent" value="createLimit" />
                                <input type="hidden" name="cardId" value={managing.id} />
                                <div className="col-span-2">
                                    <Input name="name" placeholder="e.g. Dining cap" required />
                                </div>
                                <Input name="amount" type="number" step="0.01" min="0" placeholder="1000" required />
                                <Select
                                    name="direction"
                                    value=""
                                    onChange={() => {}}
                                    options={[
                                        { value: "ceiling", label: "Cap — stay under" },
                                        { value: "floor", label: "Minimum — reach it" },
                                    ]}
                                />
                                <Select
                                    name="reset_basis"
                                    value=""
                                    onChange={() => {}}
                                    wrapperClassName="col-span-2"
                                    options={[
                                        { value: "cycle", label: "Resets each statement cycle" },
                                        { value: "calendar_month", label: "Resets each calendar month" },
                                        { value: "quarter", label: "Resets each quarter" },
                                        { value: "year", label: "Resets each year" },
                                    ]}
                                />
                                <p className="col-span-2 text-xs text-base-500 dark:text-base-400">
                                    Enter caps as a spend figure. A cap the issuer states in rewards
                                    ("max $60 cashback") has to be converted — at 10%, that is $600
                                    of spend.
                                </p>
                                <Button type="submit" variant="secondary" size="sm" className="col-span-2">
                                    Add limit
                                </Button>
                            </Form>
                        </section>

                        <section className="mb-6 border-t border-base-100 pt-4 dark:border-base-800">
                            <h4 className="mb-1 text-sm font-medium text-base-900 dark:text-base-50">
                                Categories
                            </h4>
                            <p className="mb-2 text-xs text-base-500 dark:text-base-400">
                                This card's own slicing of spend — free to cut across your budget
                                categories. Untagged spending lands in the default.
                            </p>
                            <ul className="mb-3 space-y-1.5">
                                {managing.categories.map(category => (
                                    <li key={category.id} className="flex items-center justify-between gap-2 text-sm">
                                        <span className="truncate text-base-700 dark:text-base-300">
                                            {category.name}
                                            {category.is_default && (
                                                <span className="ml-2 text-xs text-base-500">default</span>
                                            )}
                                            {!category.limit_id && (
                                                <span className="ml-2 text-xs text-base-400">unmetered</span>
                                            )}
                                        </span>
                                        <Form method="post" className="shrink-0">
                                            <input type="hidden" name="_intent" value="deleteCategory" />
                                            <input type="hidden" name="categoryId" value={category.id} />
                                            <button
                                                type="submit"
                                                aria-label={`Remove ${category.name}`}
                                                className="rounded p-1 text-base-400 hover:text-red-500"
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        </Form>
                                    </li>
                                ))}
                            </ul>
                            <Form method="post" className="grid grid-cols-2 gap-2">
                                <input type="hidden" name="_intent" value="createCategory" />
                                <input type="hidden" name="cardId" value={managing.id} />
                                <Input name="name" placeholder="e.g. Online" required />
                                <Select
                                    name="limit_id"
                                    value=""
                                    onChange={() => {}}
                                    options={[
                                        { value: "", label: "No limit — just track it" },
                                        ...managing.limits.map(l => ({ value: l.id, label: l.name })),
                                    ]}
                                />
                                <Button type="submit" variant="secondary" size="sm" className="col-span-2">
                                    Add category
                                </Button>
                            </Form>
                        </section>

                        <section className="flex items-center justify-between border-t border-base-100 pt-4 dark:border-base-800">
                            <Form method="post" onSubmit={() => setManagingCardId(null)}>
                                <input type="hidden" name="_intent" value="deleteCard" />
                                <input type="hidden" name="cardId" value={managing.id} />
                                <Button type="submit" variant="secondary" size="sm">
                                    Remove card
                                </Button>
                            </Form>
                            <Button variant="cta" size="sm" onClick={() => setManagingCardId(null)}>
                                Done
                            </Button>
                        </section>
                    </div>
                )}
            </Dialog>
        </div>
    );
}
