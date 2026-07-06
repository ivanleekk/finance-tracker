import { useState, useEffect, useMemo } from "react"
import { useLoaderData, useSearchParams } from "react-router"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../components/ui/Card"
import { Input } from "../../components/ui/Input"
import { Button } from "../../components/ui/Button"
import { useHousehold } from "../../lib/HouseholdContext"
import api from "../../lib/api"
import type { AccountResponse, SubPortfolioResponse, AssetResponse, CurrencyResponse } from "../../types/types"
import { tradeFormLoader, type TradeLoaderData } from "./trade.loader"

export { tradeFormLoader as loader } from "./trade.loader";

export default function Trade() {
    const { activeHousehold, refreshHouseholds } = useHousehold();
    const loaderData = (useLoaderData() as TradeLoaderData) || { accounts: [], subportfolios: [], currencies: [] };

    const [accounts] = useState<AccountResponse[]>(loaderData.accounts || []);
    const [subportfolios] = useState<SubPortfolioResponse[]>(loaderData.subportfolios || []);
    const [searchParams] = useSearchParams();
    const [isSaveDefault, setIsSaveDefault] = useState(false);
    const [message, setMessage] = useState<{ text: string; type: "error" | "success" } | null>(null);

    const [selectedAccountId, setSelectedAccountId] = useState(() => {
        const paramId = searchParams.get("account_id");
        if (paramId && accounts.some(a => a.id === paramId)) return paramId;
        if (activeHousehold?.default_funding_account_id && accounts.some(a => a.id === activeHousehold.default_funding_account_id)) {
            return activeHousehold.default_funding_account_id;
        }
        return accounts.length > 0 ? accounts[0].id : "";
    });

    const [selectedSubportfolioId, setSelectedSubportfolioId] = useState(() => {
        const paramId = searchParams.get("sub_portfolio_id");
        if (paramId && subportfolios.some(sp => sp.id === paramId)) return paramId;
        if (activeHousehold?.default_sub_portfolio_id && subportfolios.some(sp => sp.id === activeHousehold.default_sub_portfolio_id)) {
            return activeHousehold.default_sub_portfolio_id;
        }
        return subportfolios.length > 0 ? subportfolios[0].id : "";
    });

    const [ticker, setTicker] = useState(searchParams.get("ticker")?.toUpperCase() || "")

    const [quantity, setQuantity] = useState("")
    const [date, setDate] = useState(new Date().toISOString().split('T')[0])
    const [price, setPrice] = useState("")
    const [currency, setCurrency] = useState(activeHousehold?.base_currency || "USD")
    const [exchangeRate, setExchangeRate] = useState("1.0")
    const [description, setDescription] = useState("")
    const [isFetchingPrice, setIsFetchingPrice] = useState(false)
    const [isSubmitting, setIsSubmitting] = useState(false)



    // Auto-prefill the price when ticker or date changes using real yfinance data from backend
    useEffect(() => {
        if (ticker.trim().length >= 1 && date) {
            const fetchPrice = async () => {
                setIsFetchingPrice(true);
                try {
                    const response = await api.get(`/portfolio/price?ticker=${ticker}&date=${date}`);
                    setPrice(response.data.price.toFixed(2));
                    if (response.data.currency) {
                        setCurrency(response.data.currency);
                    }
                } catch (err) {
                    console.error("Failed to fetch price:", err);
                    // We don't necessarily clear the price on error, allowing for manual entry
                } finally {
                    setIsFetchingPrice(false);
                }
            };

            const timer = setTimeout(fetchPrice, 600); // Debounce to avoid excessive API calls
            return () => clearTimeout(timer);
        } else {
            setPrice("");
        }
    }, [ticker, date]);

    // Auto-prefill the exchange rate when currency, account, or date changes
    useEffect(() => {
        if (!selectedAccountId || !currency || !date) return;

        const account = accounts.find(a => a.id === selectedAccountId);
        if (!account) return;

        const accountCurrency = account.currency || "USD";

        if (currency === accountCurrency) {
            setExchangeRate("1.0");
            return;
        }

        const fetchRate = async () => {
            try {
                const response = await api.get(`/reference/exchange_rate?base=${currency}&target=${accountCurrency}&date=${date}`);
                setExchangeRate(response.data.rate.toString());
            } catch (err) {
                console.error("Failed to fetch exchange rate:", err);
            }
        };

        fetchRate();
    }, [selectedAccountId, currency, date, accounts]);

    const estimatedTotal = useMemo(() => {
        const q = parseFloat(quantity) || 0;
        const p = parseFloat(price) || 0;
        return q * p;
    }, [quantity, price]);

    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: activeHousehold?.base_currency || 'USD'
        }).format(value)
    }

    const handleTrade = async (type: "Buy" | "Sell") => {
        if (!activeHousehold) return;
        setMessage(null);

        if (accounts.length === 0 || subportfolios.length === 0) {
            setMessage({
                text: "You need at least one account and one sub-portfolio to execute a trade. Please create them in the Accounts and Portfolio sections first.",
                type: "error"
            });
            return;
        }

        if (!ticker || !quantity || !price || !date || !selectedAccountId || !selectedSubportfolioId) {
            setMessage({ text: "Please fill all required fields before submitting.", type: "error" });
            return;
        }

        setIsSubmitting(true);
        try {
            // 1. Resolve Asset by Ticker
            let assetId = "";
            const assetsRes = await api.get<AssetResponse[]>(`/portfolio/assets?ticker=${ticker.toUpperCase()}`);
            const existingAsset = assetsRes.data.find(a => a.ticker.toUpperCase() === ticker.toUpperCase());

            if (existingAsset) {
                assetId = existingAsset.id;
            } else {
                // Create a new asset
                const newAssetRes = await api.post<AssetResponse>('/portfolio/assets', {
                    id: crypto.randomUUID(),
                    ticker: ticker.toUpperCase(),
                    name: `${ticker.toUpperCase()} Equity`,
                    type: "Stock",
                    currency: currency // Use the detected currency instead of household default
                });
                assetId = newAssetRes.data.id;
            }

            // 2. Submit Trade
            const tradeDate = new Date(date);

            await api.post('/portfolio/trades', {
                type: type.toLowerCase(),
                date: tradeDate.toISOString(),
                quantity: parseFloat(quantity),
                price: parseFloat(price),
                currency: currency,
                exchange_rate: parseFloat(exchangeRate),
                household_id: activeHousehold.id,
                sub_portfolio_id: selectedSubportfolioId,
                asset_id: assetId,
                account_id: selectedAccountId,
                description: description || null
            });


            // 3. Update Household Defaults if requested
            if (isSaveDefault && activeHousehold) {
                await api.put(`/users/households/${activeHousehold.id}`, {
                    default_funding_account_id: selectedAccountId,
                    default_sub_portfolio_id: selectedSubportfolioId
                });
                await refreshHouseholds();
            }


            setMessage({ text: `Successfully executed ${type} order for ${ticker.toUpperCase()}!`, type: "success" });

            // Reset form after submission
            setTicker("");
            setQuantity("");
            setPrice("");
            setDescription("");

            // Keep date, subportfolio and account as is for rapid entry of multiple trades
        } catch (err: any) {
            console.error("Trade execution failed:", err);
            setMessage({ text: err.response?.data?.detail || "Failed to execute trade.", type: "error" });
        } finally {
            setIsSubmitting(false);
        }
    }

    if (!activeHousehold) {
        return (
            <div className="flex-1 flex items-center justify-center p-8 text-base-500">
                Please select or create a household.
            </div>
        )
    }

    return (
        <div className="flex-1 space-y-6 p-8 flex justify-center items-start">
            <div className="w-full max-w-md mt-10">
                <Card>
                    <CardHeader>
                        <CardTitle>Trade Execution</CardTitle>
                        <CardDescription>Place a historical limit order for {activeHousehold.name}.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {message && (
                            <div className={`p-3 rounded text-sm ${message.type === 'error' ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400' : 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'}`}>
                                {message.text}
                            </div>
                        )}
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-base-900 dark:text-base-50">Funding Account</label>
                            <select
                                className="w-full rounded-md border border-base-200 dark:border-base-800 bg-white dark:bg-base-900 px-3 py-2 text-sm text-base-900 dark:text-base-50 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                                value={selectedAccountId}
                                onChange={(e) => setSelectedAccountId(e.target.value)}
                                required
                            >
                                {accounts.map(acc => (
                                    <option key={acc.id} value={acc.id}>{acc.name} ({acc.currency})</option>
                                ))}
                                {accounts.length === 0 && <option value="">No accounts available</option>}
                            </select>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-base-900 dark:text-base-50">Sub-Portfolio</label>
                            <select
                                className="w-full rounded-md border border-base-200 dark:border-base-800 bg-white dark:bg-base-900 px-3 py-2 text-sm text-base-900 dark:text-base-50 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                                value={selectedSubportfolioId}
                                onChange={(e) => setSelectedSubportfolioId(e.target.value)}
                                required
                            >
                                {subportfolios.map(sp => (
                                    <option key={sp.id} value={sp.id}>{sp.name}</option>
                                ))}
                                {subportfolios.length === 0 && <option value="">No sub-portfolios available</option>}
                            </select>
                        </div>

                        <Input
                            label="Ticker Symbol"
                            placeholder="e.g. AAPL"
                            className="uppercase"
                            value={ticker}
                            onChange={(e) => setTicker(e.target.value.toUpperCase())}
                        />

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-base-900 dark:text-base-50">Currency</label>
                                <select
                                    className="w-full rounded-md border border-base-200 dark:border-base-800 bg-white dark:bg-base-900 px-3 py-2 text-sm text-base-900 dark:text-base-50 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                                    value={currency}
                                    onChange={(e) => setCurrency(e.target.value)}
                                >
                                    {loaderData.currencies.map(c => (
                                        <option key={c.code} value={c.code}>{c.code} - {c.name}</option>
                                    ))}
                                </select>
                            </div>
                            <Input
                                label="Exchange Rate"
                                type="number"
                                step="0.0001"
                                value={exchangeRate}
                                onChange={(e) => setExchangeRate(e.target.value)}
                                placeholder="Rate to Account"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <Input
                                label="Share Quantity"
                                type="number"
                                step="0.0001"
                                placeholder="0.00"
                                value={quantity}
                                onChange={(e) => setQuantity(e.target.value)}
                            />
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-base-900 dark:text-base-50 flex items-center justify-between">
                                    Price
                                    {isFetchingPrice && <div className="h-3 w-3 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />}
                                </label>
                                <Input
                                    type="number"
                                    step="0.01"
                                    placeholder="0.00"
                                    value={price}
                                    onChange={(e) => setPrice(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <Input
                                label="Order Type"
                                value="Limit"
                                disabled
                                helperText="Only Limit orders supported"
                            />
                            <Input
                                label="Execution Date"
                                type="date"
                                value={date}
                                onChange={(e) => setDate(e.target.value)}
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-base-900 dark:text-base-50">Description (Optional)</label>
                            <Input
                                placeholder="e.g. Portfolio rebalancing"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                            />
                        </div>

                        <div className="flex items-center space-x-2 py-2">
                            <input
                                type="checkbox"
                                id="saveDefault"
                                className="h-4 w-4 rounded border-base-300 text-primary-600 focus:ring-primary-500"
                                checked={isSaveDefault}
                                onChange={(e) => setIsSaveDefault(e.target.checked)}
                            />
                            <label htmlFor="saveDefault" className="text-sm text-base-600 dark:text-base-400">
                                Save these selections as default for this household
                            </label>
                        </div>

                        <div className="pt-4 flex gap-3">

                            <Button
                                className="w-full"
                                variant="primary"
                                onClick={() => handleTrade("Buy")}
                                disabled={isSubmitting}
                            >
                                Buy
                            </Button>
                            <Button
                                className="w-full"
                                variant="danger"
                                onClick={() => handleTrade("Sell")}
                                disabled={isSubmitting}
                            >
                                Sell
                            </Button>
                        </div>

                        <div className="pt-4 text-center">
                            <p className="text-sm text-base-500 dark:text-base-400">
                                Estimated Total: <span className="font-semibold text-base-900 dark:text-base-50">{formatCurrency(estimatedTotal)}</span>
                            </p>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
