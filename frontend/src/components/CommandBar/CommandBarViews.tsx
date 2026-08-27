import React from "react";
import {
    CATEGORY_OPTIONS,
    FALLBACK_ASSETS,
    serializeBalance,
    serializeDividend,
    serializeExpense,
    serializeTrade,
    serializeTransfer,
    type ParsedCommand,
} from "../../lib/commandParser";
import type { ScanResult } from "./receiptScan";
import { Select } from "../ui/Select";
import type {
    AccountResponse,
    AssetResponse,
    SubPortfolioResponse,
    TransactionResponse,
} from "../../types/types";
import { USD_SGD, fieldClass, fmt, fmtA, getExampleChips, labelClass, useSyncedField } from "./commandBarHelpers";

/**
 * The ⌘K command bar's per-command previews — one view per thing the parser can
 * recognise, plus the resting and result screens.
 *
 * All ten were already separate components; they just lived in the same file as
 * the container that switches between them, which made that file ~1240 lines.
 * They are presentational: state stays in `CommandBar`, and each view takes what
 * it renders as props.
 */

export function Chip({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "red" | "green" | "fuchsia" }) {
    const toneClass = {
        neutral: "bg-base-100 dark:bg-base-800 text-base-600 dark:text-base-300",
        red: "bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900",
        green: "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900",
        fuchsia: "bg-secondary-50 dark:bg-secondary-950/30 text-secondary-600 dark:text-secondary-400 border border-secondary-200 dark:border-secondary-900",
    }[tone];
    return <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold font-mono ${toneClass}`}>{children}</span>;
}

export function RestingView({ recent, accounts, onDemo }: { recent: TransactionResponse[]; accounts: AccountResponse[]; onDemo: (cmd: string) => void }) {
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

export function ExpenseView({ parsed, defaultAccount, scanned, hasHousehold, ownership, setOwnership, accounts, setQuery, categoryOverride, setCategoryOverride, expenseAccountId, setExpenseAccountId }: {
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

export type TradeResolution = {
    fallback: { name: string; price: number; icon: string; currency: string } | undefined;
    live: { ticker: string; price: number; currency: string } | null;
    known: AssetResponse | undefined;
    suggestions: { id: string; ticker: string; name: string }[];
    price: number | undefined;
    name: string | undefined;
    isReady: boolean;
};

export function TradeView({ parsed, query, setQuery, resolution, priceLoading, onSelectTicker, subportfolios, selectedSubPortfolioId, onSelectSubPortfolio, highlightIndex, onHoverSuggestion }: {
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

export type BalanceResolution = {
    known: AccountResponse | undefined;
    suggestions: AccountResponse[];
    isReady: boolean;
    query: string;
};

export function BalanceView({ parsed, resolution, setQuery, onSelectAccount, highlightIndex, onHoverSuggestion }: {
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

export type DividendResolution = {
    known: AssetResponse | undefined;
    suggestions: { id: string; ticker: string; name: string }[];
    name: string | undefined;
    isReady: boolean;
};

export function DividendView({ parsed, setQuery, resolution, onSelectTicker, highlightIndex, onHoverSuggestion }: {
    parsed: Extract<ParsedCommand, { type: "dividend" }>;
    setQuery: (v: string) => void;
    resolution: DividendResolution;
    onSelectTicker: (ticker: string) => void;
    highlightIndex: number;
    onHoverSuggestion: (i: number) => void;
}) {
    const prefix = parsed.ticker;
    const { suggestions, isReady } = resolution;
    const info = FALLBACK_ASSETS[parsed.ticker];
    const name = resolution.name || parsed.ticker;
    const ticker = useSyncedField(parsed.ticker, (v) => setQuery(serializeDividend(v.toUpperCase(), amount.value)));
    const amount = useSyncedField(parsed.amount, (v) => setQuery(serializeDividend(ticker.value, v)));
    return (
        <div className="p-4 space-y-3">
            <div className="text-xs font-semibold text-base-500 dark:text-base-400">
                {isReady ? "Log a dividend" : "Pick an asset"}
            </div>
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
            {!isReady && suggestions.length > 0 ? (
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
            ) : (
                <>
                    <div className="text-sm text-base-700 dark:text-base-300">{info?.icon || "💵"} {name}</div>
                    <div className="text-xs text-base-500">≈ S${fmtA(parsed.amount * USD_SGD)} · adds to this year's dividend income &amp; yield</div>
                </>
            )}
        </div>
    );
}

export function TransferView({ parsed, accounts, setQuery }: { parsed: Extract<ParsedCommand, { type: "transfer" }>; accounts: AccountResponse[]; setQuery: (v: string) => void }) {
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

export function SearchView({ term, subportfolios, recent, onSelectGoal, onSelectTxn }: {
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

export function ScanView({ pct }: { pct: number }) {
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

export function SuccessView({ big, sub, canUndo, onUndo, onAgain }: { big: string; sub: string; canUndo: boolean; onUndo: () => void; onAgain: () => void }) {
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
