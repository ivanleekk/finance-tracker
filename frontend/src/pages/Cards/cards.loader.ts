import { redirect, type LoaderFunctionArgs, type ActionFunctionArgs } from "react-router";
import type { AccountResponse, CardResponse, CardStatusResponse } from "../../types/types";
import { getSSRContext } from "../../lib/ssr-helpers";
import { cardUpdateBody, foreignFeePercent } from "./cardForms";

export type CardsLoaderData = {
    cards: CardResponse[];
    /** One status per card, keyed by card id. */
    statuses: Record<string, CardStatusResponse>;
    /** Liability accounts with no card yet — the candidates for setting one up. */
    availableAccounts: AccountResponse[];
};

export async function loader({ request }: LoaderFunctionArgs): Promise<CardsLoaderData> {
    const { householdId, ssrFetch } = await getSSRContext(request);
    if (!householdId) throw redirect("/households");

    const [cardsRes, accountsRes] = await Promise.all([
        ssrFetch(`/cards/household/${householdId}`),
        ssrFetch(`/accounts/household/${householdId}`),
    ]);

    const cards: CardResponse[] = cardsRes.ok ? await cardsRes.json() : [];
    const accounts: AccountResponse[] = accountsRes.ok ? await accountsRes.json() : [];

    // One request per card, in parallel. Each is a small aggregate over one
    // account's cycle, and a household has a handful of cards rather than a
    // list that grows — so fanning out here is cheaper than a bespoke bulk
    // endpoint that only this page would ever call.
    const statusResults = await Promise.all(
        cards.map(async card => {
            const res = await ssrFetch(`/cards/${card.id}/status`);
            return res.ok ? ([card.id, await res.json()] as const) : null;
        })
    );

    const withCards = new Set(cards.map(c => c.financial_account_id));

    return {
        cards,
        statuses: Object.fromEntries(statusResults.filter(r => r !== null)),
        availableAccounts: accounts.filter(
            a => a.kind === "liability" && !withCards.has(a.id)
        ),
    };
}

/** Turn a failed response into the message the server actually gave. */
async function fail(res: Response, fallback: string) {
    const detail = await res.json().catch(() => null);
    return { error: detail?.detail || fallback };
}

export async function action({ request }: ActionFunctionArgs) {
    const { ssrFetch } = await getSSRContext(request);
    const formData = await request.formData();
    const intent = formData.get("_intent");

    if (intent === "createCard") {
        const res = await ssrFetch("/cards", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                financial_account_id: formData.get("financial_account_id"),
                cycle_basis: formData.get("cycle_basis") || "statement",
                statement_day: Number(formData.get("statement_day")) || 1,
                anniversary_date: formData.get("anniversary_date") || null,
                foreign_fee_percent: foreignFeePercent(formData),
            }),
        });
        if (!res.ok) return fail(res, "Couldn't set up that card.");
        return { success: true };
    }

    if (intent === "updateCard") {
        const res = await ssrFetch(`/cards/${formData.get("cardId")}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(cardUpdateBody(formData)),
        });
        if (!res.ok) return fail(res, "Couldn't update the card.");
        return { success: true };
    }

    if (intent === "deleteCard") {
        const res = await ssrFetch(`/cards/${formData.get("cardId")}`, { method: "DELETE" });
        if (!res.ok) return fail(res, "Couldn't remove that card.");
        return { success: true };
    }

    if (intent === "createLimit") {
        const res = await ssrFetch(`/cards/${formData.get("cardId")}/limits`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: formData.get("name"),
                amount: Number(formData.get("amount")),
                direction: formData.get("direction") || "ceiling",
                reset_basis: formData.get("reset_basis") || "cycle",
                category_ids: formData.getAll("category_ids").map(String),
            }),
        });
        if (!res.ok) return fail(res, "Couldn't add that limit.");
        return { success: true };
    }

    if (intent === "updateLimitCategories") {
        // Always a full list — an unticked form means "counts nothing", and
        // sending `[]` is how the API is told that rather than "leave it alone".
        const res = await ssrFetch(`/cards/limits/${formData.get("limitId")}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ category_ids: formData.getAll("category_ids").map(String) }),
        });
        if (!res.ok) return fail(res, "Couldn't update that limit's categories.");
        return { success: true };
    }

    if (intent === "deleteLimit") {
        const res = await ssrFetch(`/cards/limits/${formData.get("limitId")}`, {
            method: "DELETE",
        });
        if (!res.ok) return fail(res, "Couldn't remove that limit.");
        return { success: true };
    }

    if (intent === "createCategory") {
        const res = await ssrFetch(`/cards/${formData.get("cardId")}/categories`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: formData.get("name") }),
        });
        if (!res.ok) return fail(res, "Couldn't add that category.");
        return { success: true };
    }

    if (intent === "updateCategory") {
        const body: Record<string, unknown> = {};
        // Only the keys the form actually submitted.
        if (formData.has("name")) body.name = formData.get("name");
        if (formData.get("make_default") === "on") body.is_default = true;

        const res = await ssrFetch(`/cards/categories/${formData.get("categoryId")}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!res.ok) return fail(res, "Couldn't update that category.");
        return { success: true };
    }

    if (intent === "deleteCategory") {
        const res = await ssrFetch(`/cards/categories/${formData.get("categoryId")}`, {
            method: "DELETE",
        });
        if (!res.ok) return fail(res, "Couldn't remove that category.");
        return { success: true };
    }

    return { error: "Invalid intent" };
}
