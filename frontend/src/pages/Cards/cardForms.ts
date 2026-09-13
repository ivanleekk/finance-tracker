import type { SelectOption } from "../../components/ui/Select";

/**
 * Form helpers for the Cards dialogs, kept out of the components so the rules
 * that decide what gets sent can be tested without rendering anything.
 */

const ANNIVERSARY_HINT = " — set the card's anniversary first";

/**
 * Every reset basis, with the two anniversary ones disabled until the card has
 * a date. Disabled rather than hidden, so the option is discoverable; the
 * server refuses them without a date anyway, and this keeps that a backstop.
 */
export function resetOptions(hasAnniversary: boolean): SelectOption[] {
    const hint = hasAnniversary ? "" : ANNIVERSARY_HINT;
    return [
        { value: "cycle", label: "Resets each statement cycle" },
        { value: "calendar_month", label: "Resets each calendar month" },
        { value: "quarter", label: "Resets each quarter" },
        { value: "year", label: "Resets each year" },
        { value: "card_year", label: `Resets each card year${hint}`, disabled: !hasAnniversary },
        { value: "card_quarter", label: `Resets each card quarter${hint}`, disabled: !hasAnniversary },
    ];
}

/**
 * The PUT /cards/{id} body from the card-settings form.
 *
 * The form always states the anniversary and the foreign fee, so an empty field is an explicit
 * `null` — the backend's "clear it", as opposed to an omitted key, which would
 * preserve it. The statement day is omitted whenever `Number(...)` on it is
 * falsy — not just when a calendar-basis card hides the field, but also when a
 * statement-basis card's visible field is cleared to empty. Either way there is
 * no value to send, and omitting the key preserves whatever the card already
 * has rather than sending a `0` the backend would reject.
 */
export function cardUpdateBody(formData: FormData): Record<string, unknown> {
    const anniversary = String(formData.get("anniversary_date") ?? "").trim();
    const day = Number(formData.get("statement_day"));
    return {
        cycle_basis: formData.get("cycle_basis"),
        ...(day ? { statement_day: day } : {}),
        anniversary_date: anniversary || null,
        foreign_fee_percent: foreignFeePercent(formData),
    };
}

/**
 * The card's foreign-transaction fee from a form. Always stated, so an empty
 * field is an explicit `null` — clear it — like the anniversary above.
 */
export function foreignFeePercent(formData: FormData): number | null {
    const raw = String(formData.get("foreign_fee_percent") ?? "").trim();
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
}
