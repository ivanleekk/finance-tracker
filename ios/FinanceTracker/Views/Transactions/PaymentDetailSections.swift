import SwiftUI

/// The two things a form records *about a payment* rather than about a
/// schedule: which of a card's own categories it counts towards, and the
/// merchant code the acquirer assigned.
///
/// Extracted so the transaction form, Quick Add and the recurring-rule form
/// state them identically. They were only on the transaction form, which meant
/// the two faster ways to log a payment quietly couldn't record either — and a
/// rule, which describes a payment that repeats, couldn't record them at all.

/// The card-category picker, shown only when the selected account is a card.
///
/// The headroom sits in each row because this is the one moment the number can
/// still change the decision: a meter you have to go and look at will not stop
/// anyone overspending.
struct CardCategorySection: View {
    let card: CardResponse?
    let headroom: [String: [CardLimitStatusRow]]
    let currency: String
    @Binding var cardCategoryId: String
    /// Rules post on a schedule rather than at a moment, so the cycle's
    /// remaining headroom is not the number to put in front of someone editing
    /// one — it will have moved by the time the rule fires.
    var showsHeadroom: Bool = true

    var body: some View {
        if let card {
            Section {
                Picker("Card category", selection: $cardCategoryId) {
                    Text("Card's default").tag("")
                    ForEach(card.categories) { category in
                        Text(label(for: category)).tag(category.id)
                    }
                }
            } footer: {
                Text("Which of this card's own categories the spend counts towards.")
            }
        }
    }

    private func label(for category: CardCategoryResponse) -> String {
        guard showsHeadroom else { return category.name }
        return Cards.pickerLabel(for: category, headroom: headroom) { $0.currencyWhole(currency) }
    }
}

/// The optional merchant code, shown only to users who asked for it.
///
/// A four-digit code field on every form would tax everyone for a minority
/// feature, so it is hidden rather than shown-and-skipped — see
/// `User.record_merchant_codes`.
struct MerchantCodeSection: View {
    @Environment(SessionStore.self) private var session
    @Binding var mcc: String
    /// What the code will be attached to, for the footer's wording.
    var subject: String = "it"

    var body: some View {
        if session.user?.recordsMerchantCodes == true {
            Section {
                NavigationLink {
                    ReferencePicker(
                        title: "Merchant Code",
                        path: "/reference/mccs",
                        selection: $mcc,
                        id: \ReferenceMcc.code,
                        label: { "\($0.code) — \($0.name)" },
                        searchText: { "\($0.code) \($0.name) \($0.group)" }
                    )
                } label: {
                    LabeledContent("Merchant code", value: mcc.isEmpty ? "Not recorded" : mcc)
                }
            } footer: {
                Text("Optional. Recorded only — nothing is calculated from \(subject).")
            }
        }
    }
}

/// The currency a charge happened in, and — when that isn't the account's own —
/// what the account was actually charged.
///
/// Shared by the transaction form and Quick Add for the same reason the two
/// sections above are: a charge in a foreign currency is not a rare enough
/// thing to be loggable from only one of the ways you can log a payment.
///
/// The charged amount is optional and the form works without it: left blank,
/// the backend pulls the spot rate for the transaction's date. Given, it is the
/// better answer, because the card's spread is already inside it.
struct ForeignChargeSection: View {
    /// The currency of the selected account. Empty while nothing is selected.
    let accountCurrency: String
    /// The amount as currently typed, for the rate hint.
    let amount: Double?
    @Binding var currency: String
    @Binding var amountChargedText: String

    private var isForeign: Bool {
        Fx.isForeignCharge(currency, accountCurrency: accountCurrency)
    }

    private var rateHint: String {
        Fx.impliedRateLabel(
            amount: amount,
            charged: CalculatorInput.evaluateArithmeticExpression(amountChargedText),
            chargeCurrency: currency,
            accountCurrency: accountCurrency
        )
    }

    var body: some View {
        Section {
            NavigationLink {
                ReferencePicker(
                    title: "Charged In",
                    path: "/reference/currencies",
                    selection: $currency,
                    id: \ReferenceCurrency.code,
                    label: { "\($0.code) — \($0.name)" },
                    searchText: { "\($0.code) \($0.name)" }
                )
            } label: {
                LabeledContent("Charged in", value: currency.isEmpty ? accountCurrency : currency)
            }

            if isForeign {
                HStack {
                    Text("Charged to account")
                    CalculatorField(placeholder: accountCurrency, text: $amountChargedText)
                        .multilineTextAlignment(.trailing)
                }
            }
        } footer: {
            if isForeign {
                Text(
                    rateHint.isEmpty
                        ? "Optional. Leave blank to convert at the \(currency) rate for this date."
                        : "\(rateHint) — the rate your statement implies, spread included."
                )
            }
        }
    }
}


/// A surcharge the card adds on top of a purchase, as a percentage.
///
/// Not part of `ForeignChargeSection` above, despite usually appearing with
/// one: a card can surcharge a domestic transaction too, and hiding the field
/// behind a currency mismatch would make those unrecordable.
///
/// The money posts as its own row under "Card Fees" rather than inflating the
/// purchase, so the amount on this form keeps matching the receipt.
struct CardFeeSection: View {
    /// The account-currency value of the purchase, for the money hint. Nil when
    /// only the server knows it — a foreign charge with no charged amount typed.
    let amountInAccountCurrency: Double?
    let accountCurrency: String
    @Binding var feePercentText: String

    private var feeHint: String {
        guard let fee = Fx.feeAmount(
            amountInAccountCurrency: amountInAccountCurrency,
            feePercent: CalculatorInput.evaluateArithmeticExpression(feePercentText)
        ) else { return "" }
        return fee.currency(accountCurrency)
    }

    var body: some View {
        Section {
            HStack {
                Text("Card fee")
                CalculatorField(placeholder: "0%", text: $feePercentText)
                    .multilineTextAlignment(.trailing)
                Text("%").foregroundStyle(.secondary)
            }
        } footer: {
            Text(
                feeHint.isEmpty
                    ? "Optional. Some cards add a percentage on top — a foreign transaction fee, a surcharge."
                    : "Posts a separate \(feeHint) row under Card Fees, so this purchase keeps the amount on your receipt."
            )
        }
    }
}
