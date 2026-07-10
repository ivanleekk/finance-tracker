import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { getSSRContext } from "../../lib/ssr-helpers";
import type { HouseholdReportResponse } from "../../types/types";

export type ReportsLoaderData = {
    report: HouseholdReportResponse | null;
};

export async function reportsLoader({ request }: LoaderFunctionArgs): Promise<ReportsLoaderData | Response> {
    const { householdId, ssrFetch } = await getSSRContext(request);
    if (!householdId) return redirect("/onboarding");

    const url = new URL(request.url);
    const params = new URLSearchParams();
    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    const query = params.size > 0 ? `?${params}` : "";

    try {
        const res = await ssrFetch(`/exports/household/${householdId}/report${query}`);
        if (res.status === 401) return redirect("/login");
        if (!res.ok) return { report: null };
        return { report: await res.json() };
    } catch (error) {
        if (error instanceof Response) throw error;
        console.error("Failed to load report", error);
        return { report: null };
    }
}
