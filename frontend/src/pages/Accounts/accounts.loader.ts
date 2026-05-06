import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import type { AccountResponse, BalanceResponse } from "../../types/types";
import { getSSRContext } from "../../lib/ssr-helpers";

export type AccountWithHistory = AccountResponse & {
    history: BalanceResponse[];
};

export async function loader({ request }: LoaderFunctionArgs): Promise<AccountWithHistory[]> {
    const { householdId, ssrFetch } = await getSSRContext(request);

    // Server-side fetching using dynamic URL (backend:5001 vs localhost:5001)
    const accountsRes = await ssrFetch(`/accounts/household/${householdId}`);

    if (!accountsRes.ok) {
        throw new Error(`Failed to fetch accounts: ${accountsRes.statusText}`);
    }
    const accounts: AccountResponse[] = await accountsRes.json();

    const balancesRes = await ssrFetch(`/accounts/balances/household/${householdId}`);
    if (!balancesRes.ok) {
        throw new Error(`Failed to fetch balances: ${balancesRes.statusText}`);
    }
    const allBalances: BalanceResponse[] = await balancesRes.json();

    const balanceMap: Record<string, BalanceResponse[]> = {};
    allBalances.forEach(b => {
        if (!balanceMap[b.account_id]) balanceMap[b.account_id] = [];
        balanceMap[b.account_id].push(b);
    });

    const accountsWithHistory = accounts.map(acc => ({
        ...acc,
        history: balanceMap[acc.id] || []
    }));

    return accountsWithHistory;
}

export async function action({ request }: ActionFunctionArgs) {
    const { householdId, ssrFetch } = await getSSRContext(request);
    const formData = await request.formData();

    const intent = formData.get("_intent");

    if (intent === "addAccount") {
        const name = formData.get("name") as string;
        const liquidity = formData.get("liquidity") as string;
        const tax_status = formData.get("tax_status") as string;
        const currency = formData.get("currency") as string;
        const balance = formData.get("balance") as string;
        const date = formData.get("date") as string;

        const accRes = await ssrFetch("/accounts/", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                household_id: householdId,
                name,
                liquidity,
                tax_status,
                currency,
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

    return { error: "Invalid intent" };
}
