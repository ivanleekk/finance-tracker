import { redirect, type LoaderFunctionArgs, type ActionFunctionArgs } from "react-router";
import type {
    AccountResponse,
    CategoryResponse,
    RecurringTransactionResponse,
    UpcomingOccurrence,
} from "../../types/types";
import { getSSRContext } from "../../lib/ssr-helpers";

export type RecurringLoaderData = {
    rules: RecurringTransactionResponse[];
    upcoming: UpcomingOccurrence[];
    accounts: AccountResponse[];
    categories: CategoryResponse[];
};

export async function loader({ request }: LoaderFunctionArgs): Promise<RecurringLoaderData> {
    const { householdId, ssrFetch } = await getSSRContext(request);

    if (!householdId) {
        throw redirect("/households");
    }

    const [rulesRes, upcomingRes, accountsRes, categoriesRes] = await Promise.all([
        ssrFetch(`/cashflow/recurring/household/${householdId}`),
        ssrFetch(`/cashflow/recurring/household/${householdId}/upcoming?days=90`),
        ssrFetch(`/accounts/household/${householdId}`),
        ssrFetch(`/cashflow/categories/household/${householdId}`),
    ]);

    return {
        rules: rulesRes.ok ? await rulesRes.json() : [],
        upcoming: upcomingRes.ok ? await upcomingRes.json() : [],
        accounts: accountsRes.ok ? await accountsRes.json() : [],
        categories: categoriesRes.ok ? await categoriesRes.json() : [],
    };
}

export async function action({ request }: ActionFunctionArgs) {
    const { householdId, ssrFetch } = await getSSRContext(request);
    const formData = await request.formData();
    const intent = formData.get("_intent");

    if (intent === "createRule") {
        const endDate = (formData.get("end_date") as string | null)?.trim();
        const isPrivate = formData.get("is_private") === "on";
        const currentUserId = formData.get("current_user_id") as string | null;

        const res = await ssrFetch("/cashflow/recurring", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                household_id: householdId,
                account_id: formData.get("account_id"),
                category_id: formData.get("category_id"),
                amount: Number(formData.get("amount")),
                description: (formData.get("description") as string) || null,
                frequency: formData.get("frequency"),
                start_date: formData.get("start_date"),
                end_date: endDate || null,
                owner_user_id: isPrivate && currentUserId ? currentUserId : null,
            }),
        });
        if (!res.ok) {
            const detail = await res.json().catch(() => null);
            return { error: detail?.detail || "Failed to create the recurring transaction" };
        }
        return { success: true };
    }

    if (intent === "updateRule") {
        const endDate = (formData.get("end_date") as string | null)?.trim();

        const res = await ssrFetch(`/cashflow/recurring/${formData.get("ruleId")}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                account_id: formData.get("account_id"),
                category_id: formData.get("category_id"),
                amount: Number(formData.get("amount")),
                description: (formData.get("description") as string) || null,
                frequency: formData.get("frequency"),
                start_date: formData.get("start_date"),
                end_date: endDate || null,
            }),
        });
        if (!res.ok) {
            const detail = await res.json().catch(() => null);
            return { error: detail?.detail || "Failed to update the recurring transaction" };
        }
        return { success: true };
    }

    if (intent === "toggleRule") {
        const res = await ssrFetch(`/cashflow/recurring/${formData.get("ruleId")}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ is_active: formData.get("is_active") === "true" }),
        });
        if (!res.ok) return { error: "Failed to update the rule" };
        return { success: true };
    }

    if (intent === "deleteRule") {
        const res = await ssrFetch(`/cashflow/recurring/${formData.get("ruleId")}`, {
            method: "DELETE",
        });
        if (!res.ok) return { error: "Failed to delete the rule" };
        return { success: true };
    }

    if (intent === "runNow") {
        const res = await ssrFetch(`/cashflow/recurring/household/${householdId}/run`, {
            method: "POST",
        });
        if (!res.ok) return { error: "Failed to post due transactions" };
        const data = await res.json();
        return { success: true, posted: data.posted };
    }

    return { error: "Invalid intent" };
}
