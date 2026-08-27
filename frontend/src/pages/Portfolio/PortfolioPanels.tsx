import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../components/ui/Card"
import { Button } from "../../components/ui/Button"
import { Input } from "../../components/ui/Input"
import { Select } from "../../components/ui/Select"
import type {
    AccountResponse,
    AssetResponse,
    CurrencyResponse,
    HouseholdResponse,
    SubPortfolioResponse,
} from "../../types/types"
import type { Holding } from "./portfolioHelpers"

/**
 * The Portfolio page's four inline panels: move cash, correct an asset's
 * identity, record a manual price, and rename a sub-portfolio.
 *
 * Each was a conditional block stacked in `Portfolio.tsx`'s JSX between the
 * sub-portfolio tabs and the stats row. They are forms over page state, so the
 * state stays on the page and each panel takes exactly what it reads or writes.
 * Props keep the page's own names so the markup moved verbatim.
 *
 * Each returns its own `&&` guard rather than being wrapped in one at the call
 * site, which keeps the page's JSX a flat list of panels.
 */

type AssetForm = {
    ticker: string
    name: string
    type: string
    currency: string
    pricing_mode: "market" | "manual"
}

export function CashPanel({
    isManagingCash, activeSubportfolioObj, activeTab, accounts, activeHousehold,
    cashDirection, setCashDirection, cashAccountId, setCashAccountId,
    cashAmount, setCashAmount, cashDate, setCashDate,
    cashError, isSubmittingCash, handleCashMove,
}: {
    isManagingCash: boolean
    activeSubportfolioObj: SubPortfolioResponse | undefined
    activeTab: string
    accounts: AccountResponse[]
    activeHousehold: HouseholdResponse
    cashDirection: "deposit" | "withdraw"
    setCashDirection: (v: "deposit" | "withdraw") => void
    cashAccountId: string
    setCashAccountId: (v: string) => void
    cashAmount: string
    setCashAmount: (v: string) => void
    cashDate: string
    setCashDate: (v: string) => void
    cashError: string | null
    isSubmittingCash: boolean
    handleCashMove: () => void
}) {
    return (
        isManagingCash && activeSubportfolioObj && (
            <Card className="bg-emerald-50/30 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800 border-dashed">
                <CardContent className="pt-6 space-y-4">
                    {cashError && (
                        <div className="p-3 rounded text-sm bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400">
                            {cashError}
                        </div>
                    )}
                    <div className="flex items-end gap-4 flex-wrap">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-base-900 dark:text-base-50">Action</label>
                            <Select
                                className="h-[42px] w-36"
                                value={cashDirection}
                                onChange={(v) => setCashDirection(v as "deposit" | "withdraw")}
                                options={[
                                    { value: "deposit", label: "Deposit" },
                                    { value: "withdraw", label: "Withdraw" },
                                ]}
                            />
                        </div>
                        <div className="flex-1 min-w-[160px] space-y-2">
                            <label className="text-sm font-medium text-base-900 dark:text-base-50">
                                {cashDirection === "deposit" ? "From Account" : "To Account"}
                            </label>
                            <Select
                                className="h-[42px]"
                                value={cashAccountId}
                                onChange={setCashAccountId}
                                placeholder="No accounts available"
                                options={accounts.map(acc => ({ value: acc.id, label: `${acc.name} (${acc.currency})` }))}
                            />
                        </div>
                        <div className="flex-1 min-w-[120px] space-y-2">
                            <Input
                                label={`Amount (${accounts.find(a => a.id === cashAccountId)?.currency || activeHousehold.base_currency || "USD"})`}
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder="0.00"
                                value={cashAmount}
                                onChange={e => setCashAmount(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Input
                                label="Date"
                                type="date"
                                value={cashDate}
                                onChange={e => setCashDate(e.target.value)}
                            />
                        </div>
                        <Button
                            variant="primary"
                            className="h-[42px]"
                            onClick={handleCashMove}
                            disabled={isSubmittingCash || accounts.length === 0}
                        >
                            {isSubmittingCash ? "Saving..." : (cashDirection === "deposit" ? "Deposit Cash" : "Withdraw Cash")}
                        </Button>
                    </div>
                    <p className="text-xs text-base-500 dark:text-base-400">
                        {cashDirection === "deposit"
                            ? `Moves cash from the selected account into ${activeTab}, where it counts toward the portfolio's value until you invest or withdraw it.`
                            : `Moves uninvested cash out of ${activeTab} back into the selected account.`}
                    </p>
                </CardContent>
            </Card>
        )
    )
}

export function AssetPanel({
    editingAsset, setEditingAsset, assetForm, setAssetForm, currencies,
    assetError, isSubmittingAsset, handleUpdateAsset,
}: {
    editingAsset: AssetResponse | null
    setEditingAsset: (v: AssetResponse | null) => void
    assetForm: AssetForm
    setAssetForm: (v: AssetForm) => void
    currencies: CurrencyResponse[]
    assetError: string | null
    isSubmittingAsset: boolean
    handleUpdateAsset: () => void
}) {
    return (
        editingAsset && (
            <Card className="border-primary-200 dark:border-primary-800 border-dashed">
                <CardHeader>
                    <CardTitle>Edit {editingAsset.ticker}</CardTitle>
                    <CardDescription>
                        Fixing the ticker or currency recalculates this asset's valuations back to your first trade — the numbers below refresh once it saves.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {assetError && (
                        <div className="p-3 rounded text-sm bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400">
                            {assetError}
                        </div>
                    )}
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Input
                            label="Ticker"
                            value={assetForm.ticker}
                            onChange={e => setAssetForm({ ...assetForm, ticker: e.target.value.toUpperCase() })}
                            placeholder="G3B.SI"
                        />
                        <Input
                            label="Name"
                            value={assetForm.name}
                            onChange={e => setAssetForm({ ...assetForm, name: e.target.value })}
                        />
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-base-900 dark:text-base-50">Currency</label>
                            <Select
                                className="h-[42px]"
                                value={assetForm.currency}
                                onChange={currency => setAssetForm({ ...assetForm, currency })}
                                options={(currencies.length > 0
                                    ? currencies.map(c => ({ value: c.code, label: `${c.code} - ${c.name}` }))
                                    : [{ value: assetForm.currency, label: assetForm.currency }])}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-base-900 dark:text-base-50">Pricing</label>
                            <Select
                                className="h-[42px]"
                                value={assetForm.pricing_mode}
                                onChange={mode => setAssetForm({ ...assetForm, pricing_mode: mode as "market" | "manual" })}
                                options={[
                                    { value: "market", label: "Automatic (market data)" },
                                    { value: "manual", label: "Manual (I record prices)" },
                                ]}
                            />
                        </div>
                    </div>
                    <p className="text-xs text-base-500 dark:text-base-400">
                        The ticker has to match the exchange symbol we look prices up by — Singapore listings end in <span className="font-mono">.SI</span>, London in <span className="font-mono">.L</span>. Renaming an automatically-priced asset re-fetches its price history under the new symbol.
                    </p>
                    <div className="flex items-center gap-2">
                        <Button variant="primary" onClick={handleUpdateAsset} disabled={isSubmittingAsset}>
                            {isSubmittingAsset ? "Saving..." : "Save Asset"}
                        </Button>
                        <Button variant="ghost" onClick={() => setEditingAsset(null)}>Cancel</Button>
                    </div>
                </CardContent>
            </Card>
        )
    )
}

export function PricePanel({
    priceHolding, setPriceHolding, priceValue, setPriceValue, priceDate, setPriceDate,
    priceError, isSubmittingPrice, handleRecordPrice,
}: {
    priceHolding: Holding | null
    setPriceHolding: (v: Holding | null) => void
    priceValue: string
    setPriceValue: (v: string) => void
    priceDate: string
    setPriceDate: (v: string) => void
    priceError: string | null
    isSubmittingPrice: boolean
    handleRecordPrice: () => void
}) {
    return (
        priceHolding && (
            <Card className="bg-secondary-50/30 dark:bg-secondary-900/10 border-secondary-200 dark:border-secondary-800 border-dashed">
                <CardContent className="pt-6 space-y-4">
                    {priceError && (
                        <div className="p-3 rounded text-sm bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400">
                            {priceError}
                        </div>
                    )}
                    <div className="flex items-end gap-4 flex-wrap">
                        <div className="flex-1 min-w-[120px] space-y-2">
                            <Input
                                label={`${priceHolding.ticker} price (${priceHolding.currency})`}
                                type="number"
                                step="0.0001"
                                min="0"
                                placeholder="0.00"
                                value={priceValue}
                                onChange={e => setPriceValue(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Input
                                label="As of Date"
                                type="date"
                                value={priceDate}
                                onChange={e => setPriceDate(e.target.value)}
                            />
                        </div>
                        <Button
                            variant="primary"
                            className="h-[42px]"
                            onClick={handleRecordPrice}
                            disabled={isSubmittingPrice}
                        >
                            {isSubmittingPrice ? "Saving..." : "Record Price"}
                        </Button>
                        <Button variant="ghost" className="h-[42px]" onClick={() => setPriceHolding(null)}>Cancel</Button>
                    </div>
                    <p className="text-xs text-base-500 dark:text-base-400">
                        {priceHolding.ticker} is priced manually. The recorded price applies from the chosen date forward until you record a newer one; valuations are recalculated immediately.
                    </p>
                </CardContent>
            </Card>
        )
    )
}

export function EditSubPortfolioPanel({
    isEditing, activeSubportfolioObj, editName, setEditName,
    editRisk, setEditRisk, editTarget, setEditTarget, handleUpdateSubPortfolio,
}: {
    isEditing: boolean
    activeSubportfolioObj: SubPortfolioResponse | undefined
    editName: string
    setEditName: (v: string) => void
    editRisk: string
    setEditRisk: (v: string) => void
    editTarget: string
    setEditTarget: (v: string) => void
    handleUpdateSubPortfolio: () => void
}) {
    return (
        isEditing && activeSubportfolioObj && (
            <Card className="bg-primary-50/30 border-primary-200 border-dashed">
                <CardContent className="pt-6 flex items-end gap-4">
                    <div className="flex-1 space-y-2">
                        <Input
                            label="Name"
                            value={editName}
                            onChange={e => setEditName(e.target.value)}
                        />
                    </div>
                    <div className="flex-1 space-y-2">
                        <label className="text-sm font-medium text-base-900 dark:text-base-50">Risk Profile</label>
                        <Select
                            className="h-[42px]"
                            value={editRisk}
                            onChange={setEditRisk}
                            options={[
                                { value: "Conservative", label: "Conservative" },
                                { value: "Moderate", label: "Moderate" },
                                { value: "Aggressive", label: "Aggressive" },
                            ]}
                        />
                    </div>
                    <div className="flex-1 space-y-2">
                        <Input
                            label="Target Amount"
                            type="number"
                            value={editTarget}
                            onChange={e => setEditTarget(e.target.value)}
                        />
                    </div>
                    <Button variant="primary" className="h-[42px]" onClick={handleUpdateSubPortfolio}>Save Changes</Button>
                </CardContent>
            </Card>
        )
    )
}
