import { getSSRContext } from "../../lib/ssr-helpers";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import type { CurrencyResponse, CountryResponse } from "../../types/types";

export type OnboardingLoaderData = {
    currencies: CurrencyResponse[];
    countries: CountryResponse[];
    userName: string;
};

export async function onboardingLoader({ request }: LoaderFunctionArgs): Promise<OnboardingLoaderData> {
    const { ssrFetch } = await getSSRContext(request);

    const [curRes, countryRes, userRes] = await Promise.all([
        ssrFetch("/reference/currencies"),
        ssrFetch("/reference/countries"),
        ssrFetch("/users"),
    ]);

    return {
        currencies: curRes.ok ? await curRes.json() : [],
        countries: countryRes.ok ? await countryRes.json() : [],
        userName: userRes.ok ? (await userRes.json()).name : "",
    };
}

export async function onboardingAction({ request }: ActionFunctionArgs) {
    const { ssrFetch } = await getSSRContext(request);
    const formData = await request.formData();
    const intent = formData.get("_intent");

    if (intent === "fastSetup") {
        const base_currency = formData.get("base_currency") as string;
        const country_code = formData.get("country_code") as string;
        const householdName = (formData.get("household_name") as string) || "My finances";
        const defaultPrivate = formData.get("default_new_items_private") === "on";

        const hhRes = await ssrFetch("/users/households", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: householdName, base_currency, country_code }),
        });
        if (!hhRes.ok) return { error: "Failed to create household" };
        const household = await hhRes.json();

        await ssrFetch("/users", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ default_new_items_private: defaultPrivate }),
        });

        const presetNames = formData.getAll("preset_account") as string[];
        for (const name of presetNames) {
            const balance = parseFloat((formData.get(`balance_${name}`) as string) || "0") || 0;
            const accRes = await ssrFetch("/accounts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    household_id: household.id,
                    name,
                    liquidity: "liquid",
                    tax_status: "taxable",
                    currency: base_currency,
                    owner_user_id: defaultPrivate ? (formData.get("current_user_id") as string) : null,
                }),
            });
            if (accRes.ok) {
                const acc = await accRes.json();
                await ssrFetch("/accounts/balances", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ account_id: acc.id, date: new Date().toISOString().split("T")[0], balance }),
                });
            }
        }

        return { success: true, householdId: household.id, householdName: household.name };
    }

    if (intent === "finishHousehold") {
        const household_id = formData.get("household_id") as string;
        const name = formData.get("name") as string;
        const inviteEmail = formData.get("invite_email") as string;

        if (name) {
            await ssrFetch(`/users/households/${household_id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name }),
            });
        }
        if (inviteEmail) {
            await ssrFetch(`/users/households/${household_id}/invites`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: inviteEmail, role: "editor" }),
            });
        }
        return { success: true };
    }

    return { error: "Invalid intent" };
}
