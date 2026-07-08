import type { AccountResponse } from "../types/types";

// Small fallback price table used only when a ticker hasn't been traded before and a live
// lookup hasn't resolved yet - mirrors the demo table from the original prototype.
export const FALLBACK_ASSETS: Record<string, { name: string; price: number; icon: string; currency: string }> = {
    VOO: { name: "Vanguard S&P 500", price: 512.40, icon: "📈", currency: "USD" },
    VO: { name: "Vanguard Mid-Cap", price: 268.10, icon: "📈", currency: "USD" },
    VOOG: { name: "Vanguard S&P Growth", price: 348.90, icon: "📈", currency: "USD" },
    AAPL: { name: "Apple Inc.", price: 232.10, icon: "🍎", currency: "USD" },
    TSLA: { name: "Tesla Inc.", price: 346.00, icon: "🚗", currency: "USD" },
    MSFT: { name: "Microsoft", price: 468.20, icon: "🪟", currency: "USD" },
    NVDA: { name: "NVIDIA", price: 172.40, icon: "🎮", currency: "USD" },
};

const CATEGORY_RULES: [string[], { name: string; icon: string }][] = [
    [["coffee", "latte", "cafe", "lunch", "dinner", "food", "restaurant", "meal", "breakfast"], { name: "Food & Dining", icon: "☕" }],
    [["grab", "taxi", "mrt", "bus", "transport", "uber", "ride", "fuel", "petrol"], { name: "Transport", icon: "🚕" }],
    [["ntuc", "grocery", "groceries", "fairprice", "supermarket", "cold storage"], { name: "Groceries", icon: "🛒" }],
    [["movie", "netflix", "spotify", "game", "concert", "cinema"], { name: "Entertainment", icon: "🎬" }],
    [["shopee", "lazada", "amazon", "shopping", "uniqlo", "zara"], { name: "Shopping", icon: "🛍️" }],
];

export function guessCategory(low: string): { name: string; icon: string } {
    for (const [keys, cat] of CATEGORY_RULES) {
        if (keys.some(k => low.includes(k))) return cat;
    }
    return { name: "General", icon: "💳" };
}

/** Presets for a category picker UI - the keyword-guessed categories plus the General fallback. */
export const CATEGORY_OPTIONS: { name: string; icon: string }[] = [
    ...CATEGORY_RULES.map(([, cat]) => cat),
    { name: "General", icon: "💳" },
];

export function guessMerchant(raw: string): string {
    const words = raw.replace(/[\d,.]+/g, "").replace(/\b(from|to)\b/gi, "").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return "Expense";
    return words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** Matches account keywords (first word of each account's name, lowercased) against the query. */
export function matchAccounts(low: string, accounts: AccountResponse[]): AccountResponse[] {
    const hits: { account: AccountResponse; index: number }[] = [];
    const seen = new Set<string>();
    accounts.forEach(a => {
        const kw = a.name.split(/\s+/)[0].toLowerCase();
        const idx = low.indexOf(kw);
        if (idx >= 0 && !seen.has(a.id)) {
            hits.push({ account: a, index: idx });
            seen.add(a.id);
        }
    });
    return hits.sort((a, b) => a.index - b.index).map(h => h.account);
}

/** First word of an account's name - the token the parser matches against typed text
 * (see matchAccounts). Used by the form fields to serialize a picked account back into text. */
export function accountKeyword(account: AccountResponse): string {
    return account.name.split(/\s+/)[0];
}

// Serializers turn structured form-field values back into a command string using the exact
// grammar parseCommand expects, so editing a GUI field keeps the text input in sync.
export function serializeTrade(side: "buy" | "sell", qty: number, ticker: string, price: number | null): string {
    const q = qty > 0 ? String(qty) : "";
    const p = price != null && price > 0 ? ` ${price}` : "";
    return `${side} ${q} ${ticker || ""}${p}`.replace(/\s+/g, " ").trim();
}

export function serializeDividend(ticker: string, amount: number): string {
    return `div ${ticker || ""} ${amount > 0 ? amount : ""}`.replace(/\s+/g, " ").trim();
}

/** Serializes into the explicit "bal <full account name> <amount>" form rather than the bare
 * first-word-keyword form, so round-tripping through the GUI form never collides with another
 * account that happens to share the same first word (e.g. "Chase Checking" vs "Chase Savings"). */
export function serializeBalance(accountNameQuery: string, balance: number): string {
    return `bal ${accountNameQuery || ""} ${balance > 0 ? balance : ""}`.replace(/\s+/g, " ").trim();
}

export function serializeTransfer(amount: number, from: AccountResponse | null, to: AccountResponse | null): string {
    if (!from || !to) return "";
    return `transfer ${amount > 0 ? amount : ""} from ${accountKeyword(from)} to ${accountKeyword(to)}`.replace(/\s+/g, " ").trim();
}

export function serializeExpense(merchant: string, amount: number): string {
    return `${merchant || ""} ${amount > 0 ? amount : ""}`.replace(/\s+/g, " ").trim();
}

export function assetInfo(ticker: string, known?: { ticker: string; name: string; currency: string }, livePrice?: number) {
    const fallback = FALLBACK_ASSETS[ticker] || { name: ticker, price: 100, icon: "📊" };
    return {
        name: known?.name || fallback.name,
        price: livePrice ?? fallback.price,
        icon: fallback.icon,
    };
}

export type ParsedCommand =
    | { type: "empty" }
    | { type: "transfer"; amount: number; fromCandidates: AccountResponse[]; toCandidates: AccountResponse[] }
    | { type: "trade"; side: "buy" | "sell"; qty: number; ticker: string; explicitPrice: number | null }
    | { type: "dividend"; ticker: string; amount: number }
    | { type: "balance"; query: string; newBalance: number }
    | { type: "expense"; amount: number; merchant: string; category: { name: string; icon: string }; account: AccountResponse | null }
    | { type: "search"; term: string };

export function parseCommand(query: string, accounts: AccountResponse[]): ParsedCommand {
    const raw = (query || "").trim();
    if (!raw) return { type: "empty" };
    const low = raw.toLowerCase();
    const numMatches = raw.match(/[\d,]+(\.\d+)?/g);
    const nums = numMatches ? numMatches.map(n => parseFloat(n.replace(/,/g, ""))) : [];

    if (/^(transfer|move|xfer)\b/.test(low)) {
        const matched = matchAccounts(low, accounts);
        const rest = accounts.filter(a => !matched.includes(a));
        return {
            type: "transfer",
            amount: nums[0] || 0,
            fromCandidates: matched.length > 0 ? [matched[0]] : accounts.slice(0, 1),
            toCandidates: matched.length > 1 ? [matched[1]] : rest.slice(0, 1),
        };
    }

    const tradeMatch = low.match(/^(buy|sell)\s+(\d+)\s+([a-z0-9.=-]+)(?:\s+([\d,.]+))?/);
    if (tradeMatch) {
        return {
            type: "trade",
            side: tradeMatch[1] as "buy" | "sell",
            qty: Number(tradeMatch[2]),
            ticker: tradeMatch[3].toUpperCase(),
            explicitPrice: tradeMatch[4] ? parseFloat(tradeMatch[4].replace(/,/g, "")) : null,
        };
    }

    const divMatch = low.match(/^div(?:idend)?\s+([a-z0-9.=-]+)/);
    if (divMatch) {
        return { type: "dividend", ticker: divMatch[1].toUpperCase(), amount: nums[0] || 0 };
    }

    // Explicit "bal"/"balance" verb: forces balance type even with no account text yet, so a
    // bare "bal" opens a browsable list of all accounts (like typing "buy" alone would for trade
    // if tickers had a browse mode). The account-name portion is everything after the verb minus
    // any trailing number, resolved/searched against the live account list in the command bar.
    const balVerbMatch = low.match(/^bal(?:ance)?\b/);
    if (balVerbMatch) {
        const restRaw = raw.slice(balVerbMatch[0].length).trim();
        const nameQuery = restRaw.replace(/[\d,]+(\.\d+)?/g, "").trim();
        return { type: "balance", query: nameQuery, newBalance: nums[nums.length - 1] || 0 };
    }

    const accountMatches = matchAccounts(low, accounts);
    if (accountMatches.length && nums.length) {
        return { type: "balance", query: accountMatches[0].name, newBalance: nums[nums.length - 1] };
    }

    if (nums.length) {
        const category = guessCategory(low);
        return {
            type: "expense",
            amount: nums[nums.length - 1],
            merchant: guessMerchant(raw),
            category,
            account: accounts[0] || null,
        };
    }

    return { type: "search", term: raw };
}
