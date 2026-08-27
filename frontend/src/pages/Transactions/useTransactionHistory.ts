import { useMemo } from "react"
import { groupHistory, type HistoryGranularity } from "../../lib/historyGroups"
import { isVisibleInViewMode } from "../../lib/ViewModeContext"
import { countsAsSpending } from "../../lib/reimbursements"
import type {
    AccountResponse,
    AssetResponse,
    CategoryResponse,
    SubPortfolioResponse,
    TradeResponse,
    TransactionResponse,
    UserResponse,
} from "../../types/types"
import type { HouseholdResponse } from "../../types/types"
import {
    CATEGORY_COLORS,
    OTHER_SLICE_COLOR,
    categoryIcon,
    homeValueOf,
    type CategoryPeriodPreset,
    type UnifiedHistoryItem,
} from "./transactionsHelpers"

type Options = {
    // Raw loader data
    trades: TradeResponse[]
    transactions: TransactionResponse[]
    assets: AssetResponse[]
    categories: CategoryResponse[]
    accounts: AccountResponse[]
    subportfolios: SubPortfolioResponse[]

    // Who is looking, and at what
    user: UserResponse | null | undefined
    viewMode: "private" | "household" | "blended"
    activeHousehold: HouseholdResponse
    baseCurrency: string

    // Filters the page owns
    filterCategory: string
    filterAccount: string
    filterSubportfolio: string
    filterFlow: "all" | "income" | "expense"
    hiddenCategoryIds: Set<string>
    categoryPeriod: CategoryPeriodPreset
    categoryPeriodStart: string
    categoryPeriodEnd: string
    historyGranularity: HistoryGranularity
}

/**
 * Everything the Transactions page displays, derived from what it loaded.
 *
 * Trades and transactions are two different shapes that the page shows as one
 * list, and that reconciliation — plus the filtering, the day/month/year
 * grouping, and the category donut — was ~295 lines of `useMemo` wedged between
 * the page's event handlers and its JSX. Pulling it out means the page reads as
 * state → render, and this reads as data → view model, with each half small
 * enough to hold in your head.
 *
 * It is also the half worth testing, and it could not be tested at all while it
 * was trapped inside a component.
 */
export function useTransactionHistory({
    trades,
    transactions,
    assets,
    categories,
    accounts,
    subportfolios,
    user,
    viewMode,
    activeHousehold,
    baseCurrency,
    filterCategory,
    filterAccount,
    filterSubportfolio,
    filterFlow,
    hiddenCategoryIds,
    categoryPeriod,
    categoryPeriodStart,
    categoryPeriodEnd,
    historyGranularity,
}: Options) {
    const tradeTransactionIds = useMemo(
        () => new Set(trades.map(t => t.transaction_id).filter(Boolean)),
        [trades]
    );

    const transactionMap = useMemo(
        () => new Map(transactions.map(tx => [tx.id, tx])),
        [transactions]
    );

    const combinedHistory = useMemo(() => {
        // Maps for O(1) lookups
        const assetMap = new Map(assets.map(a => [a.id, a.ticker]));
        const categoryMap = new Map(categories.map(c => [c.id, c.name]));
        const subportfolioMap = new Map(subportfolios.map(sp => [sp.id, sp.name]));

        // 1. Process Trades
        const tradeItems: UnifiedHistoryItem[] = trades.map(t => {
            const ticker = assetMap.get(t.asset_id) || "UNKNOWN";
            const account = accounts.find(a => a.id === t.account_id);
            const accountName = account?.name || "Unknown Account";
            const spName = t.sub_portfolio_id ? (subportfolioMap.get(t.sub_portfolio_id) || "Unknown Sub-Portfolio") : null;
            
            const nativeAmount = Number(t.quantity) * Number(t.price);
            const accountAmount = nativeAmount * Number(t.exchange_rate);
            // A trade only has a home-currency figure through the funding transaction it
            // settled against. Cash-settled trades (settle_from_cash) never create one, so
            // they stay out of the group totals rather than being summed in the wrong currency.
            const fundingTx = t.transaction_id ? transactionMap.get(t.transaction_id) : undefined;
            const homeAmount = homeValueOf(fundingTx?.amount_home_currency, nativeAmount, t.currency || account?.currency, baseCurrency);

            return {
                id: `trade-${t.id}`,
                type: t.type, // 'buy' or 'sell'
                categoryType: 'trade',
                assetOrCategory: ticker,
                amountNative: nativeAmount,
                currencyNative: t.currency || "USD",
                amountAccount: accountAmount,
                currencyAccount: account?.currency || "USD",
                amountHome: homeAmount,
                shares: Number(t.quantity),
                date: new Date(t.date),
                status: "completed",
                accountId: t.account_id,
                accountName: accountName,
                subportfolioId: t.sub_portfolio_id || null,
                subportfolioName: spName,
                householdName: activeHousehold.name,
                description: t.description || null,
                ownerUserId: account?.owner_user_id || null,
                // A trade is never split — you don't buy shares on someone's behalf here.
                split: null
            };
        });

        // 2. Process Transactions (Filtering out those linked to trades)
        const txItems: UnifiedHistoryItem[] = transactions
            .filter(tx => !tradeTransactionIds.has(tx.id))
            .map(tx => {
                const categoryName = categoryMap.get(tx.category_id) || "Uncategorized";
                const account = accounts.find(a => a.id === tx.account_id);
                const accountName = account?.name || "Unknown Account";

                const isExpense = tx.transaction_type === 'expense';
                let typeStr = isExpense ? "withdrawal" : "deposit";
                if (tx.transfer_id) {
                    typeStr = isExpense ? "transfer_out" : "transfer_in";
                }

                const nativeAmount = Math.abs(Number(tx.amount));
                const accountAmount = nativeAmount * (Number(tx.exchange_rate) || 1);
                const homeAmount = homeValueOf(tx.amount_home_currency, nativeAmount, tx.currency || account?.currency, baseCurrency);

                return {
                    id: `tx-${tx.id}`,
                    type: typeStr,
                    categoryType: 'transaction',
                    assetOrCategory: categoryName,
                    amountNative: nativeAmount,
                    currencyNative: tx.currency || account?.currency || "USD",
                    amountAccount: accountAmount,
                    currencyAccount: account?.currency || "USD",
                    amountHome: homeAmount,
                    shares: null,
                    date: new Date(tx.date),
                    status: "completed",
                    accountId: tx.account_id,
                    accountName: accountName,
                    subportfolioId: null,
                    subportfolioName: null,
                    householdName: activeHousehold.name,
                    description: tx.description || null,
                    ownerUserId: account?.owner_user_id || null,
                    split: tx.owed_by && tx.owed_amount
                        ? { owedBy: tx.owed_by, owedAmount: Number(tx.owed_amount) }
                        : null
                };
            });

        // 3. Unify and Sort
        return [...tradeItems, ...txItems].sort((a, b) => b.date.getTime() - a.date.getTime());
    }, [trades, transactions, assets, categories, accounts, subportfolios, activeHousehold.name, tradeTransactionIds, transactionMap, baseCurrency]);

    const isInflow = (type: string) => ['deposit', 'income', 'sell', 'transfer_in'].includes(type);

    const filteredHistory = useMemo(() => {
        return combinedHistory.filter(item => {
            if (!isVisibleInViewMode(item.ownerUserId, viewMode, user?.id)) return false;
            if (filterCategory !== "all" && item.categoryType !== filterCategory) return false;
            if (filterAccount !== "all" && item.accountId !== filterAccount) return false;
            if (filterSubportfolio !== "all") {
                if (filterSubportfolio === "none" && item.subportfolioId !== null) return false;
                if (filterSubportfolio !== "none" && item.subportfolioId !== filterSubportfolio) return false;
            }
            if (filterFlow !== "all" && (filterFlow === "income") !== isInflow(item.type)) return false;
            return true;
        });
    }, [combinedHistory, filterCategory, filterAccount, filterSubportfolio, filterFlow, viewMode, user?.id]);

    const groupedHistory = useMemo(
        () => groupHistory(filteredHistory, historyGranularity),
        [filteredHistory, historyGranularity]
    );

    const cashflowData = useMemo(() => {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const weeks = [0, 1, 2, 3, 4].map(() => ({ in: 0, out: 0 }));
        let totalIn = 0, totalOut = 0;
        transactions.forEach(tx => {
            if (tradeTransactionIds.has(tx.id)) return;
            const d = new Date(tx.date);
            if (d < monthStart) return;
            const account = accounts.find(a => a.id === tx.account_id);
            if (!isVisibleInViewMode(account?.owner_user_id ?? null, viewMode, user?.id)) return;
            const homeAmount = Math.abs(Number(tx.amount_home_currency ?? tx.amount));
            const weekIdx = Math.min(4, Math.floor((d.getDate() - 1) / 7));
            if (tx.transaction_type === 'income') {
                weeks[weekIdx].in += homeAmount;
                totalIn += homeAmount;
            } else {
                weeks[weekIdx].out += homeAmount;
                totalOut += homeAmount;
            }
        });
        const max = Math.max(1, ...weeks.map(w => Math.max(w.in, w.out)));
        return { weeks, totalIn, totalOut, max, monthLabel: now.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) };
    }, [transactions, accounts, viewMode, user?.id, tradeTransactionIds]);

    // Date window the top-categories card (chips + pie chart) is scoped to. Kept separate from
    // the "Activity Type/Account/Sub-Portfolio" filters below, which apply to the full history list.
    const categoryPeriodRange = useMemo(() => {
        const now = new Date();
        switch (categoryPeriod) {
            case "this_month":
                return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: null as Date | null };
            case "last_month":
                return { start: new Date(now.getFullYear(), now.getMonth() - 1, 1), end: new Date(now.getFullYear(), now.getMonth(), 1) };
            case "last_3_months":
                return { start: new Date(now.getFullYear(), now.getMonth() - 2, 1), end: null };
            case "last_6_months":
                return { start: new Date(now.getFullYear(), now.getMonth() - 5, 1), end: null };
            case "this_year":
                return { start: new Date(now.getFullYear(), 0, 1), end: null };
            case "specific_month": {
                // categoryPeriodStart doubles as the month anchor (always stored as a full
                // YYYY-MM-DD so it stays valid for the custom range's date input too); only its
                // year/month are read. End is exclusive — the 1st of the following month.
                if (!categoryPeriodStart) return null;
                const [year, month] = categoryPeriodStart.split("-").map(Number);
                if (!year || !month) return null;
                return { start: new Date(year, month - 1, 1), end: new Date(year, month, 1) };
            }
            case "custom":
                return {
                    start: categoryPeriodStart ? new Date(`${categoryPeriodStart}T00:00:00`) : null,
                    end: categoryPeriodEnd ? new Date(`${categoryPeriodEnd}T23:59:59.999`) : null,
                };
            default:
                return null;
        }
    }, [categoryPeriod, categoryPeriodStart, categoryPeriodEnd]);

    const isInCategoryPeriod = (date: Date) => {
        if (!categoryPeriodRange) return true;
        if (categoryPeriodRange.start && date < categoryPeriodRange.start) return false;
        if (categoryPeriodRange.end && date >= categoryPeriodRange.end) return false;
        return true;
    };

    // Every expense category that's actually shown up in the selected period, used to populate the
    // filter chips (independent of which ones are currently hidden, so a hidden chip stays visible to re-enable).
    const expenseCategoryOptions = useMemo(() => {
        const seen = new Map<string, string>();
        transactions.forEach(tx => {
            if (tx.transaction_type !== 'expense' || tradeTransactionIds.has(tx.id)) return;
            if (!isInCategoryPeriod(new Date(tx.date))) return;
            if (!countsAsSpending(categories.find(c => c.id === tx.category_id)?.name, !!tx.transfer_id)) return;
            const account = accounts.find(a => a.id === tx.account_id);
            if (!isVisibleInViewMode(account?.owner_user_id ?? null, viewMode, user?.id)) return;
            const id = tx.category_id || "uncategorized";
            if (!seen.has(id)) {
                const name = categories.find(c => c.id === tx.category_id)?.name || "Uncategorized";
                seen.set(id, name);
            }
        });
        return Array.from(seen.entries())
            .map(([id, name]) => ({ id, name }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [transactions, categories, accounts, viewMode, user?.id, tradeTransactionIds, categoryPeriodRange]);

    // Stable id -> color mapping derived from the household's full expense-category list (sorted by
    // id, not by amount), so a category keeps the same pie/legend color no matter what's hidden or
    // which period is selected. "Other"/"Uncategorized" always get the same neutral fallback.
    const categoryColorMap = useMemo(() => {
        const expenseCats = categories
            .filter(c => c.type === 'expense')
            .slice()
            .sort((a, b) => a.id.localeCompare(b.id));
        const map = new Map<string, string>();
        expenseCats.forEach((c, i) => map.set(c.id, CATEGORY_COLORS[i % CATEGORY_COLORS.length]));
        return map;
    }, [categories]);

    const colorForSlice = (id: string) => categoryColorMap.get(id) ?? OTHER_SLICE_COLOR;

    const categoryBreakdown = useMemo(() => {
        const categoryMap = new Map(categories.map(c => [c.id, c.name]));
        const byCategory = new Map<string, { name: string; amount: number }>();
        transactions.forEach(tx => {
            if (tx.transaction_type !== 'expense' || tradeTransactionIds.has(tx.id)) return;
            if (!isInCategoryPeriod(new Date(tx.date))) return;
            if (!countsAsSpending(categories.find(c => c.id === tx.category_id)?.name, !!tx.transfer_id)) return;
            const account = accounts.find(a => a.id === tx.account_id);
            if (!isVisibleInViewMode(account?.owner_user_id ?? null, viewMode, user?.id)) return;
            const catId = tx.category_id || "uncategorized";
            if (hiddenCategoryIds.has(catId)) return;
            const name = categoryMap.get(tx.category_id) || "Uncategorized";
            // Transfers and settlements are cash leaving an account without being
            // spending: you still have the money, or the bill was already charged.
            if (!countsAsSpending(name, !!tx.transfer_id)) return;
            const homeAmount = Math.abs(Number(tx.amount_home_currency ?? tx.amount));
            const existing = byCategory.get(catId);
            byCategory.set(catId, { name, amount: (existing?.amount ?? 0) + homeAmount });
        });
        const all = Array.from(byCategory.entries())
            .map(([id, v]) => ({ id, name: v.name, amount: v.amount, icon: categoryIcon(v.name) }))
            .sort((a, b) => b.amount - a.amount);
        const total = all.reduce((sum, c) => sum + c.amount, 0);
        const top = all.slice(0, 4);
        const max = Math.max(1, ...top.map(c => c.amount));
        return { all, top, max, total };
    }, [transactions, categories, accounts, viewMode, user?.id, tradeTransactionIds, hiddenCategoryIds, categoryPeriodRange]);

    // Cap the pie chart at 6 slices + "Other" so it stays legible once a household has a long tail of categories.
    const pieSlices = useMemo(() => {
        const items = categoryBreakdown.all;
        if (items.length <= 6) return items;
        const top = items.slice(0, 6);
        const otherAmount = items.slice(6).reduce((sum, c) => sum + c.amount, 0);
        return [...top, { id: "other", name: "Other", amount: otherAmount, icon: "•" }];
    }, [categoryBreakdown.all]);


    return {
        colorForSlice,
        filteredHistory,
        groupedHistory,
        cashflowData,
        expenseCategoryOptions,
        categoryBreakdown,
        pieSlices,
    }
}
