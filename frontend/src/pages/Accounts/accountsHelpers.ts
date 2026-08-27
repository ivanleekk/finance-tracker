import { AccountKind, LiquidityStatus, TaxTreatment } from "../../types/types";
import type { AccountResponse } from "../../types/types";

/**
 * Palettes, label maps and pure predicates behind the Accounts page.
 *
 * Split out of `Accounts.tsx`: none of it depends on React or on the page's
 * state, and the page opens on the page rather than on sixty lines of lookup
 * tables.
 */

// Add a color palette for the different accounts
export const CHART_COLORS = [
    "#0ea5e9", // Sky blue
    "#10b981", // Emerald green
    "#8b5cf6", // Violet
    "#f59e0b", // Amber
    "#ec4899", // Pink
    "#14b8a6", // Teal
    "#f43f5e", // Rose
    "#6366f1", // Indigo
];

export const LIQUIDITY_META: Record<string, { label: string; className: string }> = {
    [LiquidityStatus.Liquid]: { label: "LIQUID", className: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10" },
    [LiquidityStatus.MarketLiquid]: { label: "MARKET", className: "text-primary-600 dark:text-primary-400 bg-primary-500/10" },
    [LiquidityStatus.TimeLocked]: { label: "TIME-LOCK", className: "text-amber-600 dark:text-amber-400 bg-amber-500/10" },
    [LiquidityStatus.Retirement]: { label: "RETIREMENT", className: "text-amber-600 dark:text-amber-400 bg-amber-500/10" },
    [LiquidityStatus.Illiquid]: { label: "PROPERTY", className: "text-violet-600 dark:text-violet-400 bg-violet-500/10" },
};

export const LIQUIDITY_LABELS: Record<string, string> = {
    [LiquidityStatus.Liquid]: "liquid — cash you can spend today",
    [LiquidityStatus.MarketLiquid]: "market — sellable investments",
    [LiquidityStatus.TimeLocked]: "time-locked — fixed deposits, CPF",
    [LiquidityStatus.Retirement]: "retirement — SRS, pension",
    [LiquidityStatus.Illiquid]: "property — home, car, physical assets",
};

export const TAX_META: Record<string, { label: string; className: string }> = {
    [TaxTreatment.Taxable]: { label: "TAXABLE", className: "text-base-500 dark:text-base-400 bg-base-200/60 dark:bg-base-800" },
    [TaxTreatment.TaxDeferred]: { label: "TAX-DEFER", className: "text-secondary-600 dark:text-secondary-400 bg-secondary-500/10" },
    [TaxTreatment.TaxFree]: { label: "TAX-FREE", className: "text-secondary-600 dark:text-secondary-400 bg-secondary-500/10" },
};

export const ACCOUNT_GROUPS: { key: string; label: string; liquidities: LiquidityStatus[] }[] = [
    { key: "cash", label: "Cash & liquid", liquidities: [LiquidityStatus.Liquid] },
    { key: "invest", label: "Investments", liquidities: [LiquidityStatus.MarketLiquid] },
    { key: "retirement", label: "Retirement · CPF & SRS", liquidities: [LiquidityStatus.TimeLocked, LiquidityStatus.Retirement] },
    { key: "property", label: "Property & physical assets", liquidities: [LiquidityStatus.Illiquid] },
];

export function initialsFor(name: string) {
    return (name.split(/\s+/)[0] || name).slice(0, 4).toUpperCase();
}

/**
 * Whether a liability has enough detail to be amortized. Mirrors
 * `loan_terms_for` on the backend: without all four the account keeps its
 * flat manual balance and there is no schedule to show.
 */
export function hasLoanTerms(account: Pick<AccountResponse, "kind" | "original_principal" | "interest_rate_annual" | "loan_term_months" | "loan_start_date">) {
    return (
        account.kind === AccountKind.Liability &&
        Number(account.original_principal) > 0 &&
        account.interest_rate_annual != null &&
        Number(account.loan_term_months) > 0 &&
        !!account.loan_start_date
    );
}


/**
 * A blank "add account" form.
 *
 * A factory rather than a constant because the private-by-default checkbox
 * follows the user's own preference, and because a fresh `date` each time is
 * the point — a module-level constant would freeze today's date at import.
 */
export function emptyNewAccount(defaultPrivate: boolean) {
    return {
        name: "",
        liquidity: LiquidityStatus.Liquid as LiquidityStatus,
        tax_status: TaxTreatment.Taxable as TaxTreatment,
        kind: AccountKind.Asset as AccountKind,
        balance: "",
        currency: "USD",
        date: new Date().toISOString().split("T")[0],
        isPrivate: defaultPrivate,
        // Optional loan terms — blank means "no terms", i.e. the old flat-balance
        // behaviour.
        original_principal: "",
        interest_rate_annual: "",
        loan_term_months: "",
        monthly_payment: "",
        loan_start_date: "",
        // Optional property terms.
        appreciation_rate_annual: "",
        linked_account_id: "",
    };
}

export type NewAccountForm = ReturnType<typeof emptyNewAccount>;
