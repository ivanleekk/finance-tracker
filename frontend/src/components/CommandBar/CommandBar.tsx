import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useRevalidator } from "react-router";
import { useCommandBar } from "../../lib/CommandBarContext";
import { useHousehold } from "../../lib/HouseholdContext";
import { useAuth } from "../../lib/AuthContext";
import { useViewMode } from "../../lib/ViewModeContext";
import api from "../../lib/api";
import {
    parseCommand,
    FALLBACK_ASSETS,
    CATEGORY_OPTIONS,
    accountKeyword,
    serializeTrade,
    serializeDividend,
    serializeBalance,
    serializeTransfer,
    serializeExpense,
    type ParsedCommand,
} from "../../lib/commandParser";
import { SCAN_RESULT, type ScanResult } from "./receiptScan";
import { Select } from "../ui/Select";
import type { AccountResponse, SubPortfolioResponse, TransactionResponse, CategoryResponse, AssetResponse } from "../../types/types";

type Phase = "resting" | "typing" | "scanning" | "success";

/** Demo commands for the resting screen's quick-action tiles and "Try it" chips. Balance and
 * transfer only parse correctly if the typed text contains a real account's keyword (see
 * matchAccounts in commandParser.ts) - a hardcoded placeholder bank name would silently fail to
 * match and fall through to the expense branch, so these are built from the household's actual
 * accounts whenever any exist. */
function getExampleChips(accounts: AccountResponse[]): { label: string; command: string }[] {
    const kw1 = accounts[0] ? accountKeyword(accounts[0]) : "Cash";
    const kw2 = accounts[1] ? accountKeyword(accounts[1]) : kw1;
    return [
        { label: "☕ Coffee", command: "coffee 5.20" },
        { label: "📈 Buy VOO", command: "buy 10 VOO" },
        { label: "🏦 Balance", command: accounts[0] ? `bal ${accounts[0].name} 51200` : "bal 51200" },
        { label: "💵 Dividend", command: "div AAPL 48" },
        { label: "⇄ Transfer", command: `transfer 500 from ${kw1} to ${kw2}` },
    ];
}

const USD_SGD = 1.34;

function fmt(n: number, dec = 0) {
    return Number(n).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtA(n: number) {
    const dec = Number.isInteger(Number(n)) ? 0 : 2;
    return Number(n).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: 2 });
}

/** Two-way form field: mirrors `upstream` (the value parsed from the command text) while the
 * field isn't focused, so typing in the main input updates the GUI form live. While the user
 * is actively editing the field, local edits are preserved instead of being clobbered by the
 * upstream value on every keystroke; the edit is only pushed back into the command text (via
 * `onCommit`, which re-serializes it into the query string) on blur. */
function useSyncedField<T>(upstream: T, onCommit: (v: T) => void) {
    const [value, setValue] = useState(upstream);
    const focused = useRef(false);
    useEffect(() => {
        if (!focused.current) setValue(upstream);
    }, [upstream]);
    return {
        value,
        setValue,
        onFocus: () => { focused.current = true; },
        onBlur: () => { focused.current = false; onCommit(value); },
    };
}

const fieldClass = "w-full bg-base-50 dark:bg-base-950 border border-base-200 dark:border-base-800 rounded-lg px-2.5 py-1.5 text-sm text-base-900 dark:text-base-50 outline-none focus:border-secondary-400";
const labelClass = "text-[10px] font-mono uppercase tracking-wider text-base-400 mb-1.5";

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

    const selectTicker = (ticker: string) => {
        if (parsed.type !== "trade") return;
        const priceSuffix = parsed.explicitPrice != null ? ` ${parsed.explicitPrice}` : "";
        setQuery(`${parsed.side} ${parsed.qty} ${ticker}${priceSuffix}`);
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
    const routedAccount = (fallback: AccountResponse | null): AccountResponse | null => {
        if (!hasHousehold) return fallback;
        if (ownership === "private") {
            return accounts.find(a => a.owner_user_id === user?.id) || fallback;
        }
        return accounts.find(a => !a.owner_user_id) || fallback;
    };

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

    // Suggestions currently on screen for arrow-key navigation - only one of trade/balance can
    // be active at a time (parsed.type is a discriminated union), so this is unambiguous.
    const activeSuggestionCount = tradeResolution && !tradeResolution.isReady ? tradeResolution.suggestions.length
        : balanceResolution && !balanceResolution.isReady ? balanceResolution.suggestions.length
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

                    {phase !== "scanning" && phase !== "success" && parsed.type === "dividend" && (
                        <DividendView parsed={parsed} setQuery={setQuery} knownName={assetSuggestions.find(a => a.ticker.toUpperCase() === parsed.ticker)?.name} />
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

function Chip({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "red" | "green" | "fuchsia" }) {
    const toneClass = {
        neutral: "bg-base-100 dark:bg-base-800 text-base-600 dark:text-base-300",
        red: "bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900",
        green: "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900",
        fuchsia: "bg-secondary-50 dark:bg-secondary-950/30 text-secondary-600 dark:text-secondary-400 border border-secondary-200 dark:border-secondary-900",
    }[tone];
    return <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold font-mono ${toneClass}`}>{children}</span>;
}

function RestingView({ recent, accounts, onDemo }: { recent: TransactionResponse[]; accounts: AccountResponse[]; onDemo: (cmd: string) => void }) {
    const accountById = new Map(accounts.map(a => [a.id, a]));
    const exampleChips = getExampleChips(accounts);
    const balanceCmd = exampleChips.find(c => c.label === "🏦 Balance")!.command;
    return (
        <div className="p-4 space-y-4">
            <div>
                <div className="grid grid-cols-4 gap-2">
                    {[
                        { label: "＋ Expense", color: "text-red-500", cmd: "coffee 5.20" },
                        { label: "＋ Trade", color: "text-emerald-500", cmd: "buy 10 VOO" },
                        { label: "＋ Balance", color: "text-primary-500", cmd: balanceCmd },
                        { label: "＋ Dividend", color: "text-secondary-500", cmd: "div AAPL 48" },
                    ].map(qa => (
                        <button key={qa.label} onClick={() => onDemo(qa.cmd)} className={`text-[11px] font-semibold ${qa.color} border border-base-200 dark:border-base-800 rounded-lg py-2 hover:bg-base-50 dark:hover:bg-base-800 transition-colors`}>
                            {qa.label}
                        </button>
                    ))}
                </div>
            </div>
            {recent.length > 0 && (
                <div>
                    <div className="text-[10px] font-mono uppercase tracking-wider text-base-400 mb-2">Recent</div>
                    <div className="space-y-1">
                        {recent.map(tx => (
                            <div key={tx.id} className="flex items-center justify-between text-sm py-1.5">
                                <span className="text-base-700 dark:text-base-300">{tx.description || "Transaction"} <span className="text-base-400 text-xs">· {accountById.get(tx.account_id)?.name}</span></span>
                                <span className={`font-mono font-semibold ${tx.transaction_type === "income" ? "text-emerald-600" : "text-base-900 dark:text-base-50"}`}>
                                    {tx.transaction_type === "income" ? "+" : "-"}${fmtA(Number(tx.amount))}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-base-400 mb-2">Try it</div>
                <div className="flex flex-wrap gap-1.5">
                    {exampleChips.map(c => (
                        <button key={c.label} onClick={() => onDemo(c.command)} className="px-2.5 py-1 rounded-full text-xs font-medium bg-base-100 dark:bg-base-800 text-base-600 dark:text-base-300 hover:bg-base-200 dark:hover:bg-base-700">
                            {c.label}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}

function ExpenseView({ parsed, defaultAccount, scanned, hasHousehold, ownership, setOwnership, accounts, setQuery, categoryOverride, setCategoryOverride, expenseAccountId, setExpenseAccountId }: {
    parsed: Extract<ParsedCommand, { type: "expense" }>;
    defaultAccount: AccountResponse | null;
    scanned: ScanResult | null;
    hasHousehold: boolean;
    ownership: "private" | "household";
    setOwnership: (v: "private" | "household") => void;
    accounts: AccountResponse[];
    setQuery: (v: string) => void;
    categoryOverride: { name: string; icon: string } | null;
    setCategoryOverride: (v: { name: string; icon: string } | null) => void;
    expenseAccountId: string | null;
    setExpenseAccountId: (v: string | null) => void;
}) {
    const category = categoryOverride || parsed.category;
    const effectiveAccount = expenseAccountId ? accounts.find(a => a.id === expenseAccountId) || null : defaultAccount;

    const merchant = useSyncedField(parsed.merchant, (v) => setQuery(serializeExpense(v, amount.value)));
    const amount = useSyncedField(parsed.amount, (v) => setQuery(serializeExpense(merchant.value, v)));

    return (
        <div className="p-4 space-y-3">
            <div className="text-xs font-semibold text-base-500 dark:text-base-400">{scanned ? "From receipt · expense" : "Will log an expense"}</div>
            <div className="grid grid-cols-2 gap-3">
                <div>
                    <div className={labelClass}>Merchant</div>
                    <input
                        className={fieldClass}
                        value={merchant.value}
                        onChange={(e) => merchant.setValue(e.target.value)}
                        onFocus={merchant.onFocus}
                        onBlur={merchant.onBlur}
                    />
                </div>
                <div>
                    <div className={labelClass}>Amount</div>
                    <input
                        type="number"
                        step="0.01"
                        className={`${fieldClass} font-mono`}
                        value={amount.value}
                        onChange={(e) => amount.setValue(parseFloat(e.target.value) || 0)}
                        onFocus={amount.onFocus}
                        onBlur={amount.onBlur}
                    />
                </div>
            </div>
            <div>
                <div className={labelClass}>Category</div>
                <div className="flex flex-wrap gap-1.5">
                    {CATEGORY_OPTIONS.map(c => (
                        <button
                            key={c.name}
                            onClick={() => setCategoryOverride(c)}
                            className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${c.name === category.name ? "bg-secondary-500 text-white" : "bg-base-100 dark:bg-base-800 text-base-600 dark:text-base-300 hover:bg-base-200 dark:hover:bg-base-700"}`}
                        >
                            {c.icon} {c.name}
                        </button>
                    ))}
                </div>
            </div>
            {scanned && (
                <div className="rounded-lg border border-base-200 dark:border-base-800 bg-base-50 dark:bg-base-950 p-3">
                    <div className="text-xs font-semibold text-base-500 mb-2">{scanned.merchant} · {scanned.items.length} items</div>
                    <div className="space-y-1">
                        {scanned.items.map(([name, price]) => (
                            <div key={name} className="flex justify-between text-xs text-base-600 dark:text-base-400">
                                <span>{name}</span><span className="font-mono">${price}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            <div>
                <div className={labelClass}>Account</div>
                {accounts.length > 0 ? (
                    <Select
                        size="sm"
                        className="rounded-lg bg-base-50 dark:bg-base-950 focus-visible:ring-secondary-400"
                        value={effectiveAccount?.id || ""}
                        onChange={(id) => setExpenseAccountId(id || null)}
                        options={accounts.map(a => ({ value: a.id, label: `${a.name} · ${a.currency}` }))}
                    />
                ) : (
                    <div className="text-xs text-red-500">No account available to charge yet.</div>
                )}
            </div>
            {hasHousehold && (
                <div>
                    <div className={labelClass}>Post this expense to</div>
                    <div className="flex bg-base-100 dark:bg-base-800 rounded-lg p-1 w-fit">
                        {(["private", "household"] as const).map(o => (
                            <button
                                key={o}
                                onClick={() => setOwnership(o)}
                                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5 ${!expenseAccountId && ownership === o ? "bg-white dark:bg-base-700 text-base-900 dark:text-base-50 shadow-sm" : "text-base-500"}`}
                            >
                                {o === "private" ? "🔒 Private" : <><span className="w-1.5 h-1.5 rounded-full bg-primary-500 inline-block" /> Household</>}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

type TradeResolution = {
    fallback: { name: string; price: number; icon: string; currency: string } | undefined;
    live: { ticker: string; price: number; currency: string } | null;
    known: AssetResponse | undefined;
    suggestions: { id: string; ticker: string; name: string }[];
    price: number | undefined;
    name: string | undefined;
    isReady: boolean;
};

function TradeView({ parsed, query, setQuery, resolution, priceLoading, onSelectTicker, subportfolios, selectedSubPortfolioId, onSelectSubPortfolio, highlightIndex, onHoverSuggestion }: {
    parsed: Extract<ParsedCommand, { type: "trade" }>;
    query: string;
    setQuery: (v: string) => void;
    resolution: TradeResolution;
    priceLoading: boolean;
    onSelectTicker: (ticker: string) => void;
    subportfolios: SubPortfolioResponse[];
    selectedSubPortfolioId: string | null;
    onSelectSubPortfolio: (id: string) => void;
    highlightIndex: number;
    onHoverSuggestion: (i: number) => void;
}) {
    const prefix = parsed.ticker;
    const { live, suggestions, price, name, isReady } = resolution;

    const qty = useSyncedField(parsed.qty, (v) => setQuery(serializeTrade(parsed.side, v, ticker.value, parsed.explicitPrice)));
    const ticker = useSyncedField(parsed.ticker, (v) => setQuery(serializeTrade(parsed.side, qty.value, v.toUpperCase(), parsed.explicitPrice)));
    const priceField = useSyncedField<number | null>(parsed.explicitPrice, (v) => setQuery(serializeTrade(parsed.side, qty.value, ticker.value, v)));

    return (
        <div className="p-4 space-y-3">
            <div className="text-xs font-semibold text-base-500 dark:text-base-400">
                {isReady ? "Ready to log" : priceLoading ? "Looking up ticker…" : "Pick an asset"}
            </div>
            {isReady ? (
                <>
                    <div className="flex gap-1.5">
                        {(["buy", "sell"] as const).map(s => (
                            <button
                                key={s}
                                onClick={() => setQuery(serializeTrade(s, qty.value, ticker.value, parsed.explicitPrice))}
                                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${parsed.side === s ? (s === "buy" ? "bg-emerald-500 text-white" : "bg-red-500 text-white") : "bg-base-100 dark:bg-base-800 text-base-600 dark:text-base-300 hover:bg-base-200 dark:hover:bg-base-700"}`}
                            >
                                {s === "buy" ? "Buy" : "Sell"}
                            </button>
                        ))}
                        {live && <span className="self-center"><Chip tone="fuchsia">Live</Chip></span>}
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <div className={labelClass}>Quantity</div>
                            <input
                                type="number"
                                step="any"
                                className={`${fieldClass} font-mono`}
                                value={qty.value}
                                onChange={(e) => qty.setValue(parseFloat(e.target.value) || 0)}
                                onFocus={qty.onFocus}
                                onBlur={qty.onBlur}
                            />
                        </div>
                        <div>
                            <div className={labelClass}>Ticker</div>
                            <input
                                className={`${fieldClass} font-mono uppercase`}
                                value={ticker.value}
                                onChange={(e) => ticker.setValue(e.target.value)}
                                onFocus={ticker.onFocus}
                                onBlur={ticker.onBlur}
                            />
                        </div>
                        <div>
                            <div className={labelClass}>Price</div>
                            <input
                                type="number"
                                step="0.01"
                                placeholder={price != null ? fmtA(price) : "—"}
                                className={`${fieldClass} font-mono`}
                                value={priceField.value ?? ""}
                                onChange={(e) => priceField.setValue(e.target.value === "" ? null : parseFloat(e.target.value) || 0)}
                                onFocus={priceField.onFocus}
                                onBlur={priceField.onBlur}
                            />
                        </div>
                    </div>
                    {name && <div className="text-sm text-base-700 dark:text-base-300">{name}</div>}
                </>
            ) : null}
            {isReady && (
                subportfolios.length > 0 ? (
                    <div>
                        <div className="text-[10px] font-mono uppercase tracking-wider text-base-400 mb-1.5">Into portfolio</div>
                        <div className="flex flex-wrap gap-1.5">
                            {subportfolios.map(sp => (
                                <button
                                    key={sp.id}
                                    onClick={() => onSelectSubPortfolio(sp.id)}
                                    className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${sp.id === selectedSubPortfolioId ? "bg-secondary-500 text-white" : "bg-base-100 dark:bg-base-800 text-base-600 dark:text-base-300 hover:bg-base-200 dark:hover:bg-base-700"}`}
                                >
                                    {sp.name}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="text-xs text-red-500">No portfolio available yet — create one on the Portfolio page.</div>
                )
            )}
            {!isReady && (
                suggestions.length > 0 ? (
                    <div className="space-y-1">
                        {suggestions.map((a, i) => (
                            <button
                                key={a.id}
                                onClick={() => onSelectTicker(a.ticker)}
                                onMouseEnter={() => onHoverSuggestion(i)}
                                className={`w-full flex items-center justify-between text-left rounded-lg px-3 py-2 hover:bg-base-50 dark:hover:bg-base-800 ${i === highlightIndex ? "bg-secondary-50 dark:bg-secondary-950/30 border border-secondary-200 dark:border-secondary-900" : ""}`}
                            >
                                <div className="text-sm">
                                    <span className="font-mono font-bold text-secondary-600 dark:text-secondary-400">{a.ticker.slice(0, prefix.length)}</span>
                                    <span className="font-mono font-bold text-base-900 dark:text-base-50">{a.ticker.slice(prefix.length)}</span>
                                    <span className="text-base-500 dark:text-base-400"> — {a.name}</span>
                                </div>
                                {i === highlightIndex && <span className="text-xs text-secondary-500">↵</span>}
                            </button>
                        ))}
                    </div>
                ) : priceLoading ? (
                    <div className="text-sm text-base-500 italic">Fetching live price for "{prefix}"…</div>
                ) : (
                    <div className="text-sm text-base-500 italic">No matches for "{query}" yet — it'll be created when you log it.</div>
                )
            )}
        </div>
    );
}

type BalanceResolution = {
    known: AccountResponse | undefined;
    suggestions: AccountResponse[];
    isReady: boolean;
    query: string;
};

function BalanceView({ parsed, resolution, setQuery, onSelectAccount, highlightIndex, onHoverSuggestion }: {
    parsed: Extract<ParsedCommand, { type: "balance" }>;
    resolution: BalanceResolution;
    setQuery: (v: string) => void;
    onSelectAccount: (name: string) => void;
    highlightIndex: number;
    onHoverSuggestion: (i: number) => void;
}) {
    const { known, suggestions, isReady, query } = resolution;
    const name = useSyncedField(parsed.query, (v) => setQuery(serializeBalance(v, balance.value)));
    const balance = useSyncedField(parsed.newBalance, (v) => setQuery(serializeBalance(name.value, v)));

    return (
        <div className="p-4 space-y-3">
            <div className="text-xs font-semibold text-base-500 dark:text-base-400">
                {isReady ? (known ? "Update balance" : "New account · set balance") : "Pick an account"}
            </div>
            {isReady ? (
                <>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <div className={labelClass}>Account</div>
                            <input
                                className={fieldClass}
                                value={name.value}
                                onChange={(e) => name.setValue(e.target.value)}
                                onFocus={name.onFocus}
                                onBlur={name.onBlur}
                            />
                        </div>
                        <div>
                            <div className={labelClass}>New balance</div>
                            <input
                                type="number"
                                step="0.01"
                                className={`${fieldClass} font-mono`}
                                value={balance.value}
                                onChange={(e) => balance.setValue(parseFloat(e.target.value) || 0)}
                                onFocus={balance.onFocus}
                                onBlur={balance.onBlur}
                            />
                        </div>
                    </div>
                    {!known && <div className="text-xs text-amber-500">No account named "{name.value}" yet — it'll be created when you log it.</div>}
                    <div className="text-xs text-base-400">Sets a new snapshot for today.</div>
                </>
            ) : suggestions.length > 0 ? (
                <div className="space-y-1">
                    {suggestions.map((a, i) => (
                        <button
                            key={a.id}
                            onClick={() => onSelectAccount(a.name)}
                            onMouseEnter={() => onHoverSuggestion(i)}
                            className={`w-full flex items-center justify-between text-left rounded-lg px-3 py-2 hover:bg-base-50 dark:hover:bg-base-800 ${i === highlightIndex ? "bg-secondary-50 dark:bg-secondary-950/30 border border-secondary-200 dark:border-secondary-900" : ""}`}
                        >
                            <div className="text-sm">
                                <span className="font-medium text-base-900 dark:text-base-50">{a.name}</span>
                                <span className="text-base-500 dark:text-base-400"> · {a.currency}</span>
                            </div>
                            {i === highlightIndex && <span className="text-xs text-secondary-500">↵</span>}
                        </button>
                    ))}
                </div>
            ) : (
                <div className="text-sm text-base-500 italic">No account matches "{query}" — it'll be created when you log it.</div>
            )}
        </div>
    );
}

function DividendView({ parsed, setQuery, knownName }: { parsed: Extract<ParsedCommand, { type: "dividend" }>; setQuery: (v: string) => void; knownName?: string }) {
    const info = FALLBACK_ASSETS[parsed.ticker];
    const name = knownName || info?.name || parsed.ticker;
    const ticker = useSyncedField(parsed.ticker, (v) => setQuery(serializeDividend(v.toUpperCase(), amount.value)));
    const amount = useSyncedField(parsed.amount, (v) => setQuery(serializeDividend(ticker.value, v)));
    return (
        <div className="p-4 space-y-3">
            <div className="text-xs font-semibold text-base-500 dark:text-base-400">Log a dividend</div>
            <div className="grid grid-cols-2 gap-3">
                <div>
                    <div className={labelClass}>Ticker</div>
                    <input
                        className={`${fieldClass} font-mono uppercase`}
                        value={ticker.value}
                        onChange={(e) => ticker.setValue(e.target.value)}
                        onFocus={ticker.onFocus}
                        onBlur={ticker.onBlur}
                    />
                </div>
                <div>
                    <div className={labelClass}>Amount</div>
                    <input
                        type="number"
                        step="0.01"
                        className={`${fieldClass} font-mono`}
                        value={amount.value}
                        onChange={(e) => amount.setValue(parseFloat(e.target.value) || 0)}
                        onFocus={amount.onFocus}
                        onBlur={amount.onBlur}
                    />
                </div>
            </div>
            <div className="text-sm text-base-700 dark:text-base-300">{info?.icon || "💵"} {name}</div>
            <div className="text-xs text-base-500">≈ S${fmtA(parsed.amount * USD_SGD)} · adds to this year's dividend income &amp; yield</div>
        </div>
    );
}

function TransferView({ parsed, accounts, setQuery }: { parsed: Extract<ParsedCommand, { type: "transfer" }>; accounts: AccountResponse[]; setQuery: (v: string) => void }) {
    const from = parsed.fromCandidates[0] || null;
    const to = parsed.toCandidates[0] || null;
    const amount = useSyncedField(parsed.amount, (v) => setQuery(serializeTransfer(v, from, to)));
    return (
        <div className="p-4 space-y-3">
            <div className="text-xs font-semibold text-base-500 dark:text-base-400">Transfer between accounts</div>
            <div className="grid grid-cols-2 gap-3 items-center relative">
                {[{ acc: from, label: "From", tone: "text-red-500", sign: "−" }, { acc: to, label: "To", tone: "text-emerald-500", sign: "+" }].map((slot, i) => (
                    <div key={i} className="rounded-lg border border-base-200 dark:border-base-800 px-3 py-2.5 space-y-1.5">
                        <div className={labelClass + " mb-0"}>{slot.label}</div>
                        <Select
                            size="sm"
                            className="rounded-lg bg-base-50 dark:bg-base-950 text-xs font-mono font-bold focus-visible:ring-secondary-400"
                            placeholder="Select account"
                            value={slot.acc?.id || ""}
                            onChange={(id) => {
                                const acc = accounts.find(a => a.id === id) || null;
                                setQuery(i === 0 ? serializeTransfer(amount.value, acc, to) : serializeTransfer(amount.value, from, acc));
                            }}
                            options={accounts.map(a => ({ value: a.id, label: a.name }))}
                        />
                        <div className={`text-sm font-mono font-semibold ${slot.tone}`}>{slot.sign}${fmt(amount.value)}</div>
                    </div>
                ))}
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white dark:bg-base-800 border border-secondary-300 dark:border-secondary-800 flex items-center justify-center text-secondary-500 text-xs">⇄</div>
            </div>
            <div>
                <div className={labelClass}>Amount</div>
                <input
                    type="number"
                    step="0.01"
                    className={`${fieldClass} font-mono max-w-[160px]`}
                    value={amount.value}
                    onChange={(e) => amount.setValue(parseFloat(e.target.value) || 0)}
                    onFocus={amount.onFocus}
                    onBlur={amount.onBlur}
                />
            </div>
            <div className="flex flex-wrap gap-1.5">
                <Chip>No net-worth change</Chip>
            </div>
        </div>
    );
}

function SearchView({ term, subportfolios, recent, onSelectGoal, onSelectTxn }: {
    term: string;
    subportfolios: SubPortfolioResponse[];
    recent: TransactionResponse[];
    onSelectGoal: (id: string) => void;
    onSelectTxn: () => void;
}) {
    const t = term.toLowerCase();
    const goalMatches = subportfolios.filter(g => g.name.toLowerCase().includes(t));
    const txnMatches = recent.filter(tx => (tx.description || "").toLowerCase().includes(t));

    if (goalMatches.length === 0 && txnMatches.length === 0) {
        return (
            <div className="p-6 text-center text-sm text-base-500">
                No matches for "{term}". Add a number to log it instead.
            </div>
        );
    }

    return (
        <div className="p-4 space-y-4">
            {goalMatches.length > 0 && (
                <div>
                    <div className="text-[10px] font-mono uppercase tracking-wider text-base-400 mb-2">Goals</div>
                    <div className="space-y-1">
                        {goalMatches.map(g => (
                            <button key={g.id} onClick={() => onSelectGoal(g.id)} className="w-full flex items-center justify-between text-left text-sm py-1.5 hover:bg-base-50 dark:hover:bg-base-800 rounded-lg px-2">
                                <span className="text-base-800 dark:text-base-200">🎯 {g.name}</span>
                                <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-mono">GOAL</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}
            {txnMatches.length > 0 && (
                <div>
                    <div className="text-[10px] font-mono uppercase tracking-wider text-base-400 mb-2">Transactions · {txnMatches.length}</div>
                    <div className="space-y-1">
                        {txnMatches.map(tx => (
                            <button key={tx.id} onClick={onSelectTxn} className="w-full flex items-center justify-between text-left text-sm py-1.5 hover:bg-base-50 dark:hover:bg-base-800 rounded-lg px-2">
                                <span className="text-base-800 dark:text-base-200">{tx.description}</span>
                                <span className="font-mono text-red-500">-${fmtA(Number(tx.amount))}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function ScanView({ pct }: { pct: number }) {
    return (
        <div className="p-5 space-y-3">
            <div className="text-xs font-semibold text-base-500 dark:text-base-400">Scanning receipt…</div>
            <div className="relative h-40 rounded-lg overflow-hidden" style={{ backgroundImage: "repeating-linear-gradient(0deg, #f3f0e8, #f3f0e8 8px, #e9e5da 8px, #e9e5da 9px)" }}>
                <div className="absolute inset-x-4 top-4 text-[10px] font-mono font-bold text-base-700">NTUC FAIRPRICE</div>
                <div className="absolute inset-x-4 bottom-3 text-[10px] font-mono font-bold text-base-700">TOTAL $43.20</div>
                <div
                    className="absolute left-0 right-0 h-6"
                    style={{
                        top: `${6 + (pct / 100) * 86}%`,
                        background: "linear-gradient(#e879f900, #e879f955, #e879f900)",
                        boxShadow: "0 0 16px #e879f9",
                    }}
                />
            </div>
            <div className="h-1.5 rounded-full bg-base-100 dark:bg-base-800 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-secondary-500 to-secondary-400 transition-all duration-100" style={{ width: `${pct}%` }} />
            </div>
            <div className="text-xs text-base-500 flex justify-between">
                <span>Reading merchant, total &amp; line items…</span>
                <span className="font-mono text-secondary-500">{pct}%</span>
            </div>
        </div>
    );
}

function SuccessView({ big, sub, canUndo, onUndo, onAgain }: { big: string; sub: string; canUndo: boolean; onUndo: () => void; onAgain: () => void }) {
    return (
        <div className="p-8 flex flex-col items-center text-center">
            <div className="rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center mb-3" style={{ width: 52, height: 52 }}>
                <span className="text-emerald-500 text-2xl">✓</span>
            </div>
            <div className="font-display font-bold text-base-900 dark:text-base-50">Logged {big}</div>
            <div className="text-xs text-base-500 mt-1 mb-4">{sub}</div>
            <div className="flex gap-2">
                {canUndo && <button onClick={onUndo} className="px-4 py-1.5 rounded-full text-xs font-semibold bg-base-100 dark:bg-base-800 text-base-600 dark:text-base-300">Undo</button>}
                <button onClick={onAgain} className="px-4 py-1.5 rounded-full text-xs font-semibold bg-gradient-to-br from-secondary-500 to-secondary-700 text-white">Add another</button>
            </div>
        </div>
    );
}
