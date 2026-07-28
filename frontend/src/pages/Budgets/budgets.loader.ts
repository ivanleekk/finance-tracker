import { redirect, type LoaderFunctionArgs, type ActionFunctionArgs } from "react-router";
import type {
    BudgetStatusResponse,
    CategoryResponse,
    EmergencyFundResponse,
} from "../../types/types";
import { getSSRContext } from "../../lib/ssr-helpers";

export type BudgetsLoaderData = {
    status: BudgetStatusResponse | null;
    emergencyFund: EmergencyFundResponse | null;
    categories: CategoryResponse[];
};

export async function loader({ request }: LoaderFunctionArgs): Promise<BudgetsLoaderData> {
    const { householdId, ssrFetch } = await getSSRContext(request);

    if (!householdId) {
        throw redirect("/households");
    }

    const [statusRes, fundRes, categoriesRes] = await Promise.all([
        ssrFetch(`/cashflow/budgets/household/${householdId}/status`),
        ssrFetch(`/cashflow/household/${householdId}/emergency-fund`),
        ssrFetch(`/cashflow/categories/household/${householdId}`),
    ]);

    return {
        status: statusRes.ok ? await statusRes.json() : null,
        emergencyFund: fundRes.ok ? await fundRes.json() : null,
        categories: categoriesRes.ok ? await categoriesRes.json() : [],
    };
}

export async function action({ request }: ActionFunctionArgs) {
    const { householdId, ssrFetch } = await getSSRContext(request);
    const formData = await request.formData();
    const intent = formData.get("_intent");

    if (intent === "createBudget") {
        const res = await ssrFetch("/cashflow/budgets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                household_id: householdId,
                category_ids: formData.getAll("category_ids"),
                amount: Number(formData.get("amount")),
                period: formData.get("period") || "monthly",
            }),
        });
        if (!res.ok) {
            const detail = await res.json().catch(() => null);
            return { error: detail?.detail || "Failed to create budget" };
        }
        return { success: true };
    }

    if (intent === "updateBudget") {
        const res = await ssrFetch(`/cashflow/budgets/${formData.get("budgetId")}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ amount: Number(formData.get("amount")) }),
        });
        if (!res.ok) return { error: "Failed to update budget" };
        return { success: true };
    }

    if (intent === "deleteBudget") {
        const res = await ssrFetch(`/cashflow/budgets/${formData.get("budgetId")}`, {
            method: "DELETE",
        });
        if (!res.ok) return { error: "Failed to delete budget" };
        return { success: true };
    }

    if (intent === "setEmergencyTarget") {
        const res = await ssrFetch(`/users/households/${householdId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                emergency_fund_target_months: Number(formData.get("target_months")),
            }),
        });
        if (!res.ok) return { error: "Failed to update the emergency fund target" };
        return { success: true };
    }

    return { error: "Invalid intent" };
}
