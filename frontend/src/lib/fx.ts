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

/**
 * What a card's surcharge comes to, in the account's own currency.
 *
 * Charged on the *converted* purchase, because that is what the card bills a
 * percentage of — the fee on a ¥12,000 dinner settled at S$124.80 is 3% of
 * S$124.80, not of the yen. Null when there is no fee to show, which is the
 * normal case.
 *
 * This mirrors `fee_amount` in `backend/src/services/transaction_service.py`:
 * the server computes the figure that is actually posted, and this is only so
 * a form can show the user what they are about to agree to. Ported to
 * `ios/.../Support/Fx.swift` and `android/.../logic/Fx.kt`.
 */
export function feeAmount(
    amountInAccountCurrency: number | null | undefined,
    feePercent: number | null | undefined,
): number | null {
    if (amountInAccountCurrency === null || amountInAccountCurrency === undefined) return null;
    if (feePercent === null || feePercent === undefined) return null;
    if (!Number.isFinite(amountInAccountCurrency) || !Number.isFinite(feePercent)) return null;
    if (amountInAccountCurrency <= 0 || feePercent <= 0) return null;
    return Math.round(amountInAccountCurrency * feePercent) / 100;
}

/**
 * The fee a new charge's form fills in from its card: the card's
 * foreign-transaction fee, for a foreign charge. Null when there is nothing to
 * fill in — a domestic charge, no card, or no default on it.
 *
 * Mirrors `default_fee_percent` in `backend/src/services/transaction_service.py`,
 * which applies the same figure to a foreign charge created with no fee. The
 * form shows it so the user can change it or clear it (to 0) before saving.
 * Ported to `ios/.../Support/Fx.swift` and `android/.../logic/Fx.kt`.
 */
export function defaultFeePercent(
    cardForeignFeePercent: number | string | null | undefined,
    chargeCurrency: string | null | undefined,
    accountCurrency: string | null | undefined,
): number | null {
    if (!isForeignCharge(chargeCurrency, accountCurrency)) return null;
    if (cardForeignFeePercent === null || cardForeignFeePercent === undefined || cardForeignFeePercent === "") return null;
    const value = Number(cardForeignFeePercent);
    return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * The currency and fee fields of a recurring rule's request body.
 *
 * A rule's form holds `currency` as "" for "the account's own" — so it follows
 * the account picker for free — or a code. A code equal to the account's
 * currency means the same thing and is sent the same way.
 *
 * The fee is three ways on a rule, and blank is not zero: blank means "use the
 * card's foreign-transaction fee at each posting, if it has one", 0 means "no
 * fee", and a number is that fee. That mirrors the backend, where a rule with
 * `fee_percent` null takes the card's default and 0 does not.
 *
 * On create, anything with nothing to say is omitted. On update every key is
 * sent, because an omitted key means "keep what the rule has" and there would be
 * no way to switch a rule back to its account's currency, or back to the card's
 * default fee.
 */
export function ruleFxFields(
    form: { currency: string; feePercent: string },
    accountCurrency: string | null | undefined,
    mode: "create" | "update",
): { currency?: string | null; fee_percent?: number | null } {
    const foreign = isForeignCharge(form.currency || null, accountCurrency) ? form.currency : null;
    const raw = form.feePercent.trim();
    const parsed = raw === "" ? null : Number(raw);
    const fee = parsed !== null && Number.isFinite(parsed) ? parsed : null;
    if (mode === "update") return { currency: foreign, fee_percent: fee };
    return {
        ...(foreign ? { currency: foreign } : {}),
        ...(fee !== null ? { fee_percent: fee } : {}),
    };
}
