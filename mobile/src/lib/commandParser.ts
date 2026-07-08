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
    | { type: "balance"; account: AccountResponse; newBalance: number }
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

    const tradeMatch = low.match(/^(buy|sell)\s+(\d+)\s+([a-z.]+)(?:\s+([\d,.]+))?/);
    if (tradeMatch) {
        return {
            type: "trade",
            side: tradeMatch[1] as "buy" | "sell",
            qty: Number(tradeMatch[2]),
            ticker: tradeMatch[3].toUpperCase(),
            explicitPrice: tradeMatch[4] ? parseFloat(tradeMatch[4].replace(/,/g, "")) : null,
        };
    }

    const divMatch = low.match(/^div(?:idend)?\s+([a-z.]+)/);
    if (divMatch) {
        return { type: "dividend", ticker: divMatch[1].toUpperCase(), amount: nums[0] || 0 };
    }

    const accountMatches = matchAccounts(low, accounts);
    if (accountMatches.length && nums.length) {
        return { type: "balance", account: accountMatches[0], newBalance: nums[nums.length - 1] };
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
