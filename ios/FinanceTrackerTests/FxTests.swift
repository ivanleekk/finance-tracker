import Foundation
import Testing

@testable import FinanceTracker

/// Foreign-currency charges on a form (`Support/Fx.swift`). Twin of the web
/// `frontend/src/lib/fx.test.ts` and the Android `FxTest.kt` — the three must
/// agree about the same numbers and the same strings.
struct FxTests {
    @Test func aChargeInTheAccountsOwnCurrencyIsNotForeign() {
        #expect(Fx.isForeignCharge("SGD", accountCurrency: "SGD") == false)
    }

    @Test func bothCurrenciesHaveToBeKnownBeforeAChargeIsForeign() {
        #expect(Fx.isForeignCharge("JPY", accountCurrency: "SGD"))
        // An unknown currency on either side is a form that has not finished
        // loading; prompting for a converted amount there asks the user to
        // convert into nothing.
        #expect(Fx.isForeignCharge("JPY", accountCurrency: "") == false)
        #expect(Fx.isForeignCharge(nil, accountCurrency: "SGD") == false)
    }

    @Test func theRateIsWhatWasChargedOverWhatWasBilled() {
        let rate = try! #require(Fx.impliedRate(amount: 12000, charged: 124.80))
        #expect(abs(rate - 0.0104) < 1e-10)
    }

    @Test func thereIsNoRateWithoutTwoPositiveFigures() {
        #expect(Fx.impliedRate(amount: nil, charged: 124.80) == nil)
        #expect(Fx.impliedRate(amount: 12000, charged: nil) == nil)
        #expect(Fx.impliedRate(amount: 0, charged: 124.80) == nil)
        #expect(Fx.impliedRate(amount: 12000, charged: -5) == nil)
        #expect(Fx.impliedRate(amount: 12000, charged: .nan) == nil)
    }

    @Test func aRateBelowOneKeepsTheDecimalsItsInformationLivesIn() {
        #expect(Fx.formatRate(0.0104) == "0.0104")
        #expect(Fx.formatRate(0.006712) == "0.006712")
        #expect(Fx.formatRate(149.23) == "149.23")
    }

    @Test func aCleanRateIsNotPaddedOut() {
        #expect(Fx.formatRate(1.35) == "1.35")
        #expect(Fx.formatRate(2) == "2")
    }

    @Test func theHintNamesBothCurrenciesSoTheDirectionCannotBeMisread() {
        #expect(
            Fx.impliedRateLabel(amount: 12000, charged: 124.80, chargeCurrency: "JPY", accountCurrency: "SGD")
                == "1 JPY = 0.0104 SGD"
        )
    }

    @Test func theHintIsEmptyWhileThereIsNothingToShow() {
        #expect(Fx.impliedRateLabel(amount: 12000, charged: nil, chargeCurrency: "JPY", accountCurrency: "SGD") == "")
        #expect(Fx.impliedRateLabel(amount: 12000, charged: 124.80, chargeCurrency: "JPY", accountCurrency: "") == "")
    }
}

/// The encoder side: what a transaction write actually puts on the wire.
struct FxEncodingTests {
    private func update(currency: String?, amountCharged: Double?) throws -> [String: Any] {
        let body = TransactionUpdate(
            date: Date(),
            amount: 12000,
            description: "",
            accountId: "a",
            categoryId: "c",
            mcc: "",
            cardCategoryId: nil,
            currency: currency,
            amountCharged: amountCharged
        )
        // Configured the way `APIClient` configures it, so these assert on the
        // keys that actually reach the API rather than on Swift's property names.
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        let data = try encoder.encode(body)
        return try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    @Test func omitsTheChargedAmountWhenThereIsNothingToSay() throws {
        // Unlike `cardCategoryId`, nil here means "nothing to say about the
        // rate", not "clear it" — there is no such thing as a transaction with
        // no rate, so an explicit null would be asking for the impossible.
        let json = try update(currency: "SGD", amountCharged: nil)
        #expect(json.keys.contains("amount_charged") == false)
        #expect(json["currency"] as? String == "SGD")
    }

    @Test func sendsBothWhenTheChargeWasForeign() throws {
        let json = try update(currency: "JPY", amountCharged: 124.80)
        #expect(json["currency"] as? String == "JPY")
        #expect(json["amount_charged"] as? Double == 124.80)
    }

    @Test func omitsTheCurrencyWhenTheFormHasNoneToOffer() throws {
        let json = try update(currency: nil, amountCharged: nil)
        #expect(json.keys.contains("currency") == false)
    }
}
