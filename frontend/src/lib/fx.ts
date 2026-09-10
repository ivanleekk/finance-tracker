/**
 * What a foreign-currency charge looks like to a form, in all three clients.
 *
 * A charge carries two currencies: the one the merchant billed in, and the one
 * the account is denominated in. Three small judgements fall out of that, and
 * all three clients make them identically — so they live here, with ports in
 * `ios/FinanceTracker/Support/Fx.swift` and `android/.../logic/Fx.kt`.
 *
 * The conversion itself is emphatically *not* here. A rate is a fact about a
 * date that only the backend can look up, and a client that computed its own
 * would be guessing — these helpers only describe the rate the user's own two
 * figures already imply.
 */

/** Does this charge need converting at all? A blank charge currency means "the account's own". */
export function isForeignCharge(chargeCurrency: string | null | undefined, accountCurrency: string | null | undefined): boolean {
    if (!chargeCurrency || !accountCurrency) return false;
    return chargeCurrency !== accountCurrency;
}

/**
 * The rate two figures imply: what the account was charged, over what the
 * merchant billed.
 *
 * Null whenever they can't imply one — either figure missing or not positive.
 * This is the rate the *statement* implies, so the card's spread is inside it;
 * that is the point of asking for the charged amount rather than looking a
 * mid-market close up.
 */
export function impliedRate(amount: number | null | undefined, charged: number | null | undefined): number | null {
    if (amount === null || amount === undefined || charged === null || charged === undefined) return null;
    if (!Number.isFinite(amount) || !Number.isFinite(charged)) return null;
    if (amount <= 0 || charged <= 0) return null;
    return charged / amount;
}

/**
 * How many decimals a rate is worth showing to.
 *
 * A rate below 1 spends its information after the decimal point — JPY→SGD is
 * 0.0104, and four places would round two currencies together — while one above
 * 1 does not. Four and six, nothing cleverer, because three clients have to
 * agree on it exactly.
 */
function rateDecimals(rate: number): number {
    return rate >= 1 ? 4 : 6;
}

/** A rate rendered without trailing noise: "0.0104", "149.2", "1.35". */
export function formatRate(rate: number): string {
    const fixed = rate.toFixed(rateDecimals(rate));
    return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
}

/**
 * The rate hint a form shows back before the user commits: "1 JPY = 0.0104 SGD".
 *
 * Empty when there is no rate yet. It exists because a mistyped charged amount
 * is otherwise an entirely plausible-looking rate that nobody notices — the
 * figure is wrong in a way the two amounts it came from are not.
 */
export function impliedRateLabel(
    amount: number | null | undefined,
    charged: number | null | undefined,
    chargeCurrency: string,
    accountCurrency: string,
): string {
    const rate = impliedRate(amount, charged);
    if (rate === null || !chargeCurrency || !accountCurrency) return "";
    return `1 ${chargeCurrency} = ${formatRate(rate)} ${accountCurrency}`;
}
