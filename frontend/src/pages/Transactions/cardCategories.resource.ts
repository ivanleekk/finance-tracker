import type { LoaderFunctionArgs } from "react-router";
import type { CardResponse, CardStatusResponse } from "../../types/types";
import { getSSRContext } from "../../lib/ssr-helpers";

export type CardPickerData = {
    card: CardResponse | null;
    status: CardStatusResponse | null;
};

/**
 * The card (if any) behind one account, with this cycle's headroom.
 *
 * Loaded on demand when a card account is selected in the transaction form,
 * not with the Transactions page: most accounts are not cards, most households
 * have none, and putting it in the page loader would charge every visit for
 * something only some entries use. Same reasoning as the merchant-code
 * catalogue next door.
 *
 * Returns `card: null` rather than a 404 for an ordinary bank account — "this
 * account has no card" is the common answer, not an error.
 */
export async function loader({ request, params }: LoaderFunctionArgs): Promise<CardPickerData> {
    const { householdId, ssrFetch } = await getSSRContext(request);
    if (!householdId) return { card: null, status: null };

    const cardsRes = await ssrFetch(`/cards/household/${householdId}`);
    if (!cardsRes.ok) return { card: null, status: null };

    const cards: CardResponse[] = await cardsRes.json();
    const card = cards.find(c => c.financial_account_id === params.accountId) ?? null;
    if (!card) return { card: null, status: null };

    const statusRes = await ssrFetch(`/cards/${card.id}/status`);
    return { card, status: statusRes.ok ? await statusRes.json() : null };
}
