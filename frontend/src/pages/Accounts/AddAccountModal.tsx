import type { FetcherWithComponents } from "react-router";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { AccountKind, LiquidityStatus, TaxTreatment } from "../../types/types";
import type { AccountResponse, CurrencyResponse, UserResponse } from "../../types/types";
import { LIQUIDITY_LABELS, type NewAccountForm } from "./accountsHelpers";

type Props = {
    isOpen: boolean;
    onClose: () => void;
    newAccount: NewAccountForm;
    setNewAccount: (v: NewAccountForm) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addAccountFetcher: FetcherWithComponents<any>;
    currencies: CurrencyResponse[];
    hasHousehold: boolean;
    /** Illiquid asset accounts a new loan can be secured against. */
    propertyAccounts: AccountResponse[];
    user: UserResponse | null | undefined;
};

/**
 * The "Add Account" modal.
 *
 * ~210 lines of form that used to sit inline in `Accounts.tsx` between the
 * account list and two more modals. It grows a section at a time — loan terms
 * for a liability, appreciation and a linked loan for an illiquid asset — which
 * is exactly the kind of conditional markup that is easier to read on its own.
 *
 * State stays with the page: this renders the form and reports edits back, so a
 * half-filled form has one owner.
 */
export function AddAccountModal({
    isOpen,
    onClose,
    newAccount,
    setNewAccount,
    addAccountFetcher,
    currencies,
    hasHousehold,
    propertyAccounts,
    user,
}: Props) {
    if (!isOpen) return null;
    return (
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
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-base-900 dark:text-base-50">Account Type</label>
                            <Select
                                name="kind"
                                value={newAccount.kind}
                                onChange={(kind) => setNewAccount({ ...newAccount, kind: kind as AccountKind })}
                                options={[
                                    { value: AccountKind.Asset, label: "Asset — cash, savings, investments" },
                                    { value: AccountKind.Liability, label: "Liability — loan, mortgage, credit" },
                                ]}
                            />
                            {newAccount.kind === AccountKind.Liability && (
                                <p className="text-xs text-base-500 dark:text-base-400">Enter the outstanding balance as a positive number — it will be subtracted from your net worth.</p>
                            )}
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-base-900 dark:text-base-50">Liquidity</label>
                                <Select
                                    name="liquidity"
                                    value={newAccount.liquidity}
                                    onChange={(liquidity) => setNewAccount({ ...newAccount, liquidity: liquidity as LiquidityStatus })}
                                    options={Object.values(LiquidityStatus).map(status => ({ value: status, label: LIQUIDITY_LABELS[status] ?? status.replace('_', ' ') }))}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-base-900 dark:text-base-50">Tax Status</label>
                                <Select
                                    name="tax_status"
                                    value={newAccount.tax_status}
                                    onChange={(tax_status) => setNewAccount({ ...newAccount, tax_status: tax_status as TaxTreatment })}
                                    options={Object.values(TaxTreatment).map(status => ({ value: status, label: status.replace('_', ' ') }))}
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-base-900 dark:text-base-50">Initial Balance</label>
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
                                <label className="text-sm font-medium text-base-900 dark:text-base-50">As of Date</label>
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
                            <label className="text-sm font-medium text-base-900 dark:text-base-50">Currency</label>
                            <Select
                                name="currency"
                                value={newAccount.currency}
                                onChange={(currency) => setNewAccount({ ...newAccount, currency })}
                                options={currencies.map(c => ({ value: c.code, label: `${c.code} - ${c.name}` }))}
                            />
                        </div>
                        {/* Loan terms — only meaningful for a liability. Filling these
                            in lets the app amortize the debt down on its own instead of
                            waiting for the user to retype the balance each month. */}
                        {newAccount.kind === AccountKind.Liability && (
                            <div className="space-y-3 rounded-lg border border-base-200 dark:border-base-800 p-3">
                                <div>
                                    <p className="text-sm font-medium text-base-900 dark:text-base-50">Loan terms <span className="font-normal text-base-500">(optional)</span></p>
                                    <p className="text-xs text-base-500 dark:text-base-400">Add these and we'll project the balance down to zero and show your payoff date.</p>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-base-700 dark:text-base-300">Amount borrowed</label>
                                        <Input
                                            name="original_principal"
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            placeholder="400000"
                                            value={newAccount.original_principal}
                                            onChange={(e) => setNewAccount({ ...newAccount, original_principal: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-base-700 dark:text-base-300">Interest rate % / yr</label>
                                        <Input
                                            name="interest_rate_annual"
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            max="100"
                                            placeholder="3.5"
                                            value={newAccount.interest_rate_annual}
                                            onChange={(e) => setNewAccount({ ...newAccount, interest_rate_annual: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-base-700 dark:text-base-300">Term (months)</label>
                                        <Input
                                            name="loan_term_months"
                                            type="number"
                                            step="1"
                                            min="1"
                                            max="720"
                                            placeholder="300"
                                            value={newAccount.loan_term_months}
                                            onChange={(e) => setNewAccount({ ...newAccount, loan_term_months: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-base-700 dark:text-base-300">First payment</label>
                                        <Input
                                            name="loan_start_date"
                                            type="date"
                                            value={newAccount.loan_start_date}
                                            onChange={(e) => setNewAccount({ ...newAccount, loan_start_date: e.target.value })}
                                        />
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-medium text-base-700 dark:text-base-300">Monthly payment <span className="font-normal text-base-500">— leave blank to calculate</span></label>
                                    <Input
                                        name="monthly_payment"
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        placeholder="Calculated from the terms above"
                                        value={newAccount.monthly_payment}
                                        onChange={(e) => setNewAccount({ ...newAccount, monthly_payment: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-medium text-base-700 dark:text-base-300">Secured against</label>
                                    <Select
                                        name="linked_account_id"
                                        value={newAccount.linked_account_id}
                                        onChange={(linked_account_id) => setNewAccount({ ...newAccount, linked_account_id })}
                                        options={[
                                            { value: "", label: "Nothing — unsecured" },
                                            ...propertyAccounts.map(a => ({ value: a.id, label: a.name })),
                                        ]}
                                    />
                                </div>
                            </div>
                        )}

                        {/* Property terms — only for physical assets. */}
                        {newAccount.kind === AccountKind.Asset && newAccount.liquidity === LiquidityStatus.Illiquid && (
                            <div className="space-y-1.5 rounded-lg border border-base-200 dark:border-base-800 p-3">
                                <label className="text-sm font-medium text-base-900 dark:text-base-50">Expected appreciation % / yr <span className="font-normal text-base-500">(optional)</span></label>
                                <Input
                                    name="appreciation_rate_annual"
                                    type="number"
                                    step="0.1"
                                    min="-100"
                                    max="100"
                                    placeholder="Leave blank to hold today's value flat"
                                    value={newAccount.appreciation_rate_annual}
                                    onChange={(e) => setNewAccount({ ...newAccount, appreciation_rate_annual: e.target.value })}
                                />
                                <p className="text-xs text-base-500 dark:text-base-400">Used only for the net worth projection. Your recorded valuations are never overwritten.</p>
                            </div>
                        )}

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
                            <Button variant="ghost" type="button" onClick={() => onClose()}>Cancel</Button>
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
