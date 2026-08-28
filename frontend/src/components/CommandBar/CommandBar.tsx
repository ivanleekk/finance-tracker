import { useEffect, useRef, useState, useCallback, useMemo} from "react";
import { useNavigate, useRevalidator } from "react-router";
import { useCommandBar } from "../../lib/CommandBarContext";
import { useHousehold } from "../../lib/HouseholdContext";
import { useAuth } from "../../lib/AuthContext";
import { useViewMode } from "../../lib/ViewModeContext";
import api from "../../lib/api";
import {
    parseCommand,
    FALLBACK_ASSETS,
    serializeDividend,
    serializeBalance,
    type ParsedCommand,
} from "../../lib/commandParser";
import { SCAN_RESULT, type ScanResult } from "./receiptScan";
import { fmt, fmtA, type Phase } from "./commandBarHelpers";
import {
    BalanceView,
    DividendView,
    ExpenseView,
    RestingView,
    ScanView,
    SearchView,
    SuccessView,
    TradeView,
    TransferView,
} from "./CommandBarViews";
import type { AccountResponse, SubPortfolioResponse, TransactionResponse, CategoryResponse, AssetResponse, CardResponse, CardStatusResponse, CardLimitStatusRow } from "../../types/types";
import { headroomByCategory, headroomLabel } from "../../lib/cards";


export function CommandBar() {
    const { isOpen, close } = useCommandBar();
    const { activeHousehold } = useHousehold();
    const { user } = useAuth();
    const { hasHousehold } = useViewMode();
    const revalidator = useRevalidator();
    const navigate = useNavigate();

    const [query, setQuery] = useState("");
    const [phase, setPhase] = useState<Phase>("resting");
    const [scanPct, setScanPct] = useState(0);
    const [scanResult, setScanResult] = useState<ScanResult | null>(null);
    const [ownership, setOwnership] = useState<"private" | "household">("household");
    const [selectedSubPortfolioId, setSelectedSubPortfolioId] = useState<string | null>(null);
    const [categoryOverride, setCategoryOverride] = useState<{ name: string; icon: string } | null>(null);
    const [expenseAccountId, setExpenseAccountId] = useState<string | null>(null);
    // The card behind the chosen account, if it is one. Fetched on demand — most
    // accounts are not cards, and the command bar is meant to be fast.
    const [cardCategoryId, setCardCategoryId] = useState("");
    const [cardData, setCardData] = useState<{ card: CardResponse; headroom: Map<string, CardLimitStatusRow> } | null>(null);
    const [successInfo, setSuccessInfo] = useState<{ big: string; sub: string } | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [undoData, setUndoData] = useState<{ path: string } | null>(null);

    const [accounts, setAccounts] = useState<AccountResponse[]>([]);
    const [subportfolios, setSubportfolios] = useState<SubPortfolioResponse[]>([]);
    const [categories, setCategories] = useState<CategoryResponse[]>([]);
    const [recent, setRecent] = useState<TransactionResponse[]>([]);
    const [assetSuggestions, setAssetSuggestions] = useState<AssetResponse[]>([]);
    const [livePrice, setLivePrice] = useState<{ ticker: string; price: number; currency: string } | null>(null);
    const [priceLoading, setPriceLoading] = useState(false);
    const [highlightIndex, setHighlightIndex] = useState(0);

    const inputRef = useRef<HTMLInputElement>(null);
    const scanTimer = useRef<ReturnType<typeof setInterval> | null>(null);
    const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Reset + load context data whenever the bar opens.
    useEffect(() => {
        if (!isOpen) return;
        setQuery("");
        setPhase("resting");
        setScanResult(null);
        setOwnership("household");
        setSelectedSubPortfolioId(null);
        setCategoryOverride(null);
        setExpenseAccountId(null);
        setSuccessInfo(null);
        setAssetSuggestions([]);
        setLivePrice(null);
        setHighlightIndex(0);
        requestAnimationFrame(() => inputRef.current?.focus());

        if (activeHousehold) {
            api.get(`/accounts/household/${activeHousehold.id}`).then(r => setAccounts(r.data)).catch(() => setAccounts([]));
            api.get(`/portfolio/subportfolios/household/${activeHousehold.id}`).then(r => setSubportfolios(r.data)).catch(() => setSubportfolios([]));
            api.get(`/cashflow/categories/household/${activeHousehold.id}`).then(r => setCategories(r.data)).catch(() => setCategories([]));
            api.get(`/cashflow/transactions/household/${activeHousehold.id}`).then(r => {
                const sorted = [...r.data].sort((a: TransactionResponse, b: TransactionResponse) => (a.date < b.date ? 1 : -1));
                setRecent(sorted.slice(0, 3));
            }).catch(() => setRecent([]));
        }
    }, [isOpen, activeHousehold?.id]);

    useEffect(() => () => {
        if (scanTimer.current) clearInterval(scanTimer.current);
        if (successTimer.current) clearTimeout(successTimer.current);
    }, []);

    const handleClose = useCallback(() => {
        if (scanTimer.current) clearInterval(scanTimer.current);
        if (successTimer.current) clearTimeout(successTimer.current);
        close();
    }, [close]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (!isOpen) return;
            if (e.key === "Escape") handleClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [isOpen, handleClose]);

    const parsed: ParsedCommand = scanResult ? { type: "expense", amount: scanResult.amount, merchant: scanResult.merchant, category: scanResult.category, account: accounts[0] || null } : parseCommand(query, accounts);
    const activeTicker = parsed.type === "trade" || parsed.type === "dividend" ? parsed.ticker : null;

    // Ticker autosuggest + live pricing: mirrors the Trade page's own lookups so the command
    // bar isn't limited to the small hardcoded FALLBACK_ASSETS demo table. Asset search hits
    // the cheap local DB (ILIKE) on every keystroke change; the live yfinance-backed price
    // lookup is debounced longer since it's a slow external call.
    useEffect(() => {
        if (!isOpen || !activeTicker) {
            setAssetSuggestions([]);
            setLivePrice(null);
            setPriceLoading(false);
            return;
        }
        let cancelled = false;
        const searchTimer = setTimeout(() => {
            api.get(`/portfolio/assets?ticker=${activeTicker}`)
                .then(r => { if (!cancelled) setAssetSuggestions(r.data); })
                .catch(() => { if (!cancelled) setAssetSuggestions([]); });
        }, 150);

        let priceTimer: ReturnType<typeof setTimeout> | null = null;
        if (parsed.type === "trade") {
            setPriceLoading(true);
            priceTimer = setTimeout(() => {
                const today = new Date().toISOString().split("T")[0];
                api.get(`/portfolio/price?ticker=${activeTicker}&date=${today}`)
                    .then(r => { if (!cancelled) setLivePrice({ ticker: activeTicker, price: r.data.price, currency: r.data.currency }); })
                    .catch(() => { if (!cancelled) setLivePrice(null); })
                    .finally(() => { if (!cancelled) setPriceLoading(false); });
            }, 600);
        }

        return () => {
            cancelled = true;
            clearTimeout(searchTimer);
            if (priceTimer) clearTimeout(priceTimer);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, activeTicker, parsed.type]);

    const routedAccount = (fallback: AccountResponse | null): AccountResponse | null => {
        const userDefault = accounts.find(a => a.id === user?.default_account_id) || null;
        if (!hasHousehold) return fallback || userDefault;
        if (ownership === "private") {
            return accounts.find(a => a.owner_user_id === user?.id) || fallback || userDefault;
        }
        return accounts.find(a => !a.owner_user_id) || fallback || userDefault;
    };

    // The account the expense will actually be charged to.
    const chosenAccountId = expenseAccountId
        ?? (parsed.type === "expense" ? routedAccount(parsed.account)?.id : undefined)
        ?? null;

    useEffect(() => {
        let cancelled = false;
        setCardCategoryId("");
        if (!activeHousehold || !chosenAccountId) { setCardData(null); return; }
        (async () => {
            try {
                const { data: cards } = await api.get<CardResponse[]>(`/cards/household/${activeHousehold.id}`);
                const card = cards.find(c => c.financial_account_id === chosenAccountId);
                if (!card) { if (!cancelled) setCardData(null); return; }
                const { data: status } = await api.get<CardStatusResponse>(`/cards/${card.id}/status`);
                if (!cancelled) setCardData({ card, headroom: headroomByCategory(card, status) });
            } catch {
                // A missing meter makes the picker plainer, never the bar unusable.
                if (!cancelled) setCardData(null);
            }
        })();
        return () => { cancelled = true; };
    }, [activeHousehold, chosenAccountId]);

    const cardCategoryOptions = useMemo(() => {
        if (!cardData) return [];
        const money = (v: number) => new Intl.NumberFormat(undefined, {
            style: "currency", currency: cardData.card.currency || activeHousehold?.base_currency || "USD",
            maximumFractionDigits: 0,
        }).format(v);
        return [
            { value: "", label: "— Card's default —" },
            ...cardData.card.categories.map(c => {
                const row = cardData.headroom.get(c.id);
                return { value: c.id, label: row ? `${c.name} · ${headroomLabel(row, money)}` : c.name };
            }),
        ];
    }, [cardData, activeHousehold]);

    if (!isOpen) return null;

    // Merges DB-known assets (same source the Trade page's submit resolves against) with the
    // curated FALLBACK_ASSETS demo table so suggestions aren't limited to either alone.
    const tradeResolution = parsed.type === "trade" ? (() => {
        const prefix = parsed.ticker;
        const fallback = FALLBACK_ASSETS[prefix];
        const live = livePrice && livePrice.ticker === prefix ? livePrice : null;
        const known = assetSuggestions.find(a => a.ticker.toUpperCase() === prefix);
        const dbMatches = assetSuggestions.filter(a => a.ticker.toUpperCase() !== prefix);
        const fallbackMatches = Object.entries(FALLBACK_ASSETS)
            .filter(([t]) => t !== prefix && t.includes(prefix) && !dbMatches.some(a => a.ticker.toUpperCase() === t))
            .map(([ticker, info]) => ({ id: ticker, ticker, name: info.name, type: "equity", currency: info.currency }));
        const suggestions = [...dbMatches, ...fallbackMatches].slice(0, 5);
        const price = parsed.explicitPrice ?? live?.price ?? fallback?.price;
        const name = known?.name || fallback?.name;
        const isReady = parsed.explicitPrice != null || live != null || fallback != null || known != null;
        return { fallback, live, known, suggestions, price, name, isReady };
    })() : null;

    // Dividend ticker search reuses the same DB lookup as the trade flow (the effect above
    // already runs for both types). A dividend is almost always logged against an asset you
    // already hold, so an exact match is "ready"; an unrecognized ticker with zero matches is
    // also "ready" — submit will create the asset, mirroring the trade flow.
    const dividendResolution = parsed.type === "dividend" ? (() => {
        const prefix = parsed.ticker;
        const fallback = FALLBACK_ASSETS[prefix];
        const known = assetSuggestions.find(a => a.ticker.toUpperCase() === prefix);
        const dbMatches = assetSuggestions.filter(a => a.ticker.toUpperCase() !== prefix);
        const fallbackMatches = Object.entries(FALLBACK_ASSETS)
            .filter(([t]) => t !== prefix && t.includes(prefix) && !dbMatches.some(a => a.ticker.toUpperCase() === t))
            .map(([ticker, info]) => ({ id: ticker, ticker, name: info.name, type: "equity", currency: info.currency }));
        const suggestions = [...dbMatches, ...fallbackMatches].slice(0, 5);
        const name = known?.name || fallback?.name;
        const isReady = known != null || fallback != null || (!!prefix && suggestions.length === 0);
        return { known, suggestions, name, isReady };
    })() : null;

    const selectTicker = (ticker: string) => {
        if (parsed.type === "trade") {
            const priceSuffix = parsed.explicitPrice != null ? ` ${parsed.explicitPrice}` : "";
            setQuery(`${parsed.side} ${parsed.qty} ${ticker}${priceSuffix}`);
        } else if (parsed.type === "dividend") {
            setQuery(serializeDividend(ticker, parsed.amount));
        } else {
            return;
        }
        setHighlightIndex(0);
    };

    // Balance's account search is pure client-side substring matching over the already-loaded
    // `accounts` list (no API needed, unlike ticker search). An exact name match is "ready" to
    // submit immediately (preserves the old bare-keyword UX); a non-empty query with zero
    // substring matches is also "ready" - it'll create a new account on submit, mirroring how
    // the trade flow creates a new asset for an unrecognized ticker.
    const balanceResolution = parsed.type === "balance" ? (() => {
        const q = parsed.query.trim();
        const ql = q.toLowerCase();
        const known = q ? accounts.find(a => a.name.toLowerCase() === ql) : undefined;
        const suggestions = accounts
            .filter(a => a.id !== known?.id)
            .filter(a => !q || a.name.toLowerCase().includes(ql))
            .slice(0, 6);
        const isReady = !!known || (!!q && suggestions.length === 0);
        return { known, suggestions, isReady, query: q };
    })() : null;

    const selectAccountForBalance = (name: string) => {
        if (parsed.type !== "balance") return;
        setQuery(serializeBalance(name, parsed.newBalance));
        setHighlightIndex(0);
    };

    const runScan = () => {
        setScanResult(null);
        setPhase("scanning");
        setQuery("");
        setScanPct(0);
        let p = 0;
        scanTimer.current = setInterval(() => {
            p += 7;
            if (p >= 100) {
                if (scanTimer.current) clearInterval(scanTimer.current);
                setScanPct(100);
                setScanResult(SCAN_RESULT);
                setPhase("typing");
            } else {
                setScanPct(p);
            }
        }, 110);
    };

    const runDemo = (command: string) => {
        setScanResult(null);
        setQuery("");
        setPhase("typing");
        setHighlightIndex(0);
        let i = 0;
        const timer = setInterval(() => {
            i++;
            setQuery(command.slice(0, i));
            if (i >= command.length) clearInterval(timer);
        }, 42);
    };

    const resolveCategoryId = async (name: string, type: "income" | "expense"): Promise<string | null> => {
        if (!activeHousehold) return null;
        const existing = categories.find(c => c.name.toLowerCase() === name.toLowerCase());
        if (existing) return existing.id;
        try {
            const res = await api.post("/cashflow/categories", { household_id: activeHousehold.id, name, type });
            setCategories(prev => [...prev, res.data]);
            return res.data.id;
        } catch {
            return null;
        }
    };

    /** When ownership routing is shown, resolve which real account to charge: the user's own
     * private account if "private" is chosen, otherwise a shared (owner_user_id null) account.
     * Falls back to whatever the parser matched if no account of the right kind exists. */
    const finishSuccess = (big: string, sub: string, undo: { path: string } | null) => {
        setSuccessInfo({ big, sub });
        setUndoData(undo);
        setPhase("success");
        revalidator.revalidate();
        successTimer.current = setTimeout(() => {
            handleClose();
        }, 1800);
    };

    const handleUndo = async () => {
        if (undoData) {
            try { await api.delete(undoData.path); } catch { /* best effort */ }
            revalidator.revalidate();
        }
        handleClose();
    };

    const submit = async () => {
        if (!activeHousehold || submitting) return;
        if (parsed.type === "empty" || parsed.type === "search") return;
        setSubmitting(true);
        try {
            if (parsed.type === "expense") {
                const account = expenseAccountId ? accounts.find(a => a.id === expenseAccountId) || null : routedAccount(parsed.account);
                if (!account) return;
                const category = categoryOverride || parsed.category;
                const categoryId = await resolveCategoryId(category.name, "expense");
                if (!categoryId) return;
                const res = await api.post("/cashflow/transactions", {
                    account_id: account.id,
                    category_id: categoryId,
                    date: new Date().toISOString(),
                    amount: parsed.amount,
                    transaction_type: "expense",
                    description: parsed.merchant,
                    // Omitted when blank: the API reads a missing key as "use the
                    // card's default", which is what blank means here.
                    ...(cardCategoryId ? { card_category_id: cardCategoryId } : {}),
                });
                finishSuccess(`−$${fmtA(parsed.amount)}`, `${category.name} · ${account.name}${!expenseAccountId && hasHousehold ? (ownership === "private" ? " · Private" : " · Household") : ""}`, { path: `/cashflow/transactions/${res.data.id}` });
            } else if (parsed.type === "balance") {
                const query = parsed.query.trim();
                if (!query) return;
                let account = accounts.find(a => a.name.toLowerCase() === query.toLowerCase());
                if (!account) {
                    const created = await api.post<AccountResponse>("/accounts", {
                        household_id: activeHousehold.id,
                        name: query,
                        liquidity: "liquid",
                        tax_status: "taxable",
                        currency: activeHousehold.base_currency || "USD",
                        owner_user_id: null,
                    });
                    account = created.data;
                    setAccounts(prev => [...prev, account!]);
                }
                const res = await api.post("/accounts/balances", {
                    account_id: account.id,
                    date: new Date().toISOString().split("T")[0],
                    balance: parsed.newBalance,
                });
                finishSuccess(`$${fmt(parsed.newBalance)}`, `${account.name} balance set`, { path: `/accounts/balances/${res.data.id}` });
            } else if (parsed.type === "trade") {
                const defaultSubPortfolio = subportfolios.find(sp => sp.id === activeHousehold.default_sub_portfolio_id) || subportfolios[0];
                const chosenSubPortfolio = subportfolios.find(sp => sp.id === selectedSubPortfolioId) || defaultSubPortfolio;
                const fundingAccount = accounts.find(a => a.id === activeHousehold.default_funding_account_id) || accounts[0];
                if (!chosenSubPortfolio || !fundingAccount) return;
                const existingAssets = await api.get<AssetResponse[]>(`/portfolio/assets?ticker=${parsed.ticker}`);
                let asset = existingAssets.data.find(a => a.ticker.toUpperCase() === parsed.ticker);
                if (!asset) {
                    // Name containing "Equity" triggers the backend's yfinance enrichment (real
                    // name + currency) on creation - same convention the Trade page uses.
                    const created = await api.post("/portfolio/assets", {
                        id: crypto.randomUUID(),
                        ticker: parsed.ticker,
                        name: `${parsed.ticker} Equity`,
                        type: "equity",
                        currency: "USD",
                    });
                    asset = created.data;
                }
                let price = parsed.explicitPrice ?? (livePrice?.ticker === parsed.ticker ? livePrice.price : undefined);
                if (price === undefined) {
                    try {
                        const today = new Date().toISOString().split("T")[0];
                        const priceRes = await api.get(`/portfolio/price?ticker=${parsed.ticker}&date=${today}`);
                        price = priceRes.data.price;
                    } catch {
                        price = FALLBACK_ASSETS[parsed.ticker]?.price ?? 100;
                    }
                }
                const tradeRes = await api.post("/portfolio/trades", {
                    household_id: activeHousehold.id,
                    sub_portfolio_id: chosenSubPortfolio.id,
                    asset_id: asset.id,
                    account_id: fundingAccount.id,
                    type: parsed.side,
                    date: new Date().toISOString(),
                    quantity: parsed.qty,
                    price,
                    currency: (livePrice?.ticker === parsed.ticker ? livePrice.currency : null) || asset.currency,
                    exchange_rate: 1,
                });
                finishSuccess(`${parsed.side === "buy" ? "Bought" : "Sold"} ${parsed.qty} ${parsed.ticker}`, `@ $${fmtA(price)} · ${chosenSubPortfolio.name}`, { path: `/portfolio/trades/${tradeRes.data.id}` });
            } else if (parsed.type === "dividend") {
                const defaultSubPortfolio = subportfolios.find(sp => sp.id === activeHousehold.default_sub_portfolio_id) || subportfolios[0];
                const fundingAccount = accounts.find(a => a.id === activeHousehold.default_funding_account_id) || accounts[0];
                if (!defaultSubPortfolio || !fundingAccount) return;
                const assetRes = await api.get<AssetResponse[]>(`/portfolio/assets?ticker=${parsed.ticker}`);
                let asset = assetRes.data.find(a => a.ticker.toUpperCase() === parsed.ticker);
                if (!asset) {
                    const created = await api.post("/portfolio/assets", {
                        id: crypto.randomUUID(), ticker: parsed.ticker, name: `${parsed.ticker} Equity`, type: "equity", currency: "USD",
                    });
                    asset = created.data;
                }
                const divRes = await api.post("/portfolio/dividends", {
                    household_id: activeHousehold.id,
                    sub_portfolio_id: defaultSubPortfolio.id,
                    asset_id: asset.id,
                    account_id: fundingAccount.id,
                    date: new Date().toISOString(),
                    amount: parsed.amount,
                    exchange_rate: 1,
                });
                finishSuccess(`+$${fmtA(parsed.amount)}`, `Dividend · ${parsed.ticker}`, { path: `/portfolio/dividends/${divRes.data.id}` });
            } else if (parsed.type === "transfer") {
                const from = parsed.fromCandidates[0];
                const to = parsed.toCandidates[0];
                if (!from || !to) return;
                await api.post("/cashflow/transfers", {
                    from_account_id: from.id,
                    to_account_id: to.id,
                    amount: parsed.amount,
                    date: new Date().toISOString(),
                    description: "Transfer via ⌘K",
                });
                // Transfers post two linked transaction legs; undo here just dismisses rather than
                // reversing both legs (the Transactions page can delete either leg, which cascades).
                finishSuccess(`$${fmt(parsed.amount)} moved`, `${from.name} → ${to.name}`, null);
            }
        } catch (err) {
            console.error("Command bar submit failed", err);
        } finally {
            setSubmitting(false);
        }
    };

    // Suggestions currently on screen for arrow-key navigation - only one of trade/balance/
    // dividend can be active at a time (parsed.type is a discriminated union), so this is unambiguous.
    const activeSuggestionCount = tradeResolution && !tradeResolution.isReady ? tradeResolution.suggestions.length
        : balanceResolution && !balanceResolution.isReady ? balanceResolution.suggestions.length
        : dividendResolution && !dividendResolution.isReady ? dividendResolution.suggestions.length
        : 0;

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (activeSuggestionCount > 0 && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            const max = activeSuggestionCount - 1;
            setHighlightIndex(i => {
                if (e.key === "ArrowDown") return i >= max ? 0 : i + 1;
                return i <= 0 ? max : i - 1;
            });
            return;
        }
        if (e.key === "Enter") {
            e.preventDefault();
            if (tradeResolution && !tradeResolution.isReady && tradeResolution.suggestions[highlightIndex]) {
                selectTicker(tradeResolution.suggestions[highlightIndex].ticker);
                return;
            }
            if (balanceResolution && !balanceResolution.isReady && balanceResolution.suggestions[highlightIndex]) {
                selectAccountForBalance(balanceResolution.suggestions[highlightIndex].name);
                return;
            }
            if (dividendResolution && !dividendResolution.isReady && dividendResolution.suggestions[highlightIndex]) {
                selectTicker(dividendResolution.suggestions[highlightIndex].ticker);
                return;
            }
            submit();
        }
    };

    const goToSearchResult = (path: string) => {
        handleClose();
        navigate(path);
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[14vh] bg-base-950/60 backdrop-blur-sm" onClick={handleClose}>
            <div
                className="w-full max-w-[480px] mx-4 bg-white dark:bg-base-900 border border-base-200 dark:border-base-800 rounded-2xl shadow-2xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-base-100 dark:border-base-800">
                    <span className="text-secondary-500 font-mono text-sm">{parsed.type === "search" ? "🔍" : "⌘"}</span>
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={(e) => { setQuery(e.target.value); setScanResult(null); setPhase(e.target.value ? "typing" : "resting"); setHighlightIndex(0); }}
                        onKeyDown={onKeyDown}
                        placeholder="Log or find anything…"
                        disabled={phase === "scanning"}
                        className="flex-1 bg-transparent outline-none text-sm text-base-900 dark:text-base-50 placeholder:text-base-400"
                    />
                    <button
                        onClick={runScan}
                        className="flex items-center gap-1.5 bg-base-100 dark:bg-base-800 border border-base-200 dark:border-base-700 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-base-600 dark:text-base-300 hover:border-secondary-400 transition-colors"
                    >
                        📷 Scan
                    </button>
                </div>

                {/* Body */}
                <div className="max-h-[420px] overflow-y-auto">
                    {phase === "scanning" && <ScanView pct={scanPct} />}

                    {phase !== "scanning" && phase === "success" && successInfo && (
                        <SuccessView
                            big={successInfo.big}
                            sub={successInfo.sub}
                            canUndo={!!undoData}
                            onUndo={handleUndo}
                            onAgain={() => { setPhase("resting"); setQuery(""); setSuccessInfo(null); requestAnimationFrame(() => inputRef.current?.focus()); }}
                        />
                    )}

                    {phase !== "scanning" && phase !== "success" && parsed.type === "empty" && (
                        <RestingView recent={recent} accounts={accounts} onDemo={runDemo} />
                    )}

                    {phase !== "scanning" && phase !== "success" && parsed.type === "expense" && (
                        <ExpenseView
                            parsed={parsed}
                            defaultAccount={routedAccount(parsed.account)}
                            scanned={scanResult}
                            hasHousehold={hasHousehold}
                            ownership={ownership}
                            setOwnership={(v) => { setOwnership(v); setExpenseAccountId(null); }}
                            accounts={accounts}
                            setQuery={setQuery}
                            categoryOverride={categoryOverride}
                            setCategoryOverride={setCategoryOverride}
                            cardCategoryOptions={cardCategoryOptions}
                            cardCategoryId={cardCategoryId}
                            setCardCategoryId={setCardCategoryId}
                            expenseAccountId={expenseAccountId}
                            setExpenseAccountId={setExpenseAccountId}
                        />
                    )}

                    {phase !== "scanning" && phase !== "success" && parsed.type === "trade" && tradeResolution && (
                        <TradeView
                            parsed={parsed}
                            query={query}
                            setQuery={setQuery}
                            resolution={tradeResolution}
                            priceLoading={priceLoading}
                            onSelectTicker={selectTicker}
                            subportfolios={subportfolios}
                            selectedSubPortfolioId={selectedSubPortfolioId || activeHousehold?.default_sub_portfolio_id || subportfolios[0]?.id || null}
                            onSelectSubPortfolio={setSelectedSubPortfolioId}
                            highlightIndex={highlightIndex}
                            onHoverSuggestion={setHighlightIndex}
                        />
                    )}

                    {phase !== "scanning" && phase !== "success" && parsed.type === "balance" && balanceResolution && (
                        <BalanceView
                            parsed={parsed}
                            resolution={balanceResolution}
                            setQuery={setQuery}
                            onSelectAccount={selectAccountForBalance}
                            highlightIndex={highlightIndex}
                            onHoverSuggestion={setHighlightIndex}
                        />
                    )}

                    {phase !== "scanning" && phase !== "success" && parsed.type === "dividend" && dividendResolution && (
                        <DividendView
                            parsed={parsed}
                            setQuery={setQuery}
                            resolution={dividendResolution}
                            onSelectTicker={selectTicker}
                            highlightIndex={highlightIndex}
                            onHoverSuggestion={setHighlightIndex}
                        />
                    )}

                    {phase !== "scanning" && phase !== "success" && parsed.type === "transfer" && (
                        <TransferView parsed={parsed} accounts={accounts} setQuery={setQuery} />
                    )}

                    {phase !== "scanning" && phase !== "success" && parsed.type === "search" && (
                        <SearchView term={parsed.term} subportfolios={subportfolios} recent={recent} onSelectGoal={(id) => goToSearchResult(`/goals/${id}`)} onSelectTxn={() => goToSearchResult("/transactions")} />
                    )}
                </div>

                {/* Footer */}
                {phase !== "scanning" && phase !== "success" && (
                    <div className="flex items-center justify-between px-4 py-2.5 border-t border-base-100 dark:border-base-800 text-[10px] text-base-400 dark:text-base-600">
                        <span>Rules of thumb: a verb ("buy", "div") forces a type · a bare "name + number" defaults to Expense · text with no number searches</span>
                        <span className="shrink-0 ml-2">esc to close</span>
                    </div>
                )}

                {phase !== "scanning" && phase !== "success" && parsed.type !== "empty" && parsed.type !== "search" && (
                    <div className="px-4 pb-4">
                        <button
                            onClick={submit}
                            disabled={submitting}
                            className="w-full rounded-lg bg-gradient-to-br from-secondary-500 to-secondary-700 text-white font-semibold text-sm py-2.5 disabled:opacity-50"
                        >
                            {submitting ? "Logging…" : parsed.type === "transfer" ? "↵ Move funds" : "↵ Log"}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
