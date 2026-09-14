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
        limitId: String = "lim-1",
        categoryIds: [String] = ["cc-1"],
        periodStart: Date = Date(timeIntervalSince1970: 1_786_060_800),
        periodEnd: Date = Date(timeIntervalSince1970: 1_788_652_800)
    ) -> CardLimitStatusRow {
        CardLimitStatusRow(
            limitId: limitId,
            name: "Dining cap",
            categoryIds: categoryIds,
            categoryNames: ["Dining"],
            direction: direction,
            amount: 1000,
            spent: 240,
            remaining: remaining,
            percentUsed: percentUsed,
            periodStart: periodStart,
            periodEnd: periodEnd,
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

    private func category(_ id: String, _ name: String) -> CardCategoryResponse {
        CardCategoryResponse(id: id, cardId: "card-1", name: name, isDefault: false, sortOrder: 0)
    }

    private func limit(_ id: String, categoryIds: [String]) -> CardLimitResponse {
        CardLimitResponse(
            id: id, cardId: "card-1", name: id, amount: 1, direction: .ceiling,
            resetBasis: .cycle, categoryIds: categoryIds
        )
    }

    @Test func fansASharedLimitOverEveryCategoryCountingTowardsIt() {
        let map = Cards.headroomByCategory(status: status([row(categoryIds: ["cc-1", "cc-2"])]))
        #expect(map["cc-1"]?.map(\.limitId) == ["lim-1"])
        #expect(map["cc-2"]?.map(\.limitId) == ["lim-1"])
    }

    @Test func givesACategoryEveryLimitItCountsTowardsInStatusOrder() {
        let map = Cards.headroomByCategory(status: status([
            row(direction: .floor, limitId: "monthly-min", categoryIds: ["cc-1"]),
            row(limitId: "annual-cap", categoryIds: ["cc-1", "cc-2"]),
        ]))
        #expect(map["cc-1"]?.map(\.limitId) == ["monthly-min", "annual-cap"])
        #expect(map["cc-2"]?.map(\.limitId) == ["annual-cap"])
    }

    @Test func givesAnUnmeteredCategoryNoEntryRatherThanAnEmptyList() {
        // "Tracked but unmetered" and "nothing left" must not look the same.
        #expect(Cards.headroomByCategory(status: status([row()]))["cc-3"] == nil)
        #expect(Cards.headroomByCategory(status: status([])).isEmpty)
    }

    @Test func aCategoryIsMeteredOnceAnyLimitCountsIt() {
        let limits = [limit("a", categoryIds: ["cc-1"]), limit("b", categoryIds: [])]
        #expect(Cards.isMetered(categoryId: "cc-1", limits: limits))
        #expect(!Cards.isMetered(categoryId: "cc-2", limits: limits))
    }

    @Test func thePickerStatesEveryLimitACategoryCountsTowards() {
        let headroom = Cards.headroomByCategory(status: status([
            row(direction: .floor, remaining: 300, limitId: "min", categoryIds: ["cc-1"]),
            row(remaining: 11000, limitId: "cap", categoryIds: ["cc-1"]),
        ]))
        #expect(
            Cards.pickerLabel(for: category("cc-1", "Dining"), headroom: headroom, formatAmount: money)
                == "Dining · $300 to go · $11000 left"
        )
        #expect(Cards.pickerLabel(for: category("cc-2", "Travel"), headroom: headroom, formatAmount: money) == "Travel")
    }

    // MARK: - Windows

    @Test func aLimitOnTheCardCycleAddsNoWindowOfItsOwn() {
        #expect(Cards.limitWindowLabel(for: row(), status: status([])) == nil)
    }

    @Test func aLimitOffTheCycleNamesItsWindowWithYears() {
        let gb = Locale(identifier: "en_GB")
        let calendar = Calendar.current
        let start = calendar.date(from: DateComponents(year: 2025, month: 9, day: 14))!
        let end = calendar.date(from: DateComponents(year: 2026, month: 9, day: 13))!
        let label = Cards.limitWindowLabel(for: row(periodStart: start, periodEnd: end), status: status([]), locale: gb)
        #expect(label?.contains("2025") == true)
        #expect(label?.contains("2026") == true)
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

    // MARK: - Anniversary resets

    @Test func aCardYearDecodesAsItself() throws {
        let data = #""card_year""#.data(using: .utf8)!
        #expect(try JSONDecoder().decode(LimitResetBasis.self, from: data) == .cardYear)
    }

    @Test func anUnknownScheduleDecodesAsUnknownRatherThanFailingTheCard() throws {
        // A newer server must not blank the Cards screen, and must not be
        // relabelled as a schedule this build does know.
        let data = #""fortnightly""#.data(using: .utf8)!
        #expect(try JSONDecoder().decode(LimitResetBasis.self, from: data) == .unknown)
    }

    @Test func aCardDecodesItsAnniversary() throws {
        let json = """
        {"id":"c","financial_account_id":"a","account_name":"Amex","currency":"SGD",
         "cycle_basis":"statement","statement_day":18,"anniversary_date":"2024-03-14",
         "categories":[],"limits":[]}
        """.data(using: .utf8)!
        let card = try APIClient.decoder.decode(CardResponse.self, from: json)
        #expect(card.anniversaryDate?.apiDateOnly == "2024-03-14")
    }

    private func encodedObject(_ update: CardUpdate) throws -> [String: Any] {
        let data = try APIClient.encoder.encode(update)
        return try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    @Test func aCardUpdateSendsTheAnniversary() throws {
        let object = try encodedObject(CardUpdate(cycleBasis: "statement", statementDay: 18, anniversaryDate: "2024-03-14"))
        #expect(object["anniversary_date"] as? String == "2024-03-14")
    }

    @Test func aClearedAnniversaryIsAnExplicitNullNotAnOmittedKey() throws {
        // Omitted would mean "keep it" to the backend; only null clears it.
        let object = try encodedObject(CardUpdate(cycleBasis: "statement", statementDay: 18, anniversaryDate: nil))
        #expect(object.keys.contains("anniversary_date"))
        #expect(object["anniversary_date"] is NSNull)
    }

    @Test func aCardUpdateSendsTheForeignFeeAndAClearedOneAsNull() throws {
        let set = try encodedObject(CardUpdate(cycleBasis: "statement", statementDay: 18, anniversaryDate: nil, foreignFeePercent: 3.25))
        #expect(set["foreign_fee_percent"] as? Double == 3.25)
        let cleared = try encodedObject(CardUpdate(cycleBasis: "statement", statementDay: 18, anniversaryDate: nil, foreignFeePercent: nil))
        #expect(cleared.keys.contains("foreign_fee_percent"))
        #expect(cleared["foreign_fee_percent"] is NSNull)
    }

    @Test func aCardsForeignFeeDecodesFromTheDecimalString() throws {
        let json = Data("""
        {"id":"c","financial_account_id":"a","account_name":"Card","currency":"SGD","cycle_basis":"statement",
         "statement_day":18,"anniversary_date":null,"foreign_fee_percent":"3.25","categories":[],"limits":[]}
        """.utf8)
        let card = try APIClient.decoder.decode(CardResponse.self, from: json)
        #expect(card.foreignFeePercent == 3.25)
    }

    @Test func anniversaryResetsAreOnlyOfferedOnceTheCardHasADate() {
        let without = Cards.resetOptions(hasAnniversary: false)
        #expect(without.filter(\.isAvailable).map(\.basis) == [.cycle, .calendarMonth, .quarter, .year])
        let with = Cards.resetOptions(hasAnniversary: true)
        #expect(with.filter(\.isAvailable).map(\.basis).contains(.cardYear))
        #expect(with.filter(\.isAvailable).map(\.basis).contains(.cardQuarter))
    }
}
