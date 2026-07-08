import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useRevalidator } from "react-router";
import { useCommandBar } from "../../lib/CommandBarContext";
import { useHousehold } from "../../lib/HouseholdContext";
import { useAuth } from "../../lib/AuthContext";
import { useViewMode } from "../../lib/ViewModeContext";
import api from "../../lib/api";
import { parseCommand, FALLBACK_ASSETS, type ParsedCommand } from "../../lib/commandParser";
import { SCAN_RESULT, type ScanResult } from "./receiptScan";
import type { AccountResponse, SubPortfolioResponse, TransactionResponse, CategoryResponse } from "../../types/types";

type Phase = "resting" | "typing" | "scanning" | "success";

const EXAMPLE_CHIPS: { label: string; command: string }[] = [
    { label: "☕ Coffee", command: "coffee 5.20" },
    { label: "📈 Buy VOO", command: "buy 10 VOO" },
    { label: "🏦 Balance", command: "DBS 51200" },
    { label: "💵 Dividend", command: "div AAPL 48" },
    { label: "⇄ Transfer", command: "transfer 500 from DBS to IBKR" },
];

const USD_SGD = 1.34;

function fmt(n: number, dec = 0) {
    return Number(n).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtA(n: number) {
    const dec = Number.isInteger(Number(n)) ? 0 : 2;
    return Number(n).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: 2 });
}

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
    const [successInfo, setSuccessInfo] = useState<{ big: string; sub: string } | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [undoData, setUndoData] = useState<{ path: string } | null>(null);

    const [accounts, setAccounts] = useState<AccountResponse[]>([]);
    const [subportfolios, setSubportfolios] = useState<SubPortfolioResponse[]>([]);
    const [categories, setCategories] = useState<CategoryResponse[]>([]);
    const [recent, setRecent] = useState<TransactionResponse[]>([]);

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
        setSuccessInfo(null);
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

    if (!isOpen) return null;

    const parsed: ParsedCommand = scanResult ? { type: "expense", amount: scanResult.amount, merchant: scanResult.merchant, category: scanResult.category, account: accounts[0] || null } : parseCommand(query, accounts);

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
                const account = routedAccount(parsed.account);
                if (!account) return;
                const categoryId = await resolveCategoryId(parsed.category.name, "expense");
                if (!categoryId) return;
                const res = await api.post("/cashflow/transactions", {
                    account_id: account.id,
                    category_id: categoryId,
                    date: new Date().toISOString(),
                    amount: parsed.amount,
                    transaction_type: "expense",
                    description: parsed.merchant,
                });
                finishSuccess(`−$${fmtA(parsed.amount)}`, `${parsed.category.name} · ${account.name}${hasHousehold ? (ownership === "private" ? " · Private" : " · Household") : ""}`, { path: `/cashflow/transactions/${res.data.id}` });
            } else if (parsed.type === "balance") {
                const res = await api.post("/accounts/balances", {
                    account_id: parsed.account.id,
                    date: new Date().toISOString().split("T")[0],
                    balance: parsed.newBalance,
                });
                finishSuccess(`$${fmt(parsed.newBalance)}`, `${parsed.account.name} balance set`, { path: `/accounts/balances/${res.data.id}` });
            } else if (parsed.type === "trade") {
                const defaultSubPortfolio = subportfolios.find(sp => sp.id === activeHousehold.default_sub_portfolio_id) || subportfolios[0];
                const fundingAccount = accounts.find(a => a.id === activeHousehold.default_funding_account_id) || accounts[0];
                if (!defaultSubPortfolio || !fundingAccount) return;
                const info = FALLBACK_ASSETS[parsed.ticker];
                const existingAssets = await api.get(`/portfolio/assets?ticker=${parsed.ticker}`);
                let asset = existingAssets.data[0];
                if (!asset) {
                    const created = await api.post("/portfolio/assets", {
                        id: crypto.randomUUID(),
                        ticker: parsed.ticker,
                        name: info?.name || parsed.ticker,
                        type: "equity",
                        currency: info?.currency || "USD",
                    });
                    asset = created.data;
                }
                const price = parsed.explicitPrice ?? info?.price ?? 100;
                const tradeRes = await api.post("/portfolio/trades", {
                    household_id: activeHousehold.id,
                    sub_portfolio_id: defaultSubPortfolio.id,
                    asset_id: asset.id,
                    account_id: fundingAccount.id,
                    type: parsed.side,
                    date: new Date().toISOString(),
                    quantity: parsed.qty,
                    price,
                    exchange_rate: 1,
                });
                finishSuccess(`${parsed.side === "buy" ? "Bought" : "Sold"} ${parsed.qty} ${parsed.ticker}`, `@ $${fmtA(price)}`, { path: `/portfolio/trades/${tradeRes.data.id}` });
            } else if (parsed.type === "dividend") {
                const defaultSubPortfolio = subportfolios.find(sp => sp.id === activeHousehold.default_sub_portfolio_id) || subportfolios[0];
                const fundingAccount = accounts.find(a => a.id === activeHousehold.default_funding_account_id) || accounts[0];
                if (!defaultSubPortfolio || !fundingAccount) return;
                const info = FALLBACK_ASSETS[parsed.ticker];
                const assetRes = await api.get(`/portfolio/assets?ticker=${parsed.ticker}`);
                let asset = assetRes.data[0];
                if (!asset) {
                    const created = await api.post("/portfolio/assets", {
                        id: crypto.randomUUID(), ticker: parsed.ticker, name: info?.name || parsed.ticker, type: "equity", currency: info?.currency || "USD",
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

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault();
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
                        onChange={(e) => { setQuery(e.target.value); setScanResult(null); setPhase(e.target.value ? "typing" : "resting"); }}
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
                            scanned={scanResult}
                            hasHousehold={hasHousehold}
                            ownership={ownership}
                            setOwnership={setOwnership}
                            accounts={accounts}
                        />
                    )}

                    {phase !== "scanning" && phase !== "success" && parsed.type === "trade" && (
                        <TradeView parsed={parsed} query={query} setQuery={setQuery} />
                    )}

                    {phase !== "scanning" && phase !== "success" && parsed.type === "balance" && (
                        <BalanceView parsed={parsed} />
                    )}

                    {phase !== "scanning" && phase !== "success" && parsed.type === "dividend" && (
                        <DividendView parsed={parsed} />
                    )}

                    {phase !== "scanning" && phase !== "success" && parsed.type === "transfer" && (
                        <TransferView parsed={parsed} />
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
    return (
        <div className="p-4 space-y-4">
            <div>
                <div className="grid grid-cols-4 gap-2">
                    {[
                        { label: "＋ Expense", color: "text-red-500", cmd: "coffee 5.20" },
                        { label: "＋ Trade", color: "text-emerald-500", cmd: "buy 10 VOO" },
                        { label: "＋ Balance", color: "text-primary-500", cmd: "DBS 51200" },
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
                    {EXAMPLE_CHIPS.map(c => (
                        <button key={c.label} onClick={() => onDemo(c.command)} className="px-2.5 py-1 rounded-full text-xs font-medium bg-base-100 dark:bg-base-800 text-base-600 dark:text-base-300 hover:bg-base-200 dark:hover:bg-base-700">
                            {c.label}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}

function ExpenseView({ parsed, scanned, hasHousehold, ownership, setOwnership, accounts }: {
    parsed: Extract<ParsedCommand, { type: "expense" }>;
    scanned: ScanResult | null;
    hasHousehold: boolean;
    ownership: "private" | "household";
    setOwnership: (v: "private" | "household") => void;
    accounts: AccountResponse[];
}) {
    return (
        <div className="p-4 space-y-3">
            <div className="text-xs font-semibold text-base-500 dark:text-base-400">{scanned ? "From receipt · expense" : "Will log an expense"}</div>
            <div className="flex flex-wrap gap-1.5">
                <Chip tone="red">Expense</Chip>
                <Chip tone="red">−${fmtA(parsed.amount)}</Chip>
                <Chip tone="fuchsia">{parsed.category.icon} {parsed.category.name}</Chip>
                <Chip>{parsed.account?.name || "No account"} · {parsed.account?.currency || "SGD"}</Chip>
                <Chip>Today</Chip>
            </div>
            <div className="text-sm text-base-700 dark:text-base-300">{parsed.merchant}</div>
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
            {hasHousehold && (
                <div>
                    <div className="text-[10px] font-mono uppercase tracking-wider text-base-400 mb-1.5">Post this expense to</div>
                    <div className="flex bg-base-100 dark:bg-base-800 rounded-lg p-1 w-fit">
                        {(["private", "household"] as const).map(o => (
                            <button
                                key={o}
                                onClick={() => setOwnership(o)}
                                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5 ${ownership === o ? "bg-white dark:bg-base-700 text-base-900 dark:text-base-50 shadow-sm" : "text-base-500"}`}
                            >
                                {o === "private" ? "🔒 Private" : <><span className="w-1.5 h-1.5 rounded-full bg-primary-500 inline-block" /> Household</>}
                            </button>
                        ))}
                    </div>
                </div>
            )}
            {accounts.length === 0 && <div className="text-xs text-red-500">No account available to charge yet.</div>}
        </div>
    );
}

function TradeView({ parsed, query }: { parsed: Extract<ParsedCommand, { type: "trade" }>; query: string; setQuery: (v: string) => void }) {
    const prefix = parsed.ticker;
    const candidates = Object.entries(FALLBACK_ASSETS)
        .filter(([ticker]) => ticker.startsWith(prefix))
        .sort((a, b) => a[0].length - b[0].length)
        .slice(0, 4);
    const exact = FALLBACK_ASSETS[prefix];

    return (
        <div className="p-4 space-y-3">
            <div className="text-xs font-semibold text-base-500 dark:text-base-400">{exact ? "Ready to log" : "Pick an asset"}</div>
            {exact ? (
                <div className="flex flex-wrap gap-1.5">
                    <Chip tone="green">{parsed.side === "buy" ? "Buy" : "Sell"}</Chip>
                    <Chip>{parsed.qty} {parsed.ticker}</Chip>
                    <Chip>@ ${fmtA(parsed.explicitPrice ?? exact.price)}</Chip>
                    <Chip>{exact.name}</Chip>
                </div>
            ) : candidates.length > 0 ? (
                <div className="space-y-1">
                    {candidates.map(([ticker, info], i) => (
                        <div key={ticker} className={`flex items-center justify-between rounded-lg px-3 py-2 ${i === 0 ? "bg-secondary-50 dark:bg-secondary-950/30 border border-secondary-200 dark:border-secondary-900" : ""}`}>
                            <div className="text-sm">
                                <span className="font-mono font-bold text-secondary-600 dark:text-secondary-400">{ticker.slice(0, prefix.length)}</span>
                                <span className="font-mono font-bold text-base-900 dark:text-base-50">{ticker.slice(prefix.length)}</span>
                                <span className="text-base-500 dark:text-base-400"> — {info.name}</span>
                            </div>
                            {i === 0 && <span className="text-xs text-secondary-500">↵</span>}
                        </div>
                    ))}
                </div>
            ) : (
                <div className="text-sm text-base-500 italic">No matches for "{query}" yet — it'll be created when you log it.</div>
            )}
        </div>
    );
}

function BalanceView({ parsed }: { parsed: Extract<ParsedCommand, { type: "balance" }> }) {
    return (
        <div className="p-4 space-y-3">
            <div className="text-xs font-semibold text-base-500 dark:text-base-400">Update balance</div>
            <div className="flex items-center justify-between rounded-lg border border-base-200 dark:border-base-800 px-3 py-2.5">
                <div>
                    <div className="text-sm font-medium text-base-900 dark:text-base-50">{parsed.account.name} · {parsed.account.currency}</div>
                    <div className="text-xs text-base-500">today</div>
                </div>
                <div className="text-right">
                    <div className="font-mono font-bold text-base-900 dark:text-base-50">${fmt(parsed.newBalance)}</div>
                </div>
            </div>
            <div className="text-xs text-base-400">Sets a new snapshot for today.</div>
        </div>
    );
}

function DividendView({ parsed }: { parsed: Extract<ParsedCommand, { type: "dividend" }> }) {
    const info = FALLBACK_ASSETS[parsed.ticker];
    return (
        <div className="p-4 space-y-3">
            <div className="text-xs font-semibold text-base-500 dark:text-base-400">Log a dividend</div>
            <div className="flex flex-wrap gap-1.5">
                <Chip tone="green">Dividend</Chip>
                <Chip tone="green">+${fmtA(parsed.amount)}</Chip>
                <Chip>{info?.icon || "💵"} {info?.name || parsed.ticker} ({parsed.ticker})</Chip>
            </div>
            <div className="text-xs text-base-500">≈ S${fmtA(parsed.amount * USD_SGD)} · adds to this year's dividend income &amp; yield</div>
        </div>
    );
}

function TransferView({ parsed }: { parsed: Extract<ParsedCommand, { type: "transfer" }> }) {
    const from = parsed.fromCandidates[0];
    const to = parsed.toCandidates[0];
    return (
        <div className="p-4 space-y-3">
            <div className="text-xs font-semibold text-base-500 dark:text-base-400">Transfer between accounts</div>
            <div className="grid grid-cols-2 gap-3 items-center relative">
                {[from, to].map((acc, i) => (
                    <div key={i} className="rounded-lg border border-base-200 dark:border-base-800 px-3 py-2.5">
                        <div className="text-xs font-mono font-bold text-base-500">{acc?.name || "—"}</div>
                        <div className={`text-sm font-mono font-semibold ${i === 0 ? "text-red-500" : "text-emerald-500"}`}>{i === 0 ? "−" : "+"}${fmt(parsed.amount)}</div>
                    </div>
                ))}
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white dark:bg-base-800 border border-secondary-300 dark:border-secondary-800 flex items-center justify-center text-secondary-500 text-xs">⇄</div>
            </div>
            <div className="flex flex-wrap gap-1.5">
                <Chip tone="fuchsia">${fmt(parsed.amount)}</Chip>
                <Chip>{from?.name} → {to?.name}</Chip>
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
