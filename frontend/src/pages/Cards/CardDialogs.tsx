import { useEffect, useRef, useState } from "react";
import { Form, useFetcher } from "react-router";
import { Trash2 } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { selectableAccounts } from "../../lib/networth";
import { Dialog } from "../../components/ui/Dialog";
import { LimitRow } from "./CardMeters";
import type { AccountResponse, CardResponse } from "../../types/types";

/**
 * The setup dialogs.
 *
 * They are components rather than markup inlined into the page for one concrete
 * reason: `Select` is fully controlled — it holds no value of its own and
 * renders the submitted value into a hidden native `<select>`. Written inline
 * with `value=""` and a no-op `onChange`, every one of these fields silently
 * submitted an empty string, which made a minimum spend impossible to create.
 * Owning the state here is what makes the forms actually work, and the state
 * has to live somewhere that re-renders on change.
 */

const RESET_OPTIONS = [
    { value: "cycle", label: "Resets each statement cycle" },
    { value: "calendar_month", label: "Resets each calendar month" },
    { value: "quarter", label: "Resets each quarter" },
    { value: "year", label: "Resets each year" },
];

export function SetUpCardDialog({
    isOpen,
    onClose,
    accounts,
    isSubmitting,
}: {
    isOpen: boolean;
    onClose: () => void;
    accounts: AccountResponse[];
    isSubmitting: boolean;
}) {
    const [accountId, setAccountId] = useState("");
    const [cycleBasis, setCycleBasis] = useState("statement");

    const close = () => {
        setAccountId("");
        setCycleBasis("statement");
        onClose();
    };

    return (
        <Dialog isOpen={isOpen} onClose={close}>
            <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-base-900">
                <h3 className="mb-1 text-lg font-semibold text-base-900 dark:text-base-50">
                    Set up a card
                </h3>
                <p className="mb-4 text-sm text-base-500 dark:text-base-400">
                    Pick the liability account this card already uses.
                </p>
                <Form method="post" onSubmit={close} className="space-y-4">
                    <input type="hidden" name="_intent" value="createCard" />
                    <Select
                        label="Account"
                        name="financial_account_id"
                        required
                        value={accountId}
                        onChange={setAccountId}
                        options={selectableAccounts(accounts).map(a => ({ value: a.id, label: a.name }))}
                    />
                    <Select
                        label="Limits reset on"
                        name="cycle_basis"
                        value={cycleBasis}
                        onChange={setCycleBasis}
                        options={[
                            { value: "statement", label: "The statement cycle" },
                            { value: "calendar", label: "The calendar month" },
                        ]}
                        helperText="Some issuers reset bonus caps on the calendar month whatever day the statement closes. It isn't derivable from the statement date, so it has to be stated."
                    />
                    {cycleBasis === "statement" && (
                        <Input
                            label="Statement closes on day"
                            name="statement_day"
                            type="number"
                            min="1"
                            max="31"
                            defaultValue="1"
                            helperText="Clamped in shorter months, so 31 still closes in February."
                        />
                    )}
                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="secondary" onClick={close}>
                            Cancel
                        </Button>
                        <Button type="submit" variant="cta" disabled={!accountId || isSubmitting}>
                            Set up
                        </Button>
                    </div>
                </Form>
            </div>
        </Dialog>
    );
}

/**
 * Submitted through a fetcher rather than the page's own Form so the fields can
 * be cleared once the server has actually accepted them. A plain Form leaves
 * the previous limit's name and amount sitting in the inputs, which is one
 * mis-click away from creating it twice.
 */
function AddLimitForm({ card }: { card: CardResponse }) {
    const fetcher = useFetcher<{ error?: string; success?: boolean }>();
    const formRef = useRef<HTMLFormElement>(null);
    const [direction, setDirection] = useState("ceiling");
    const [resetBasis, setResetBasis] = useState("cycle");

    const saved = fetcher.state === "idle" && fetcher.data?.success;
    useEffect(() => {
        if (!saved) return;
        formRef.current?.reset();
        setDirection("ceiling");
        setResetBasis("cycle");
    }, [saved]);

    return (
        <fetcher.Form method="post" ref={formRef} className="grid grid-cols-2 gap-2">
            <input type="hidden" name="_intent" value="createLimit" />
            <input type="hidden" name="cardId" value={card.id} />
            <div className="col-span-2">
                <Input name="name" placeholder="e.g. Dining cap" required />
            </div>
            <Input name="amount" type="number" step="0.01" min="0" placeholder="1000" required />
            <Select
                name="direction"
                value={direction}
                onChange={setDirection}
                options={[
                    { value: "ceiling", label: "Cap — stay under" },
                    { value: "floor", label: "Minimum — reach it" },
                ]}
            />
            <Select
                name="reset_basis"
                value={resetBasis}
                onChange={setResetBasis}
                wrapperClassName="col-span-2"
                options={RESET_OPTIONS}
            />
            <p className="col-span-2 text-xs text-base-500 dark:text-base-400">
                {direction === "floor"
                    ? "The spend you need to reach — a fee waiver or a bonus qualifier."
                    : "Enter caps as a spend figure. A cap the issuer states in rewards (“max $60 cashback”) has to be converted — at 10%, that is $600 of spend."}
            </p>
            {fetcher.data?.error && (
                <p className="col-span-2 text-xs text-red-600 dark:text-red-400">
                    {fetcher.data.error}
                </p>
            )}
            <Button
                type="submit"
                variant="secondary"
                size="sm"
                className="col-span-2"
                disabled={fetcher.state !== "idle"}
            >
                Add limit
            </Button>
        </fetcher.Form>
    );
}

function AddCategoryForm({ card }: { card: CardResponse }) {
    const fetcher = useFetcher<{ error?: string; success?: boolean }>();
    const formRef = useRef<HTMLFormElement>(null);
    const [limitId, setLimitId] = useState("");

    const saved = fetcher.state === "idle" && fetcher.data?.success;
    useEffect(() => {
        if (!saved) return;
        formRef.current?.reset();
        setLimitId("");
    }, [saved]);

    return (
        <fetcher.Form method="post" ref={formRef} className="grid grid-cols-2 gap-2">
            <input type="hidden" name="_intent" value="createCategory" />
            <input type="hidden" name="cardId" value={card.id} />
            <Input name="name" placeholder="e.g. Online" required />
            <Select
                name="limit_id"
                value={limitId}
                onChange={setLimitId}
                options={[
                    { value: "", label: "No limit — just track it" },
                    ...card.limits.map(l => ({ value: l.id, label: l.name })),
                ]}
            />
            {fetcher.data?.error && (
                <p className="col-span-2 text-xs text-red-600 dark:text-red-400">
                    {fetcher.data.error}
                </p>
            )}
            <Button
                type="submit"
                variant="secondary"
                size="sm"
                className="col-span-2"
                disabled={fetcher.state !== "idle"}
            >
                Add category
            </Button>
        </fetcher.Form>
    );
}

export function ManageCardDialog({
    card,
    onClose,
    formatAmount,
}: {
    card: CardResponse | null;
    onClose: () => void;
    formatAmount: (value: number) => string;
}) {
    return (
        <Dialog isOpen={card !== null} onClose={onClose}>
            {card && (
                <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-base-900">
                    <h3 className="mb-4 text-lg font-semibold text-base-900 dark:text-base-50">
                        {card.account_name}
                    </h3>

                    <section className="mb-6">
                        <h4 className="mb-2 text-sm font-medium text-base-900 dark:text-base-50">
                            Limits
                        </h4>
                        {card.limits.length > 0 ? (
                            <ul className="mb-3 space-y-1.5">
                                {card.limits.map(limit => (
                                    <LimitRow
                                        key={limit.id}
                                        limitId={limit.id}
                                        name={limit.name}
                                        amount={limit.amount}
                                        direction={limit.direction}
                                        formatAmount={formatAmount}
                                    />
                                ))}
                            </ul>
                        ) : (
                            <p className="mb-3 text-sm text-base-500 dark:text-base-400">None yet.</p>
                        )}
                        {/* Keyed on the card so switching cards resets the form
                            rather than carrying the previous one's choices over. */}
                        <AddLimitForm key={`limit-${card.id}`} card={card} />
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
                            {card.categories.map(category => (
                                <li
                                    key={category.id}
                                    className="flex items-center justify-between gap-2 text-sm"
                                >
                                    <span className="truncate text-base-700 dark:text-base-300">
                                        {category.name}
                                        {category.is_default && (
                                            <span className="ml-2 text-xs text-base-500">default</span>
                                        )}
                                        {!category.limit_id && (
                                            <span className="ml-2 text-xs text-base-400">unmetered</span>
                                        )}
                                    </span>
                                    <div className="flex shrink-0 items-center gap-1">
                                        {!category.is_default && (
                                            <Form method="post">
                                                <input type="hidden" name="_intent" value="updateCategory" />
                                                <input type="hidden" name="categoryId" value={category.id} />
                                                <input type="hidden" name="make_default" value="on" />
                                                <button
                                                    type="submit"
                                                    className="rounded px-1.5 py-0.5 text-xs text-base-500 hover:text-base-900 dark:hover:text-base-50"
                                                >
                                                    Make default
                                                </button>
                                            </Form>
                                        )}
                                        <Form method="post">
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
                                    </div>
                                </li>
                            ))}
                        </ul>
                        <AddCategoryForm key={`cat-${card.id}`} card={card} />
                    </section>

                    <section className="flex items-center justify-between border-t border-base-100 pt-4 dark:border-base-800">
                        <Form method="post" onSubmit={onClose}>
                            <input type="hidden" name="_intent" value="deleteCard" />
                            <input type="hidden" name="cardId" value={card.id} />
                            <Button type="submit" variant="secondary" size="sm">
                                Remove card
                            </Button>
                        </Form>
                        <Button variant="cta" size="sm" onClick={onClose}>
                            Done
                        </Button>
                    </section>
                </div>
            )}
        </Dialog>
    );
}
