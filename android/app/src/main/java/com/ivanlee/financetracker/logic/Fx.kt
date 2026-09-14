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
     * What a card's surcharge comes to, in the account's own currency.
     *
     * Charged on the *converted* purchase, because that is what the card bills a percentage of —
     * the fee on a ¥12,000 dinner settled at S$124.80 is 3% of S$124.80, not of the yen. Null
     * when there is no fee to show.
     *
     * Mirrors `fee_amount` in the backend's `transaction_service.py`: the server computes the
     * figure that is actually posted, and this exists only so a form can show what the user is
     * about to agree to.
     */
    fun feeAmount(amountInAccountCurrency: Double?, feePercent: Double?): Double? {
        if (amountInAccountCurrency == null || feePercent == null) return null
        if (!amountInAccountCurrency.isFinite() || !feePercent.isFinite()) return null
        if (amountInAccountCurrency <= 0 || feePercent <= 0) return null
        return Math.round(amountInAccountCurrency * feePercent) / 100.0
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

    /**
     * Whether a row belongs to a transfer: one of its two legs, or the "FX Conversion" row a
     * cross-currency transfer posts beside its withdrawal (a fee row whose parent is a transfer
     * leg). The backend refuses to edit any of them (409) and deletes the whole set when one is
     * deleted, so the Activity list treats all three the way it already treats a leg. A card
     * surcharge is a fee row too, but its parent is an ordinary purchase, so it is not caught.
     *
     * Ported from `transfer_id_of` in the backend's `transaction_service.py`; iOS's twin is
     * `Fx.isPartOfTransfer` in `Support/Fx.swift`.
     */
    fun isPartOfTransfer(
        transferId: String?,
        feeForTransactionId: String?,
        transferIdOf: (String) -> String?,
    ): Boolean {
        if (transferId != null) return true
        val parent = feeForTransactionId ?: return false
        return transferIdOf(parent) != null
    }

    /**
     * The fee a new charge's form fills in from its card: the card's foreign-transaction fee,
     * for a foreign charge. Null when there is nothing to fill in — a domestic charge, no card,
     * or no default on it.
     *
     * Mirrors `default_fee_percent` in the backend's `transaction_service.py`, which applies the
     * same figure to a foreign charge created with no fee. Ported from `defaultFeePercent` in
     * `frontend/src/lib/fx.ts`; iOS's twin is in `Support/Fx.swift`.
     */
    fun defaultFeePercent(cardForeignFeePercent: Double?, chargeCurrency: String?, accountCurrency: String?): Double? {
        if (!isForeignCharge(chargeCurrency, accountCurrency)) return null
        val fee = cardForeignFeePercent ?: return null
        return if (fee.isFinite() && fee > 0) fee else null
    }

    /**
     * The currency a recurring rule's form sends: the picked code when it is foreign to the
     * account, null for the account's own — whether the picker was left alone ("") or the
     * account's currency was picked explicitly. Ported from `ruleFxFields` in
     * `frontend/src/lib/fx.ts`; iOS's twin is in `Support/Fx.swift`.
     */
    fun ruleCurrency(picked: String, accountCurrency: String): String? =
        if (isForeignCharge(picked.ifEmpty { null }, accountCurrency)) picked else null

    /** A rule's fee field as sent: blank is null — the card's foreign fee applies — else the typed percentage, 0 included. */
    fun ruleFeePercent(text: String): Double? =
        text.trim().takeIf { it.isNotEmpty() }?.let { CalculatorInput.evaluateArithmeticExpression(it) }
}
