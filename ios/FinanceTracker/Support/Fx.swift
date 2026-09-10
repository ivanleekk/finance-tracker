import Foundation

/// What a foreign-currency charge looks like to a form.
///
/// A charge carries two currencies: the one the merchant billed in, and the one
/// the account is denominated in. Three small judgements fall out of that, and
/// all three clients make them identically.
///
/// The conversion itself is emphatically *not* here. A rate is a fact about a
/// date that only the backend can look up, and a client that computed its own
/// would be guessing — these helpers only describe the rate the user's own two
/// figures already imply.
///
/// A port of `frontend/src/lib/fx.ts` and `android/.../logic/Fx.kt`; keep the
/// three in step.
enum Fx {
    /// Does this charge need converting at all? A blank currency on either side
    /// is a form that has not finished loading, not a foreign charge.
    static func isForeignCharge(_ chargeCurrency: String?, accountCurrency: String?) -> Bool {
        guard let chargeCurrency, let accountCurrency,
              !chargeCurrency.isEmpty, !accountCurrency.isEmpty else { return false }
        return chargeCurrency != accountCurrency
    }

    /// The rate two figures imply: what the account was charged, over what the
    /// merchant billed. Nil whenever they cannot imply one.
    ///
    /// This is the rate the *statement* implies, so the card's spread is inside
    /// it — which is the point of asking for the charged amount rather than
    /// looking a mid-market close up.
    static func impliedRate(amount: Double?, charged: Double?) -> Double? {
        guard let amount, let charged,
              amount.isFinite, charged.isFinite,
              amount > 0, charged > 0 else { return nil }
        return charged / amount
    }

    /// A rate rendered without trailing noise: "0.0104", "149.23", "2".
    ///
    /// A rate below 1 spends its information after the decimal point — JPY→SGD
    /// is 0.0104, and four places would round two currencies together — while
    /// one above 1 does not. Four and six, nothing cleverer, because three
    /// clients have to agree on it exactly.
    static func formatRate(_ rate: Double) -> String {
        let decimals = rate >= 1 ? 4 : 6
        var text = String(format: "%.\(decimals)f", rate)
        if text.contains(".") {
            while text.hasSuffix("0") { text.removeLast() }
            if text.hasSuffix(".") { text.removeLast() }
        }
        return text
    }

    /// The hint a form shows back before the user commits: "1 JPY = 0.0104 SGD".
    ///
    /// Empty when there is no rate yet. It exists because a mistyped charged
    /// amount is otherwise an entirely plausible-looking rate that nobody
    /// notices — wrong in a way the two amounts it came from are not.
    static func impliedRateLabel(
        amount: Double?,
        charged: Double?,
        chargeCurrency: String,
        accountCurrency: String
    ) -> String {
        guard let rate = impliedRate(amount: amount, charged: charged),
              !chargeCurrency.isEmpty, !accountCurrency.isEmpty else { return "" }
        return "1 \(chargeCurrency) = \(formatRate(rate)) \(accountCurrency)"
    }
}
