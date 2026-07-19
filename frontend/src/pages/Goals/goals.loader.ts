import { getSSRContext } from "../../lib/ssr-helpers";
import type { LoaderFunctionArgs } from "react-router";
import type { SubPortfolioResponse, PortfolioSnapshotResponse, CurrencyResponse } from "../../types/types";

export type GoalsLoaderData = {
    subportfolios: SubPortfolioResponse[];
    snapshots: PortfolioSnapshotResponse[];
    currencies: CurrencyResponse[];
};

export async function goalsLoader({ request }: LoaderFunctionArgs): Promise<GoalsLoaderData> {
    const { householdId, ssrFetch } = await getSSRContext(request);

    try {
        const [spRes, snRes, curRes] = await Promise.all([
            ssrFetch(`/portfolio/subportfolios/household/${householdId}`),
            ssrFetch(`/portfolio/snapshots/household/${householdId}`),
            ssrFetch(`/reference/currencies`),
        ]);
        const [subportfolios, snapshots, currencies] = await Promise.all([
            spRes.ok ? spRes.json() : [],
            snRes.ok ? snRes.json() : [],
            curRes.ok ? curRes.json() : [],
        ]);
        return { subportfolios, snapshots, currencies };
    } catch (error) {
        if (error instanceof Response) throw error;
        console.error("Failed to load goals", error);
        return { subportfolios: [], snapshots: [], currencies: [] };
    }
}

export async function goalsAction({ request }: { request: Request }) {
    const { householdId, ssrFetch } = await getSSRContext(request);
    const formData = await request.formData();
    const intent = formData.get("_intent");

    if (intent === "createGoal") {
        const res = await ssrFetch("/portfolio/subportfolios", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                household_id: householdId,
                name: formData.get("name"),
                risk_profile: formData.get("risk_profile") || "moderate",
                target_amount: parseFloat(formData.get("target_amount") as string) || null,
                target_date: formData.get("target_date") || null,
                owner_user_id: formData.get("is_private") === "on" ? (formData.get("current_user_id") as string) : null,
            }),
        });
        if (!res.ok) return { error: "Failed to create goal" };
        return { success: true };
    }

    return { error: "Invalid intent" };
}
