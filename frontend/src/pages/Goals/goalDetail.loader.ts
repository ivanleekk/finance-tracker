import { getSSRContext } from "../../lib/ssr-helpers";
import type { LoaderFunctionArgs } from "react-router";
import type { SubPortfolioResponse, PortfolioSnapshotResponse, TradeResponse, AccountResponse, HouseholdMemberUserResponse } from "../../types/types";

export type GoalDetailLoaderData = {
    goal: SubPortfolioResponse | null;
    snapshots: PortfolioSnapshotResponse[];
    trades: TradeResponse[];
    accounts: AccountResponse[];
    members: HouseholdMemberUserResponse[];
};

export async function goalDetailLoader({ request, params }: LoaderFunctionArgs): Promise<GoalDetailLoaderData> {
    const { householdId, ssrFetch } = await getSSRContext(request);
    const goalId = params.id as string;

    try {
        const [goalRes, snRes, trRes, acRes, memRes] = await Promise.all([
            ssrFetch(`/portfolio/subportfolios/${goalId}`),
            ssrFetch(`/portfolio/snapshots/household/${householdId}`),
            ssrFetch(`/portfolio/trades/household/${householdId}`),
            ssrFetch(`/accounts/household/${householdId}`),
            ssrFetch(`/users/householdmember/${householdId}`),
        ]);

        const [goal, snapshots, trades, accounts, members] = await Promise.all([
            goalRes.ok ? goalRes.json() : null,
            snRes.ok ? snRes.json() : [],
            trRes.ok ? trRes.json() : [],
            acRes.ok ? acRes.json() : [],
            memRes.ok ? memRes.json() : [],
        ]);

        return { goal, snapshots, trades: trades.filter((t: TradeResponse) => t.sub_portfolio_id === goalId), accounts, members };
    } catch (error) {
        if (error instanceof Response) throw error;
        console.error("Failed to load goal detail", error);
        return { goal: null, snapshots: [], trades: [], accounts: [], members: [] };
    }
}

