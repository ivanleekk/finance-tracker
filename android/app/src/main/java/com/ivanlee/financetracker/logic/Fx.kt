package com.ivanlee.financetracker.logic

import kotlin.math.abs

/**
 * What a foreign-currency charge looks like to a form.
 *
 * A charge carries two currencies: the one the merchant billed in, and the one the account is
 * denominated in. Three small judgements fall out of that, and all three clients make them
 * identically.
 *
 * The conversion itself is emphatically *not* here. A rate is a fact about a date that only the
 * backend can look up, and a client that computed its own would be guessing — these helpers only
 * describe the rate the user's own two figures already imply.
 *
 * A port of `frontend/src/lib/fx.ts` and `ios/FinanceTracker/Support/Fx.swift`; keep the three
 * in step.
 */
object Fx {
    /**
     * Does this charge need converting at all? A blank currency on either side is a form that has
     * not finished loading, not a foreign charge.
     */
    fun isForeignCharge(chargeCurrency: String?, accountCurrency: String?): Boolean {
        if (chargeCurrency.isNullOrEmpty() || accountCurrency.isNullOrEmpty()) return false
        return chargeCurrency != accountCurrency
    }

    /**
     * The rate two figures imply: what the account was charged, over what the merchant billed.
     * Null whenever they cannot imply one.
     *
     * This is the rate the *statement* implies, so the card's spread is inside it — which is the
     * point of asking for the charged amount rather than looking a mid-market close up.
     */
    fun impliedRate(amount: Double?, charged: Double?): Double? {
        if (amount == null || charged == null) return null
        if (!amount.isFinite() || !charged.isFinite()) return null
        if (amount <= 0 || charged <= 0) return null
        return charged / amount
    }

    /**
     * A rate rendered without trailing noise: "0.0104", "149.23", "2".
     *
     * A rate below 1 spends its information after the decimal point — JPY→SGD is 0.0104, and four
     * places would round two currencies together — while one above 1 does not. Four and six,
     * nothing cleverer, because three clients have to agree on it exactly.
     */
    fun formatRate(rate: Double): String {
        val decimals = if (rate >= 1) 4 else 6
        var text = String.format(java.util.Locale.US, "%.${decimals}f", rate)
        if (text.contains(".")) {
            text = text.trimEnd('0').trimEnd('.')
        }
        return text
    }

    /**
     * The hint a form shows back before the user commits: "1 JPY = 0.0104 SGD".
     *
     * Empty when there is no rate yet. It exists because a mistyped charged amount is otherwise an
     * entirely plausible-looking rate that nobody notices — wrong in a way the two amounts it came
     * from are not.
     */
    fun impliedRateLabel(
        amount: Double?,
        charged: Double?,
        chargeCurrency: String,
        accountCurrency: String,
    ): String {
        val rate = impliedRate(amount, charged) ?: return ""
        if (chargeCurrency.isEmpty() || accountCurrency.isEmpty()) return ""
        return "1 $chargeCurrency = ${formatRate(rate)} $accountCurrency"
    }
}
