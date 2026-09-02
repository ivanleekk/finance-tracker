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
    let headroom: [String: CardLimitStatusRow]
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
        guard showsHeadroom, let row = headroom[category.id] else { return category.name }
        return "\(category.name) · \(Cards.headroomLabel(for: row) { $0.currencyWhole(currency) })"
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
