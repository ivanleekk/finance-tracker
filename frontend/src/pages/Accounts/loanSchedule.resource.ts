import type { LoaderFunctionArgs } from "react-router";
import type { LoanScheduleResponse } from "../../types/types";
import { getSSRContext } from "../../lib/ssr-helpers";

/**
 * Resource route for a single loan's amortization schedule.
 *
 * A 30-year mortgage is 360 rows, so it isn't worth loading with the Accounts
 * page — the user only wants it when they open the schedule modal. Fetching it
 * through a route loader (rather than a client-side call) keeps cookie
 * forwarding and the SSR paradigm intact.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
    const { ssrFetch } = await getSSRContext(request);

    const response = await ssrFetch(`/accounts/${params.accountId}/loan-schedule`);
    if (!response.ok) {
        const detail = await response.json().catch(() => null);
        return { error: detail?.detail || "Could not load the loan schedule.", schedule: null };
    }

    const schedule: LoanScheduleResponse = await response.json();
    return { error: null, schedule };
}
