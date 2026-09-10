import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import api from "./api";
import { useHousehold } from "./HouseholdContext";
import type {
    AccountResponse,
    CategoryResponse,
    SubPortfolioResponse,
    TransactionResponse,
} from "../types/types";

/**
 * The reference sets the ⌘K command bar works from — accounts, categories, sub-portfolios and
 * the few recent transactions it shows — loaded once per household at the app root instead of
 * every time the bar opens. Mirrors `ios/.../State/ReferenceDataStore.swift` and
 * `android/.../state/ReferenceDataViewModel.kt`.
 *
 * The bar used to fire all four requests from an effect gated on `isOpen`. On a cold page load
 * the first ⌘K therefore had no accounts to parse against for a full round trip, so typing
 * "12.34 lunch chase" resolved no account and the resting view showed no recents —
 * indistinguishable from a household with nothing in it (#272; the same bug was reported on
 * iOS and fixed there and on Android). Loading when the household resolves means the bar is
 * usable the instant it opens.
 *
 * Accounts and categories are published **before** the other two are awaited: parsing a
 * command needs only those, and making it wait on the transaction list buys it nothing.
 */

export type ReferenceStatus =
    | { kind: "idle" }
    | { kind: "loading" }
    /** Accounts and categories are usable; the rest may still be in flight. */
    | { kind: "essentials" }
    | { kind: "ready" }
    | { kind: "failed"; message: string };

interface ReferenceDataContextType {
    accounts: AccountResponse[];
    categories: CategoryResponse[];
    subportfolios: SubPortfolioResponse[];
    recent: TransactionResponse[];
    status: ReferenceStatus;
    /**
     * Accounts and categories have landed at least once for this household.
     *
     * Not derived from `status`: a *refresh* that fails (or is still in flight) leaves the
     * previous answer in place, and that answer is still the best one available. Reading the
     * status instead would make a failed refresh hide data we are still holding — the very
     * symptom this exists to prevent.
     */
    hasEssentials: boolean;
    failureMessage: string | null;
    /** Re-fetch regardless of what is already loaded — after a command is logged, or on retry. */
    reload: () => void;
    /** Fold a category created from inside the bar in, rather than re-fetching for one row. */
    addCategory: (category: CategoryResponse) => void;
    /** Same, for an account created inline. */
    addAccount: (account: AccountResponse) => void;
}

const ReferenceDataContext = createContext<ReferenceDataContextType>({
    accounts: [],
    categories: [],
    subportfolios: [],
    recent: [],
    status: { kind: "idle" },
    hasEssentials: false,
    failureMessage: null,
    reload: () => { },
    addCategory: () => { },
    addAccount: () => { },
});

/** How many transactions to ask for. The bar shows three; without a limit this request
 *  downloaded the household's entire history to display them, which on a multi-year household
 *  is by far the heaviest of the four. */
const RECENT_LIMIT = 50;

export const ReferenceDataProvider = ({ children }: { children: ReactNode }) => {
    const { activeHousehold } = useHousehold();
    const householdId = activeHousehold?.id ?? null;

    const [accounts, setAccounts] = useState<AccountResponse[]>([]);
    const [categories, setCategories] = useState<CategoryResponse[]>([]);
    const [subportfolios, setSubportfolios] = useState<SubPortfolioResponse[]>([]);
    const [recent, setRecent] = useState<TransactionResponse[]>([]);
    const [status, setStatus] = useState<ReferenceStatus>({ kind: "idle" });
    const [hasEssentials, setHasEssentials] = useState(false);

    /** Bumped to force a re-fetch; also the token a late response checks itself against, so a
     *  slow first load can't overwrite a newer one. */
    const [reloadToken, setReloadToken] = useState(0);
    const runIdRef = useRef(0);

    const reload = useCallback(() => setReloadToken(t => t + 1), []);

    useEffect(() => {
        if (!householdId) {
            setAccounts([]);
            setCategories([]);
            setSubportfolios([]);
            setRecent([]);
            setHasEssentials(false);
            setStatus({ kind: "idle" });
            return;
        }

        const runId = ++runIdRef.current;
        const current = () => runIdRef.current === runId;
        setStatus({ kind: "loading" });

        (async () => {
            try {
                const [accountsRes, categoriesRes] = await Promise.all([
                    api.get<AccountResponse[]>(`/accounts/household/${householdId}`),
                    api.get<CategoryResponse[]>(`/cashflow/categories/household/${householdId}`),
                ]);
                if (!current()) return;
                setAccounts(accountsRes.data);
                setCategories(categoriesRes.data);
                setHasEssentials(true);
                setStatus({ kind: "essentials" });

                const [subsRes, recentRes] = await Promise.all([
                    api.get<SubPortfolioResponse[]>(`/portfolio/subportfolios/household/${householdId}`),
                    api.get<TransactionResponse[]>(
                        `/cashflow/transactions/household/${householdId}?limit=${RECENT_LIMIT}`,
                    ),
                ]);
                if (!current()) return;
                setSubportfolios(subsRes.data);
                setRecent([...recentRes.data].sort((a, b) => (a.date < b.date ? 1 : -1)));
                setStatus({ kind: "ready" });
            } catch (e) {
                if (!current()) return;
                // A failure part-way through leaves whatever did land usable rather than
                // blanking it; the status still says something went wrong.
                const message = e instanceof Error ? e.message : "Couldn't load your accounts.";
                setStatus({ kind: "failed", message });
            }
        })();
        // The household changing replaces everything (two households' accounts must never
        // mix); `reloadToken` re-runs it for the same household.
    }, [householdId, reloadToken]);

    const addCategory = useCallback((category: CategoryResponse) => {
        setCategories(existing =>
            existing.some(c => c.id === category.id) ? existing : [...existing, category],
        );
    }, []);

    const addAccount = useCallback((account: AccountResponse) => {
        setAccounts(existing =>
            existing.some(a => a.id === account.id) ? existing : [...existing, account],
        );
    }, []);

    return (
        <ReferenceDataContext.Provider
            value={{
                accounts,
                categories,
                subportfolios,
                recent,
                status,
                hasEssentials,
                failureMessage: status.kind === "failed" ? status.message : null,
                reload,
                addCategory,
                addAccount,
            }}
        >
            {children}
        </ReferenceDataContext.Provider>
    );
};

export const useReferenceData = () => useContext(ReferenceDataContext);
