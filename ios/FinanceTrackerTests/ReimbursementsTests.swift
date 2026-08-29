import Foundation
import Testing

@testable import FinanceTracker

/// Splitting a bill (`Support/Reimbursements.swift`). Twin of the web
/// `frontend/src/lib/reimbursements.test.ts` and the Android
/// `ReimbursementsTest.kt` — the three must agree about the same numbers.
struct ReimbursementsTests {
    @Test func leavesYouTheRemainderOfTheBill() {
        let entries = [SplitEntry(counterpartyId: "alice", amount: 80)]
        #expect(Reimbursements.assessSplit(amount: 120, entries: entries) == .valid(yourShare: 40, owed: 80))
    }

    @Test func splitsThreeWaysAndLeavesYouTheRest() {
        // N-way splits are the whole point of promoting the counterparty to a
        // list of entries instead of one name/amount pair.
        let entries = [
            SplitEntry(counterpartyId: "alice", amount: 30),
            SplitEntry(counterpartyId: "bob", amount: 30),
        ]
        #expect(Reimbursements.assessSplit(amount: 120, entries: entries) == .valid(yourShare: 60, owed: 60))
    }

    @Test func letsYouFrontTheWholeThing() {
        // Paying for someone entirely is a normal thing to do, and it should
        // charge your budget nothing rather than being rejected as a mistake.
        let entries = [SplitEntry(counterpartyId: "alice", amount: 90)]
        #expect(Reimbursements.assessSplit(amount: 90, entries: entries) == .valid(yourShare: 0, owed: 90))
    }

    @Test func refusesAShareLargerThanTheBillInsteadOfClamping() {
        // Clamping would hide a typo behind a plausible number.
        let entries = [SplitEntry(counterpartyId: "alice", amount: 200)]
        #expect(Reimbursements.assessSplit(amount: 120, entries: entries).isInvalid)
    }

    @Test func refusesCombinedSharesLargerThanTheBill() {
        let entries = [
            SplitEntry(counterpartyId: "alice", amount: 70),
            SplitEntry(counterpartyId: "bob", amount: 70),
        ]
        #expect(Reimbursements.assessSplit(amount: 120, entries: entries).isInvalid)
    }

    @Test func refusesTheSamePersonTwiceInOneSplit() {
        let entries = [
            SplitEntry(counterpartyId: "alice", amount: 30),
            SplitEntry(counterpartyId: "alice", amount: 20),
        ]
        #expect(Reimbursements.assessSplit(amount: 120, entries: entries).isInvalid)
    }

    @Test func saysNothingUntilEveryEntryIsComplete() {
        #expect(Reimbursements.assessSplit(amount: 120, entries: []) == .incomplete)
        #expect(Reimbursements.assessSplit(amount: nil, entries: [SplitEntry(counterpartyId: "alice", amount: 80)]) == .incomplete)
        #expect(Reimbursements.assessSplit(amount: 120, entries: [SplitEntry(counterpartyId: "alice", amount: nil)]) == .incomplete)
        #expect(Reimbursements.assessSplit(amount: 120, entries: [SplitEntry(counterpartyId: "alice", amount: 0)]) == .incomplete)
        // One complete entry alongside one half-filled one is still incomplete —
        // a partially-filled row blocks the whole split, not just itself.
        let mixed = [
            SplitEntry(counterpartyId: "alice", amount: 30),
            SplitEntry(counterpartyId: "bob", amount: nil),
        ]
        #expect(Reimbursements.assessSplit(amount: 120, entries: mixed) == .incomplete)
    }

    @Test func treatsNonsenseAsNothingEntered() {
        #expect(Reimbursements.assessSplit(amount: .nan, entries: [SplitEntry(counterpartyId: "alice", amount: 80)]) == .incomplete)
        #expect(Reimbursements.assessSplit(amount: 120, entries: [SplitEntry(counterpartyId: "alice", amount: .infinity)]) == .incomplete)
    }

    @Test func readsABlankFieldAsNothingRatherThanZero() {
        #expect(Reimbursements.parseMoney("") == nil)
        #expect(Reimbursements.parseMoney("   ") == nil)
        #expect(Reimbursements.parseMoney("abc") == nil)
    }

    @Test func readsANumberWithATypedThousandsSeparator() {
        #expect(Reimbursements.parseMoney(" 1,250.50 ") == 1250.5)
    }

    @Test func dividesWhatsLeftEvenlyAcrossTheUnspecified() {
        // Mirrors cashshare-telegram's `/add` semantics: some people get an
        // explicit share and everyone else splits the remainder equally.
        #expect(Reimbursements.evenSplitRemainder(amount: 100, specified: [40], remainingCount: 2) == 30)
    }

    @Test func evenSplitWithNothingLeftOverIsNil() {
        #expect(Reimbursements.evenSplitRemainder(amount: 100, specified: [100], remainingCount: 1) == nil)
        #expect(Reimbursements.evenSplitRemainder(amount: 100, specified: [120], remainingCount: 1) == nil)
    }

    @Test func evenSplitWithNobodyLeftToFillInIsNil() {
        #expect(Reimbursements.evenSplitRemainder(amount: 100, specified: [], remainingCount: 0) == nil)
    }

    @Test func keepsTheTwoDirectionsApart() {
        // Netting to 55 would lose the fact that there are two things to settle,
        // with two different people, in two different directions.
        let rows = [
            CounterpartyBalanceResponse(counterpartyId: "alice", counterpartyName: "Alice", direction: .owedToYou, amount: 80, ownerUserId: nil),
            CounterpartyBalanceResponse(counterpartyId: "bob", counterpartyName: "Bob", direction: .owedToYou, amount: 20, ownerUserId: nil),
            CounterpartyBalanceResponse(counterpartyId: "alice", counterpartyName: "Alice", direction: .youOwe, amount: 45, ownerUserId: nil),
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
        let owed = CounterpartyBalanceResponse(counterpartyId: "alice", counterpartyName: "Alice", direction: .owedToYou, amount: 80, ownerUserId: nil)
        let owes = CounterpartyBalanceResponse(counterpartyId: "alice", counterpartyName: "Alice", direction: .youOwe, amount: 45, ownerUserId: nil)
        #expect(owed.id != owes.id)
    }
}

/// Decoding and encoding the split. The absent-key case is the one that
/// matters most: a response that omits `splits` still decodes as "nobody owes
/// anything", and the update encoder's key set is what tells the backend
/// whether to leave a split alone, clear it, or replace it.
struct ReimbursementCodingTests {
    private let decoder = APIClient.decoder

    @Test func aTransactionWithoutASplitsKeyStillDecodes() throws {
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
        #expect(txn.splits.isEmpty)
    }

    @Test func aSplitTransactionDecodesEveryShare() throws {
        // The backend serializes Decimal as a JSON string, hence @MoneyAmount.
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
          "splits": [
            {"counterparty_id": "cp-alice", "counterparty_name": "Alice", "amount": "50"},
            {"counterparty_id": "cp-bob", "counterparty_name": "Bob", "amount": "30"}
          ]
        }
        """.data(using: .utf8)!
        let txn = try decoder.decode(TransactionResponse.self, from: json)
        #expect(txn.splits.count == 2)
        #expect(txn.splits[0].counterpartyId == "cp-alice")
        #expect(txn.splits[0].counterpartyName == "Alice")
        #expect(abs(txn.splits[0].amount - 50) < 0.0001)
        #expect(txn.splits[1].counterpartyName == "Bob")
        #expect(abs(txn.splits[1].amount - 30) < 0.0001)
    }

    @Test func balancesDecodeFromTheListEndpoint() throws {
        let json = """
        [{"counterparty_id": "cp-alice", "counterparty_name": "Alice", "direction": "owed_to_you", "amount": "80.00", "owner_user_id": null},
         {"counterparty_id": "cp-bob", "counterparty_name": "Bob", "direction": "you_owe", "amount": "45.00", "owner_user_id": "user-1"}]
        """.data(using: .utf8)!
        let rows = try decoder.decode([CounterpartyBalanceResponse].self, from: json)
        #expect(rows.count == 2)
        #expect(rows[0].direction == .owedToYou)
        #expect(rows[1].direction == .youOwe)
        #expect(abs(rows[1].amount - 45) < 0.0001)
        // The debt's own owner scope, not the account that will eventually settle
        // it — a settle request must echo this back verbatim (see SettlementCreate).
        #expect(rows[0].ownerUserId == nil)
        #expect(rows[1].ownerUserId == "user-1")
    }

    @Test func aBalanceWithNoOwnerKeyStillDecodesAsShared() throws {
        // Older responses, or a row with no owner scope at all, must decode as
        // "shared" rather than failing — an absent key is not the same as a bug.
        let json = """
        [{"counterparty_id": "cp-alice", "counterparty_name": "Alice", "direction": "owed_to_you", "amount": "80.00"}]
        """.data(using: .utf8)!
        let rows = try decoder.decode([CounterpartyBalanceResponse].self, from: json)
        #expect(rows[0].ownerUserId == nil)
    }

    // A plain optional array already has an unambiguous empty state, unlike the
    // old single owed_by/owed_amount pair: an omitted key means "leave the split
    // alone", an empty array clears it, and a populated one replaces it
    // wholesale. There is no longer a hand-rolled `SplitChange` enum or custom
    // `encode(to:)` needed for this field — Swift's ordinary `encodeIfPresent`
    // already gets all three cases right, which is what these three pin.

    private func encodedKeys(_ update: TransactionUpdate) throws -> Set<String> {
        let data = try APIClient.encoder.encode(update)
        let object = try #require(
            try JSONSerialization.jsonObject(with: data) as? [String: Any]
        )
        return Set(object.keys)
    }

    private func base(splits: [TransactionSplitInput]?) -> TransactionUpdate {
        TransactionUpdate(
            date: Date(timeIntervalSince1970: 0),
            amount: 120,
            description: "Group dinner",
            accountId: "acc-1",
            categoryId: "cat-1",
            splits: splits,
            // The form always sends a code (blank when there is none); these tests
            // are about the split keys, so this is what an untouched field sends.
            mcc: "",
            cardCategoryId: nil
        )
    }

    @Test func anUnchangedSplitOmitsTheKeyEntirely() throws {
        // This is what stops an unrelated description edit from quietly making a
        // shared dinner all yours.
        let keys = try encodedKeys(base(splits: nil))
        #expect(!keys.contains("splits"))
    }

    @Test func clearingASplitSendsAnEmptyArray() throws {
        let keys = try encodedKeys(base(splits: []))
        #expect(keys.contains("splits"))

        let data = try APIClient.encoder.encode(base(splits: []))
        let object = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect((object["splits"] as? [Any])?.isEmpty == true)
    }

    @Test func settingASplitSendsThePopulatedArray() throws {
        let data = try APIClient.encoder.encode(base(splits: [
            TransactionSplitInput(counterpartyId: "cp-alice", amount: 50),
            TransactionSplitInput(counterpartyId: "cp-bob", amount: 30),
        ]))
        let object = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        let splits = try #require(object["splits"] as? [[String: Any]])
        #expect(splits.count == 2)
        #expect(splits[0]["counterparty_id"] as? String == "cp-alice")
        #expect((splits[0]["amount"] as? NSNumber)?.doubleValue == 50)
        #expect(splits[1]["counterparty_id"] as? String == "cp-bob")
        #expect((splits[1]["amount"] as? NSNumber)?.doubleValue == 30)
    }
}
