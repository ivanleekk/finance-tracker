import Foundation
import Testing

@testable import FinanceTracker

/// Splitting a bill (`Support/Reimbursements.swift`). Twin of the web
/// `frontend/src/lib/reimbursements.test.ts` and the Android
/// `ReimbursementsTest.kt` — the three must agree about the same numbers.
struct ReimbursementsTests {
    @Test func leavesYouTheRemainderOfTheBill() {
        #expect(Reimbursements.assessSplit(amount: 120, owed: 80) == .valid(yourShare: 40, owed: 80))
    }

    @Test func letsYouFrontTheWholeThing() {
        // Paying for someone entirely is a normal thing to do, and it should
        // charge your budget nothing rather than being rejected as a mistake.
        #expect(Reimbursements.assessSplit(amount: 90, owed: 90) == .valid(yourShare: 0, owed: 90))
    }

    @Test func refusesAShareLargerThanTheBillInsteadOfClamping() {
        // Clamping would hide a typo behind a plausible number.
        #expect(Reimbursements.assessSplit(amount: 120, owed: 200).isInvalid)
    }

    @Test func saysNothingUntilBothNumbersAreThere() {
        #expect(Reimbursements.assessSplit(amount: 120, owed: nil) == .incomplete)
        #expect(Reimbursements.assessSplit(amount: nil, owed: 80) == .incomplete)
        #expect(Reimbursements.assessSplit(amount: 120, owed: 0) == .incomplete)
    }

    @Test func treatsNonsenseAsNothingEntered() {
        #expect(Reimbursements.assessSplit(amount: .nan, owed: 80) == .incomplete)
        #expect(Reimbursements.assessSplit(amount: 120, owed: .infinity) == .incomplete)
    }

    @Test func readsABlankFieldAsNothingRatherThanZero() {
        #expect(Reimbursements.parseMoney("") == nil)
        #expect(Reimbursements.parseMoney("   ") == nil)
        #expect(Reimbursements.parseMoney("abc") == nil)
    }

    @Test func readsANumberWithATypedThousandsSeparator() {
        #expect(Reimbursements.parseMoney(" 1,250.50 ") == 1250.5)
    }

    @Test func keepsTheTwoDirectionsApart() {
        // Netting to 55 would lose the fact that there are two things to settle,
        // with two different people, in two different directions.
        let rows = [
            CounterpartyBalanceResponse(counterpartyName: "Alice", direction: .owedToYou, amount: 80),
            CounterpartyBalanceResponse(counterpartyName: "Bob", direction: .owedToYou, amount: 20),
            CounterpartyBalanceResponse(counterpartyName: "Alice", direction: .youOwe, amount: 45),
        ]
        let totals = Reimbursements.totals(rows)
        #expect(totals.owedToYou == 100)
        #expect(totals.youOwe == 45)
    }

    @Test func keepsARepaymentOutOfTheSpendingBreakdown() {
        // Otherwise the same dinner is charged twice: once when the bill was
        // paid, and again when the debt was settled.
        #expect(!Reimbursements.countsAsSpending("Reimbursement", isTransfer: false))
    }

    @Test func keepsATransferOutOfTheSpendingBreakdown() {
        // Moving your own money between your own accounts is not spending — you
        // still have it. A transfer's withdrawal leg is an expense row with a
        // real category, so nothing else would exclude it.
        #expect(!Reimbursements.countsAsSpending("Transfer", isTransfer: true))
    }

    @Test func excludesATransferWhateverItsCategoryIsCalled() {
        // The transfer flag is the signal, not the category name: a household
        // that renamed its Transfer category must not start counting them.
        #expect(!Reimbursements.countsAsSpending("Moving money", isTransfer: true))
        #expect(!Reimbursements.countsAsSpending(nil, isTransfer: true))
    }

    @Test func leavesOrdinaryCategoriesAlone() {
        #expect(Reimbursements.countsAsSpending("Dining", isTransfer: false))
        #expect(Reimbursements.countsAsSpending("Investment", isTransfer: false))
        #expect(Reimbursements.countsAsSpending(nil, isTransfer: false))
    }

    @Test func oneNameInBothDirectionsIsTwoRows() {
        // The list is keyed by identity, so a person who both owes and is owed
        // must not collapse into a single row.
        let owed = CounterpartyBalanceResponse(counterpartyName: "Alice", direction: .owedToYou, amount: 80)
        let owes = CounterpartyBalanceResponse(counterpartyName: "Alice", direction: .youOwe, amount: 45)
        #expect(owed.id != owes.id)
    }
}

/// Decoding and encoding the split. The absent-keys case is the one that matters:
/// every transaction logged before the ledger existed comes back without them.
struct ReimbursementCodingTests {
    private let decoder = APIClient.decoder

    @Test func aTransactionWithoutSplitKeysStillDecodes() throws {
        let json = """
        {
          "id": "txn-1",
          "account_id": "acc-1",
          "category_id": "cat-1",
          "date": "2026-07-19T00:00:00",
          "amount": "125.50",
          "amount_home_currency": "170.20",
          "currency": "USD",
          "description": "Groceries",
          "transaction_type": "expense",
          "transfer_id": null
        }
        """.data(using: .utf8)!
        let txn = try decoder.decode(TransactionResponse.self, from: json)
        #expect(txn.owedBy == nil)
        #expect(txn.owedAmount == nil)
    }

    @Test func aSplitTransactionDecodesItsShare() throws {
        // The backend serializes Decimal as a JSON string, hence the wrapper.
        let json = """
        {
          "id": "txn-1",
          "account_id": "acc-1",
          "category_id": "cat-1",
          "date": "2026-07-19T00:00:00",
          "amount": "120",
          "amount_home_currency": "120",
          "currency": "SGD",
          "description": "Group dinner",
          "transaction_type": "expense",
          "transfer_id": null,
          "owed_by": "Alice",
          "owed_amount": "80"
        }
        """.data(using: .utf8)!
        let txn = try decoder.decode(TransactionResponse.self, from: json)
        #expect(txn.owedBy == "Alice")
        #expect(abs((txn.owedAmount ?? 0) - 80) < 0.0001)
    }

    @Test func balancesDecodeFromTheListEndpoint() throws {
        let json = """
        [{"counterparty_name": "Alice", "direction": "owed_to_you", "amount": "80.00"},
         {"counterparty_name": "Bob", "direction": "you_owe", "amount": "45.00"}]
        """.data(using: .utf8)!
        let rows = try decoder.decode([CounterpartyBalanceResponse].self, from: json)
        #expect(rows.count == 2)
        #expect(rows[0].direction == .owedToYou)
        #expect(rows[1].direction == .youOwe)
        #expect(abs(rows[1].amount - 45) < 0.0001)
    }

    // The three `SplitChange` cases exist because "leave it alone" and "remove
    // it" are different requests, and the API tells them apart by whether the
    // key is present. A synthesized encoder cannot express that difference, so
    // these pin the hand-written one.

    private func encodedKeys(_ update: TransactionUpdate) throws -> Set<String> {
        let data = try APIClient.encoder.encode(update)
        let object = try #require(
            try JSONSerialization.jsonObject(with: data) as? [String: Any]
        )
        return Set(object.keys)
    }

    private func base(_ split: SplitChange) -> TransactionUpdate {
        TransactionUpdate(
            date: Date(timeIntervalSince1970: 0),
            amount: 120,
            description: "Group dinner",
            accountId: "acc-1",
            categoryId: "cat-1",
            split: split,
            // The form always sends a code (blank when there is none); these tests
            // are about the split keys, so this is what an untouched field sends.
            mcc: ""
        )
    }

    @Test func anUnchangedSplitOmitsTheKeysEntirely() throws {
        // This is what stops an unrelated description edit from quietly making a
        // shared dinner all yours.
        let keys = try encodedKeys(base(.unchanged))
        #expect(!keys.contains("owed_by"))
        #expect(!keys.contains("owed_amount"))
    }

    @Test func clearingASplitSendsExplicitNulls() throws {
        let keys = try encodedKeys(base(.clear))
        #expect(keys.contains("owed_by"))
        #expect(keys.contains("owed_amount"))

        let data = try APIClient.encoder.encode(base(.clear))
        let object = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(object["owed_by"] is NSNull)
        #expect(object["owed_amount"] is NSNull)
    }

    @Test func settingASplitSendsBothHalves() throws {
        let data = try APIClient.encoder.encode(base(.set(owedBy: "Alice", owedAmount: 80)))
        let object = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(object["owed_by"] as? String == "Alice")
        #expect((object["owed_amount"] as? NSNumber)?.doubleValue == 80)
    }
}
