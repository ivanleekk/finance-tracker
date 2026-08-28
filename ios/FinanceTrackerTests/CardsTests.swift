import Foundation
import Testing

@testable import FinanceTracker

/// Per-card spend limits (`Support/Cards.swift`). Twin of the web
/// `frontend/src/lib/cards.test.ts` and the Android `CardsTest.kt` — the three
/// must agree about the same numbers.
///
/// What these mostly pin is that a ceiling and a floor never read the same. The
/// maths is identical; the meaning is opposite, and getting that backwards
/// would tell someone they were fine when they were about to miss a fee waiver.
struct CardsTests {

    private func row(
        direction: LimitDirection = .ceiling,
        remaining: Double = 760,
        percentUsed: Double = 24,
        projectedMissed: Bool = false,
        settled: Bool = false,
        limitId: String = "lim-1"
    ) -> CardLimitStatusRow {
        CardLimitStatusRow(
            limitId: limitId,
            name: "Dining cap",
            categoryNames: ["Dining"],
            direction: direction,
            amount: 1000,
            spent: 240,
            remaining: remaining,
            percentUsed: percentUsed,
            periodStart: Date(timeIntervalSince1970: 1_786_060_800),
            periodEnd: Date(timeIntervalSince1970: 1_788_652_800),
            daysElapsed: 18,
            daysTotal: 31,
            projectedSpend: 413,
            projectedMissed: projectedMissed,
            settled: settled
        )
    }

    private func money(_ value: Double) -> String { "$\(Int(value))" }

    // MARK: - Tone

    @Test func readsAComfortableCapAsOk() {
        #expect(Cards.tone(for: row()) == .ok)
    }

    @Test func warnsBeforeTheCapIsActuallyBurst() {
        // The whole point of the projection: telling someone on the last day is
        // useless.
        #expect(Cards.tone(for: row(projectedMissed: true)) == .atRisk)
    }

    @Test func readsABurstCapAsOver() {
        #expect(Cards.tone(for: row(settled: true)) == .over)
    }

    @Test func neverReadsAMinimumSpendAsOver() {
        // Same `settled` flag, opposite meaning. A met minimum is a success and
        // must not render in the same red as a burst cap.
        #expect(Cards.tone(for: row(direction: .floor, settled: true)) == .ok)
    }

    @Test func warnsWhenAMinimumIsOnPaceToBeMissed() {
        #expect(Cards.tone(for: row(direction: .floor, projectedMissed: true)) == .atRisk)
    }

    // MARK: - Wording

    @Test func countsDownForACap() {
        #expect(Cards.headroomLabel(for: row(remaining: 240), formatAmount: money) == "$240 left")
    }

    @Test func countsUpForAMinimum() {
        let label = Cards.headroomLabel(for: row(direction: .floor, remaining: 120), formatAmount: money)
        #expect(label == "$120 to go")
    }

    @Test func saysWhichThingHappenedWhenTheNumberIsReached() {
        #expect(Cards.headroomLabel(for: row(settled: true), formatAmount: money) == "Cap reached")
        #expect(
            Cards.headroomLabel(for: row(direction: .floor, settled: true), formatAmount: money)
                == "Minimum met"
        )
    }

    // MARK: - Headroom fan-out

    private var card: CardResponse {
        CardResponse(
            id: "card-1",
            financialAccountId: "acc-1",
            accountName: "Amex Platinum",
            currency: "SGD",
            cycleBasis: .statement,
            statementDay: 18,
            categories: [
                CardCategoryResponse(id: "cc-1", cardId: "card-1", name: "Dining", isDefault: true, sortOrder: 0, limitId: "lim-1"),
                CardCategoryResponse(id: "cc-2", cardId: "card-1", name: "Groceries", isDefault: false, sortOrder: 1, limitId: "lim-1"),
                CardCategoryResponse(id: "cc-3", cardId: "card-1", name: "Everything else", isDefault: false, sortOrder: 2, limitId: nil),
            ],
            limits: []
        )
    }

    private func status(_ rows: [CardLimitStatusRow]) -> CardStatusResponse {
        CardStatusResponse(
            cardId: "card-1",
            accountName: "Amex Platinum",
            currency: "SGD",
            cycleStart: Date(timeIntervalSince1970: 1_786_060_800),
            cycleEnd: Date(timeIntervalSince1970: 1_788_652_800),
            limits: rows,
            categories: []
        )
    }

    @Test func fansASharedLimitOverEveryCategoryDrawingOnIt() {
        let map = Cards.headroomByCategory(card: card, status: status([row()]))
        #expect(map["cc-1"]?.limitId == "lim-1")
        #expect(map["cc-2"]?.limitId == "lim-1")
    }

    @Test func givesAnUnmeteredCategoryNoEntryRatherThanAZero() {
        // "Tracked but unmetered" and "nothing left" must not look the same.
        let map = Cards.headroomByCategory(card: card, status: status([row()]))
        #expect(map["cc-3"] == nil)
    }

    @Test func omitsACategoryWhoseLimitIsMissingFromTheStatus() {
        #expect(Cards.headroomByCategory(card: card, status: status([])).isEmpty)
    }

    // MARK: - Attention

    @Test func keepsOnlyWhatIsWorthInterruptingSomeoneAbout() {
        let rows = [
            row(limitId: "ok"),
            row(projectedMissed: true, limitId: "risk"),
            row(settled: true, limitId: "burst"),
        ]
        #expect(Cards.needingAttention(rows).map(\.limitId) == ["risk", "burst"])
    }

    @Test func isEmptyWhenEverythingIsFine() {
        #expect(Cards.needingAttention([row(), row()]).isEmpty)
    }

    // MARK: - The encoder trap

    @Test func alwaysSendsTheCardCategoryEvenWhenItIsNil() throws {
        // `TransactionUpdate` has a hand-written encoder. If cardCategoryId were
        // added as a plain field, or encoded with `encodeIfPresent`, nil would
        // be omitted — which the API reads as "preserve", leaving no way to
        // untag a transaction at all.
        let update = TransactionUpdate(
            date: Date(),
            amount: 10,
            description: "",
            accountId: "a",
            categoryId: "c",
            mcc: "",
            cardCategoryId: nil
        )
        let data = try JSONEncoder().encode(update)
        let json = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(json.keys.contains("cardCategoryId"))
        #expect(json["cardCategoryId"] is NSNull)
    }

    @Test func sendsTheCardCategoryWhenOneIsPicked() throws {
        let update = TransactionUpdate(
            date: Date(),
            amount: 10,
            description: "",
            accountId: "a",
            categoryId: "c",
            mcc: "",
            cardCategoryId: "cc-1"
        )
        let data = try JSONEncoder().encode(update)
        let json = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(json["cardCategoryId"] as? String == "cc-1")
    }
}
