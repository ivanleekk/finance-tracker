import type React from "react"
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "../../components/ui/Dialog"
import { Button } from "../../components/ui/Button"
import { Input } from "../../components/ui/Input"
import { Select } from "../../components/ui/Select"
import { selectableAccounts } from "../../lib/networth"
import type { AccountResponse, CategoryResponse, CurrencyResponse, UserResponse } from "../../types/types"
import { splitHint } from "./transactionsHelpers"

/** The shape the Income/Expense tab edits. */
export type TransactionFormData = {
    accountId: string
    categoryId: string
    amount: string
    currency: string
    date: string
    description: string
    mcc: string
    /** The card's own category, when the account is a card. "" = the card's default. */
    cardCategoryId: string
    // Part of this bill is somebody else's. The amount stays the full sum that
    // leaves the account — this only says whose it was.
    owedBy: string
    owedAmount: string
}

/** The shape the Transfer tab edits. */
export type TransferFormData = {
    fromAccountId: string
    toAccountId: string
    amount: string
    date: string
    description: string
}

type Props = {
    isOpen: boolean
    onClose: () => void
    activeTab: "transaction" | "transfer"
    onTabChange: (tab: "transaction" | "transfer") => void

    accounts: AccountResponse[]
    categories: CategoryResponse[]
    currencies: CurrencyResponse[]
    /** Includes a disabled header row marking the start of the brand block. */
    mccOptions: { value: string; label: string; disabled?: boolean }[]

    /** Empty unless the selected account is a card. Labels carry this cycle's headroom. */
    cardCategoryOptions: { value: string; label: string }[]
    /** Called when the account changes, so the card's headroom can be fetched. */
    onAccountChange: (accountId: string) => void
    user: UserResponse | null | undefined

    formData: TransactionFormData
    setFormData: (data: TransactionFormData) => void
    onSubmitTransaction: (e: React.FormEvent) => void

    transferData: TransferFormData
    setTransferData: (data: TransferFormData) => void
    onSubmitTransfer: (e: React.FormEvent) => void

    isSubmitting: boolean

    // Splitting a bill. The state lives on the page because its submit handler
    // needs it; this renders it and reports edits back.
    isSplitting: boolean
    setIsSplitting: (v: boolean) => void
    baseCurrency: string

    // Inline "+ New Category" affordance, which lives inside the Category field
    // rather than sending the user off to Settings mid-entry.
    isCreatingCategory: boolean
    setIsCreatingCategory: (v: boolean) => void
    newCategoryName: string
    setNewCategoryName: (v: string) => void
    newCategoryType: "expense" | "income"
    setNewCategoryType: (v: "expense" | "income") => void
    isSavingCategory: boolean
    onCreateCategory: () => void
}

/**
 * The "Log Daily Transaction" / "Internal Transfer" modal.
 *
 * Two tabs over two independent forms, lifted out of `Transactions.tsx` where it
 * was ~240 lines of JSX sitting between the page's filters and its history list.
 * State stays with the page — this renders it and reports edits back, so there is
 * no second source of truth for a half-typed form.
 */
export function LogTransactionDialog({
    isOpen,
    onClose,
    activeTab,
    onTabChange,
    accounts,
    categories,
    currencies,
    mccOptions,
    cardCategoryOptions,
    onAccountChange,
    user,
    formData,
    setFormData,
    onSubmitTransaction,
    transferData,
    setTransferData,
    onSubmitTransfer,
    isSubmitting,
    isSplitting,
    setIsSplitting,
    baseCurrency,
    isCreatingCategory,
    setIsCreatingCategory,
    newCategoryName,
    setNewCategoryName,
    newCategoryType,
    setNewCategoryType,
    isSavingCategory,
    onCreateCategory,
}: Props) {
    return (
        <Dialog isOpen={isOpen} onClose={onClose}>
            <DialogHeader>
                <DialogTitle className="text-base-900 dark:text-base-50">{activeTab === 'transaction' ? 'Log Daily Transaction' : 'Internal Transfer'}</DialogTitle>
                <p className="text-sm text-base-500 dark:text-base-400">
                    {activeTab === 'transaction'
                        ? 'Record food, retail, or income items manually.'
                        : 'Move money between your accounts seamlessly.'}
                </p>
            </DialogHeader>

            {/* Tab Switcher */}
            <div className="flex p-1 bg-base-100 dark:bg-base-900 rounded-lg mb-6">
                <button
                    type="button"
                    className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${activeTab === 'transaction' ? 'bg-white dark:bg-base-700 shadow-sm text-primary-600 dark:text-primary-400' : 'text-base-500 dark:text-base-400 hover:text-base-700 dark:hover:text-base-200'}`}
                    onClick={() => onTabChange('transaction')}
                >
                    Income/Expense
                </button>
                <button
                    type="button"
                    className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${activeTab === 'transfer' ? 'bg-white dark:bg-base-700 shadow-sm text-secondary-600 dark:text-secondary-400' : 'text-base-500 dark:text-base-400 hover:text-base-700 dark:hover:text-base-200'}`}
                    onClick={() => onTabChange('transfer')}
                >
                    Transfer
                </button>
            </div>

            {activeTab === 'transaction' ? (
                <form onSubmit={onSubmitTransaction} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-base-700 dark:text-base-300">Account</label>
                            <Select
                                required
                                placeholder="Select Account"
                                value={formData.accountId}
                                onChange={(accountId) => {
                                    // Moving to a different card makes any pick
                                    // from the old one meaningless, so it is
                                    // cleared here as well as server-side.
                                    setFormData({ ...formData, accountId, cardCategoryId: "" });
                                    onAccountChange(accountId);
                                }}
                                options={selectableAccounts(accounts).map(acc => ({ value: acc.id, label: acc.name }))}
                            />
                        </div>
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label className="text-sm font-medium text-base-700 dark:text-base-300">Category</label>
                                <button
                                    type="button"
                                    onClick={() => setIsCreatingCategory(!isCreatingCategory)}
                                    className="text-xs text-primary-600 hover:underline"
                                >
                                    {isCreatingCategory ? "Cancel" : "+ New Category"}
                                </button>
                            </div>
                            {isCreatingCategory ? (
                                <div className="space-y-2 rounded-lg border border-dashed border-base-300 dark:border-base-700 p-2">
                                    <Input
                                        placeholder="e.g. Food, Salary"
                                        value={newCategoryName}
                                        onChange={(e) => setNewCategoryName(e.target.value)}
                                    />
                                    <div className="flex items-center gap-2">
                                        <div className="flex flex-1 p-0.5 bg-base-100 dark:bg-base-900 rounded-md">
                                            {(["expense", "income"] as const).map(t => (
                                                <button
                                                    key={t}
                                                    type="button"
                                                    onClick={() => setNewCategoryType(t)}
                                                    className={`flex-1 py-1 text-xs font-medium rounded transition-all capitalize ${newCategoryType === t ? 'bg-white dark:bg-base-700 shadow-sm text-base-900 dark:text-base-50' : 'text-base-500 dark:text-base-400'}`}
                                                >
                                                    {t}
                                                </button>
                                            ))}
                                        </div>
                                        <Button
                                            type="button"
                                            size="sm"
                                            disabled={!newCategoryName.trim() || isSavingCategory}
                                            onClick={onCreateCategory}
                                        >
                                            {isSavingCategory ? "Adding…" : "Add"}
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <Select
                                    required
                                    placeholder="Select Category"
                                    value={formData.categoryId}
                                    onChange={(categoryId) => setFormData({ ...formData, categoryId })}
                                    options={categories.map(cat => ({ value: cat.id, label: `${cat.name} (${cat.type})` }))}
                                />
                            )}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-base-700 dark:text-base-300">Currency</label>
                            <Select
                                required
                                placeholder="Select Currency"
                                value={formData.currency}
                                onChange={(currency) => setFormData({ ...formData, currency })}
                                options={currencies.map(curr => ({ value: curr.code, label: `${curr.code} - ${curr.name}` }))}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-base-700 dark:text-base-300">Amount</label>
                            <Input
                                type="number"
                                step="0.01"
                                required
                                placeholder="0.00"
                                value={formData.amount}
                                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-base-700 dark:text-base-300">Date</label>
                            <Input
                                type="date"
                                required
                                value={formData.date.split('T')[0]}
                                onChange={(e) => setFormData({ ...formData, date: e.target.value + 'T12:00:00Z' })}
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-base-700 dark:text-base-300">Description</label>
                        <Input
                            placeholder="e.g. Groceries, Dinner, Salary..."
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        />
                    </div>

                    {/*
                      Splitting a bill. The amount above is untouched: the whole sum
                      really did leave the account. This only records how much of it
                      was somebody else's, so the budget charges you for your share
                      and the rest becomes a debt they owe you.
                    */}
                    <div className="rounded-lg border border-dashed border-base-300 dark:border-base-700 p-3 space-y-3">
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={isSplitting}
                                onChange={(e) => setIsSplitting(e.target.checked)}
                                className="rounded border-base-300 dark:border-base-600 text-primary-600 focus:ring-primary-500"
                            />
                            <span className="text-sm font-medium text-base-700 dark:text-base-300">
                                Someone owes me for part of this
                            </span>
                        </label>
                        {isSplitting && (
                            <>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-base-700 dark:text-base-300">Who</label>
                                        <Input
                                            placeholder="e.g. Alice"
                                            value={formData.owedBy}
                                            onChange={(e) => setFormData({ ...formData, owedBy: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-base-700 dark:text-base-300">They owe</label>
                                        <Input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            placeholder="0.00"
                                            value={formData.owedAmount}
                                            onChange={(e) => setFormData({ ...formData, owedAmount: e.target.value })}
                                        />
                                    </div>
                                </div>
                                <p className="text-xs text-base-500 dark:text-base-400">
                                    {splitHint(formData.amount, formData.owedAmount, baseCurrency)}
                                </p>
                            </>
                        )}
                    </div>

                    {/*
                      Only for users who asked for it in Settings. A four-digit code
                      field on every form would tax everyone for a minority feature —
                      and it is optional even here, since most purchases have no code
                      the user happens to know.
                    */}
                    {/*
                      Only when the selected account is actually a card. The
                      headroom sits in the label because this is the one moment
                      the number can still change the decision — a meter you have
                      to go and look at will not stop anyone overspending.
                    */}
                    {cardCategoryOptions.length > 0 && (
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-base-700 dark:text-base-300">
                                Card category
                            </label>
                            <Select
                                placeholder="Card's default"
                                value={formData.cardCategoryId}
                                onChange={(cardCategoryId) => setFormData({ ...formData, cardCategoryId })}
                                options={cardCategoryOptions}
                            />
                        </div>
                    )}

                    {user?.record_merchant_codes && (
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-base-700 dark:text-base-300">
                                Merchant code <span className="font-normal text-base-400">(optional)</span>
                            </label>
                            <Select
                                placeholder="Leave blank if you don't know it"
                                value={formData.mcc}
                                onChange={(mcc) => setFormData({ ...formData, mcc })}
                                options={mccOptions}
                            />
                            <p className="text-xs text-base-500 dark:text-base-400">
                                Recorded only — nothing is calculated from it.
                            </p>
                        </div>
                    )}

                    <DialogFooter>
                        <Button type="button" variant="ghost" onClick={() => onClose()}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting ? "Logging..." : "Log Transaction"}
                        </Button>
                    </DialogFooter>
                </form>
            ) : (
                <form onSubmit={onSubmitTransfer} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-base-700 dark:text-base-300">From Account</label>
                            <Select
                                required
                                placeholder="Select Source"
                                value={transferData.fromAccountId}
                                onChange={(fromAccountId) => setTransferData({ ...transferData, fromAccountId })}
                                options={selectableAccounts(accounts).map(acc => ({ value: acc.id, label: acc.name, disabled: acc.id === transferData.toAccountId }))}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-base-700 dark:text-base-300">To Account</label>
                            <Select
                                required
                                placeholder="Select Destination"
                                value={transferData.toAccountId}
                                onChange={(toAccountId) => setTransferData({ ...transferData, toAccountId })}
                                options={selectableAccounts(accounts).map(acc => ({ value: acc.id, label: acc.name, disabled: acc.id === transferData.fromAccountId }))}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-base-700 dark:text-base-300">Amount</label>
                            <Input
                                type="number"
                                step="0.01"
                                required
                                placeholder="0.00"
                                value={transferData.amount}
                                onChange={(e) => setTransferData({ ...transferData, amount: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-base-700 dark:text-base-300">Date</label>
                            <Input
                                type="date"
                                required
                                value={transferData.date.split('T')[0]}
                                onChange={(e) => setTransferData({ ...transferData, date: e.target.value + 'T12:00:00Z' })}
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-base-700 dark:text-base-300">Description</label>
                        <Input
                            placeholder="e.g. Savings transfer, Monthly rent..."
                            value={transferData.description}
                            onChange={(e) => setTransferData({ ...transferData, description: e.target.value })}
                        />
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="ghost" onClick={() => onClose()}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting ? "Processing..." : "Transfer Funds"}
                        </Button>
                    </DialogFooter>
                </form>
            )}
        </Dialog>
    )
}
