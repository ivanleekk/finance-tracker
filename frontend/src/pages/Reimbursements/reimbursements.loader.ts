import { redirect, type LoaderFunctionArgs, type ActionFunctionArgs } from "react-router";
import type {
    AccountResponse,
    CategoryResponse,
    CounterpartyBalanceResponse,
} from "../../types/types";
import { getSSRContext } from "../../lib/ssr-helpers";

export type ReimbursementsLoaderData = {
    balances: CounterpartyBalanceResponse[];
    accounts: AccountResponse[];
    categories: CategoryResponse[];
};

export async function loader({ request }: LoaderFunctionArgs): Promise<ReimbursementsLoaderData> {
    const { householdId, ssrFetch } = await getSSRContext(request);

    if (!householdId) {
        throw redirect("/households");
    }

    const [balancesRes, accountsRes, categoriesRes] = await Promise.all([
        ssrFetch(`/cashflow/reimbursements/household/${householdId}`),
        ssrFetch(`/accounts/household/${householdId}`),
        ssrFetch(`/cashflow/categories/household/${householdId}`),
    ]);

    return {
        balances: balancesRes.ok ? await balancesRes.json() : [],
        accounts: accountsRes.ok ? await accountsRes.json() : [],
        categories: categoriesRes.ok ? await categoriesRes.json() : [],
    };
}

export async function action({ request }: ActionFunctionArgs) {
    const { householdId, ssrFetch } = await getSSRContext(request);
    const formData = await request.formData();
    const intent = formData.get("_intent");

    if (intent === "settle") {
        const res = await ssrFetch("/cashflow/reimbursements/settle", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                account_id: formData.get("account_id"),
                counterparty_name: formData.get("counterparty_name"),
                direction: formData.get("direction"),
                amount: Number(formData.get("amount")),
                date: formData.get("date"),
            }),
        });
        if (!res.ok) {
            const detail = await res.json().catch(() => null);
            return { error: detail?.detail || "Failed to record the settlement" };
        }
        return { success: true };
    }

    if (intent === "onBehalf") {
        const res = await ssrFetch("/cashflow/reimbursements/on-behalf", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                household_id: householdId,
                category_id: formData.get("category_id"),
                counterparty_name: formData.get("counterparty_name"),
                amount: Number(formData.get("amount")),
                date: formData.get("date"),
                description: formData.get("description") || null,
            }),
        });
        if (!res.ok) {
            const detail = await res.json().catch(() => null);
            return { error: detail?.detail || "Failed to record the expense" };
        }
        return { success: true };
    }

    return { error: "Invalid intent" };
}
