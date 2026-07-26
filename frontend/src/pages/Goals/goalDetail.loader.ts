import { getSSRContext } from "../../lib/ssr-helpers";
import { redirect } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import type { SubPortfolioResponse, PortfolioTimeseriesPoint, TradeResponse, AccountResponse, HouseholdMemberUserResponse } from "../../types/types";

export type GoalDetailLoaderData = {
    goal: SubPortfolioResponse | null;
    timeseries: PortfolioTimeseriesPoint[];
    trades: TradeResponse[];
    accounts: AccountResponse[];
    members: HouseholdMemberUserResponse[];
};

export async function goalDetailLoader({ request, params }: LoaderFunctionArgs): Promise<GoalDetailLoaderData> {
    const { householdId, ssrFetch } = await getSSRContext(request);
    const goalId = params.id as string;

    try {
        const [goalRes, tsRes, trRes, acRes, memRes] = await Promise.all([
            ssrFetch(`/portfolio/subportfolios/${goalId}`),
            ssrFetch(`/portfolio/snapshots/household/${householdId}/timeseries`),
            ssrFetch(`/portfolio/trades/household/${householdId}`),
            ssrFetch(`/accounts/household/${householdId}`),
            ssrFetch(`/users/householdmember/${householdId}`),
        ]);

        const [goal, timeseries, trades, accounts, members] = await Promise.all([
            goalRes.ok ? goalRes.json() : null,
            tsRes.ok ? tsRes.json() : [],
            trRes.ok ? trRes.json() : [],
            acRes.ok ? acRes.json() : [],
            memRes.ok ? memRes.json() : [],
        ]);

        return { goal, timeseries, trades: trades.filter((t: TradeResponse) => t.sub_portfolio_id === goalId), accounts, members };
    } catch (error) {
        if (error instanceof Response) throw error;
        console.error("Failed to load goal detail", error);
        return { goal: null, timeseries: [], trades: [], accounts: [], members: [] };
    }
}

export async function goalDetailAction({ request, params }: ActionFunctionArgs) {
    const { ssrFetch } = await getSSRContext(request);
    const goalId = params.id as string;
    const formData = await request.formData();
    const intent = formData.get("_intent");

    if (intent === "updateGoal") {
        const res = await ssrFetch(`/portfolio/subportfolios/${goalId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: formData.get("name"),
                target_amount: parseFloat(formData.get("target_amount") as string) || null,
                target_date: formData.get("target_date") || null,
            }),
        });
        if (!res.ok) return { error: "Failed to update goal" };
        return { success: true };
    }

    if (intent === "deleteGoal") {
        const res = await ssrFetch(`/portfolio/subportfolios/${goalId}`, { method: "DELETE" });
        if (!res.ok) return { error: "Failed to delete goal. Goals with trades or funding activity can't be deleted." };
        throw redirect("/goals");
    }

    return { error: "Invalid intent" };
}

