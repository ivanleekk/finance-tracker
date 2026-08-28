import { useState } from "react";
import { useActionData, useLoaderData, useNavigation } from "react-router";
import { CreditCard, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { TopBar } from "../../components/TopBar";
import { useHousehold } from "../../lib/HouseholdContext";
import { cycleLabel } from "../../lib/cards";
import type { CardsLoaderData } from "./cards.loader";
import { CategorySpendList, LimitMeter } from "./CardMeters";
import { ManageCardDialog, SetUpCardDialog } from "./CardDialogs";

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

            <SetUpCardDialog
                isOpen={isAddOpen}
                onClose={() => setIsAddOpen(false)}
                accounts={availableAccounts}
                isSubmitting={isSubmitting}
            />

            <ManageCardDialog
                card={managing}
                onClose={() => setManagingCardId(null)}
                formatAmount={amountFormatter(managing?.currency ?? null)}
            />

        </div>
    );
}
