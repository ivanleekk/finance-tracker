import { getSSRContext } from "../../lib/ssr-helpers";
import type { LoaderFunctionArgs } from "react-router";
import type { HouseholdResponse } from "../../types/types";

export async function householdsLoader({ request }: LoaderFunctionArgs) {
    const { ssrFetch } = await getSSRContext(request);

    try {
        const response = await ssrFetch("/users/households");
        if (!response.ok) {
             throw new Error("Failed to fetch households");
        }
        const households: HouseholdResponse[] = await response.json();
        return households;
    } catch (error) {
        if (error instanceof Response) throw error; // Handle redirect
        console.error("Failed to load households", error);
        return [];
    }
}
