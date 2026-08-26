import { redirect, type LoaderFunctionArgs, type ActionFunctionArgs } from "react-router";
import type { AccountResponse, BalanceResponse, CounterpartyBalanceResponse, CurrencyResponse, LinkedEquityRow } from "../../types/types";
import { getSSRContext } from "../../lib/ssr-helpers";

export type AccountWithHistory = AccountResponse & {
    history: BalanceResponse[];
};

export type AccountsLoaderData = {
    accounts: AccountWithHistory[];
    currencies: CurrencyResponse[];
    // Properties netted against the loans secured on them. Empty until the
    // household records an illiquid asset.
    equity: LinkedEquityRow[];
    // Outstanding debts either way. These sit in no account, so the summary
    // needs them handed in or it reports money you are owed as money gone.
    owed: CounterpartyBalanceResponse[];
};

export async function loader({ request }: LoaderFunctionArgs): Promise<AccountsLoaderData> {
    const { householdId, ssrFetch } = await getSSRContext(request);

    if (!householdId) {
        throw redirect("/households");
    }
    // All three are household-scoped and independent — fetch in one round-trip
    // instead of fetching balances in a second wave after accounts+currencies.
    const [accountsRes, currenciesRes, balancesRes, equityRes, owedRes] = await Promise.all([
        ssrFetch(`/accounts/household/${householdId}`),
        ssrFetch(`/reference/currencies`),
        ssrFetch(`/accounts/balances/household/${householdId}`),
        ssrFetch(`/accounts/household/${householdId}/equity`),
        ssrFetch(`/cashflow/reimbursements/household/${householdId}`)
    ]);

    if (!accountsRes.ok) {
        throw new Error(`Failed to fetch accounts: ${accountsRes.statusText}`);
    }
    if (!balancesRes.ok) {
        throw new Error(`Failed to fetch balances: ${balancesRes.statusText}`);
    }
    const accounts: AccountResponse[] = await accountsRes.json();
    const currencies: CurrencyResponse[] = currenciesRes.ok ? await currenciesRes.json() : [];
    const allBalances: BalanceResponse[] = await balancesRes.json();
    // Equity is a nice-to-have panel; a failure here shouldn't take the page down.
    const equity: LinkedEquityRow[] = equityRes.ok ? await equityRes.json() : [];
    const owed: CounterpartyBalanceResponse[] = owedRes.ok ? await owedRes.json() : [];

    const balanceMap: Record<string, BalanceResponse[]> = {};
    allBalances.forEach(b => {
        if (!balanceMap[b.account_id]) balanceMap[b.account_id] = [];
        balanceMap[b.account_id].push(b);
    });

    const accountsWithHistory = accounts.map(acc => ({
        ...acc,
        history: balanceMap[acc.id] || []
    }));

    return {
        accounts: accountsWithHistory,
        currencies,
        equity,
        owed
    };
}

/**
 * Pull the optional loan/property terms off a submitted form.
 *
 * Every field is optional and blank means "not set" — a liability with no terms
 * keeps the old flat-balance behaviour, so we send null rather than 0.
 */
function loanTermsFromForm(formData: FormData) {
    const num = (key: string) => {
        const raw = (formData.get(key) as string | null)?.trim();
        if (!raw) return null;
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : null;
    };
    const str = (key: string) => {
        const raw = (formData.get(key) as string | null)?.trim();
        return raw ? raw : null;
    };

    return {
        original_principal: num("original_principal"),
        interest_rate_annual: num("interest_rate_annual"),
        loan_term_months: num("loan_term_months"),
        monthly_payment: num("monthly_payment"),
        loan_start_date: str("loan_start_date"),
        appreciation_rate_annual: num("appreciation_rate_annual"),
        linked_account_id: str("linked_account_id"),
    };
}

export async function action({ request }: ActionFunctionArgs) {
    const { householdId, ssrFetch } = await getSSRContext(request);
    const formData = await request.formData();

    const intent = formData.get("_intent");

    if (intent === "addAccount") {
        const name = formData.get("name") as string;
        const liquidity = formData.get("liquidity") as string;
        const tax_status = formData.get("tax_status") as string;
        const kind = (formData.get("kind") as string) || "asset";
        const currency = formData.get("currency") as string;
        const balance = formData.get("balance") as string;
        const date = formData.get("date") as string;
        const isPrivate = formData.get("is_private") === "on";
        const currentUserId = formData.get("current_user_id") as string | null;

        const accRes = await ssrFetch("/accounts", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                household_id: householdId,
                name,
                liquidity,
                tax_status,
                kind,
                currency,
                owner_user_id: isPrivate && currentUserId ? currentUserId : null,
                ...loanTermsFromForm(formData),
            }),
        });

        if (!accRes.ok) return { error: "Failed to create account" };
        const acc = await accRes.json();

        const balRes = await ssrFetch("/accounts/balances", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                account_id: acc.id,
                date,
                balance: parseFloat(balance) || 0,
            }),
        });

        if (!balRes.ok) return { error: "Failed to add initial balance" };
        return { success: true };
    }

    if (intent === "editAccount") {
        const accountId = formData.get("accountId") as string;
        const name = formData.get("name") as string;

        const res = await ssrFetch(`/accounts/${accountId}`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                name,
                ...loanTermsFromForm(formData),
            }),
        });

        if (!res.ok) {
            const detail = await res.json().catch(() => null);
            return { error: detail?.detail || "Failed to update account" };
        }
        return { success: true };
    }

    if (intent === "updateBalance") {
        const account_id = formData.get("accountId") as string;
        const date = formData.get("date") as string;
        const balance = formData.get("balance") as string;

        const balRes = await ssrFetch("/accounts/balances", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                account_id,
                date,
                balance: parseFloat(balance) || 0,
            }),
        });

        if (!balRes.ok) return { error: "Failed to update balance" };
        return { success: true };
    }

    if (intent === "deleteAccount") {
        const accountId = formData.get("accountId") as string;
        const res = await ssrFetch(`/accounts/${accountId}`, {
            method: "DELETE",
        });

        if (!res.ok) return { error: "Failed to delete account" };
        return { success: true };
    }

    if (intent === "deleteBalance") {
        const balanceId = formData.get("balanceId") as string;
        const res = await ssrFetch(`/accounts/balances/${balanceId}`, {
            method: "DELETE",
        });

        if (!res.ok) return { error: "Failed to delete balance" };
        return { success: true };
    }

    return { error: "Invalid intent" };
}
