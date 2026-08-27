import type { LoaderFunctionArgs } from "react-router";
import type { MccResponse } from "../../types/types";
import { getSSRContext } from "../../lib/ssr-helpers";

/**
 * Resource route for the merchant category code catalogue.
 *
 * Deliberately not part of the Transactions page loader. The catalogue is ~70KB
 * and the field it feeds is hidden unless the user turned `record_merchant_codes`
 * on — which most people never do, because most people don't know the code for
 * most purchases. Loading it with the page would tax every user on every visit
 * for a minority feature, which is the exact cost the feature was designed to
 * avoid by hiding the field in the first place. iOS and Android already skip the
 * fetch when the setting is off; this is the web equivalent.
 *
 * Fetched on demand when the log dialog opens, through a route loader rather
 * than a client-side call, so cookie forwarding and the SSR paradigm stay intact.
 * The rows are static and identical for everyone, so the browser caches them and
 * a second open costs nothing.
 */
export async function loader({ request }: LoaderFunctionArgs) {
    const { ssrFetch } = await getSSRContext(request);

    const response = await ssrFetch(`/reference/mccs`);
    if (!response.ok) {
        // A missing catalogue makes the picker empty, not the form unusable —
        // the code is optional, so failing softly is the honest behaviour.
        return { mccs: [] as MccResponse[] };
    }

    const mccs: MccResponse[] = await response.json();
    return { mccs };
}
