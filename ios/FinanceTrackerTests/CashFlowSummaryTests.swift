import Foundation
import Testing
@testable import FinanceTracker

/// `Support/CashFlowSummary.swift` — what the Cash Flow tab and the Dashboard's
/// exception row agree needs acting on.
///
/// Dates are built in an explicit UTC calendar and every `now` is passed in, so
/// none of this depends on the machine running it.
struct CashFlowSummaryTests {

    private static var utc: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(secondsFromGMT: 0)!
        return c
    }()

    private static func day(_ y: Int, _ m: Int, _ d: Int) -> Date {
        utc.date(from: DateComponents(year: y, month: m, day: d))!
    }

    private static func rule(
        id: String,
        due: Date,
        isActive: Bool = true,
        owner: String? = nil
    ) -> RecurringTransactionResponse {
        RecurringTransactionResponse(
            id: id,
            householdId: "hh",
            accountId: "acc",
            categoryId: "cat",
            amount: 100,
            currency: "USD",
            description: nil,
            frequency: .monthly,
            startDate: day(2026, 1, 1),
            endDate: nil,
            nextDueDate: due,
            lastPostedDate: nil,
            isActive: isActive,
            ownerUserId: owner,
            postedCount: nil,
            postedTotalHomeCurrency: nil
        )
    }

    private static func occurrence(
        ruleId: String = "r1",
        date: Date,
        amount: Double = 100,
        type: TransactionType = .expense
    ) -> UpcomingOccurrence {
        UpcomingOccurrence(
            recurringTransactionId: ruleId,
            description: "Rent",
            categoryName: "Housing",
            accountName: "Checking",
            date: date,
            amount: amount,
            currency: "USD",
            transactionType: type
        )
    }

    private static func budget(
        id: String = "b1",
        limit: Double,
        spent: Double,
        projected: Double,
        names: [String] = ["Dining"]
    ) -> BudgetStatusRow {
        BudgetStatusRow(
            budgetId: id,
            categoryIds: ["c1"],
            categoryNames: names,
            period: .monthly,
            isPrivate: false,
            limit: limit,
            spent: spent,
            remaining: limit - spent,
            percentUsed: limit == 0 ? 0 : spent / limit * 100,
            periodStart: day(2026, 9, 1),
            periodEnd: day(2026, 9, 30),
            daysElapsed: 10,
            daysTotal: 30,
            projectedSpend: projected,
            projectedOver: projected > limit
        )
    }

    private static func cardLimit(
        id: String = "l1",
        name: String = "Dining cap",
        direction: LimitDirection = .ceiling,
        amount: Double = 1000,
        spent: Double = 100,
        projectedMissed: Bool = false,
        settled: Bool = false,
        categoryNames: [String] = ["Dining"]
    ) -> CardLimitSummary {
        CardLimitSummary(
            cardName: "Citi Rewards",
            currency: "USD",
            row: CardLimitStatusRow(
                limitId: id,
                name: name,
                categoryNames: categoryNames,
                direction: direction,
                amount: amount,
                spent: spent,
                remaining: amount - spent,
                percentUsed: spent / amount * 100,
                periodStart: day(2026, 9, 1),
                periodEnd: day(2026, 9, 30),
                daysElapsed: 10,
                daysTotal: 30,
                projectedSpend: spent * 3,
                projectedMissed: projectedMissed,
                settled: settled
            )
        )
    }

    /// The formatter the views inject, made boring so assertions read cleanly.
    private static func money(_ amount: Double, _ currency: String) -> String {
        "\(currency)\(Int(amount.rounded()))"
    }

    // MARK: dueNow

    @Test("A rule due today counts, regardless of the time of day")
    func dueTodayCounts() {
        let now = Self.utc.date(from: DateComponents(year: 2026, month: 9, day: 2, hour: 23))!
        let rules = [Self.rule(id: "r1", due: Self.day(2026, 9, 2))]
        #expect(CashFlowSummary.dueNow(rules: rules, now: now, calendar: Self.utc).count == 1)
    }

    @Test("Future and paused rules are not due")
    func futureAndPausedExcluded() {
        let now = Self.day(2026, 9, 2)
        let rules = [
            Self.rule(id: "future", due: Self.day(2026, 9, 3)),
            Self.rule(id: "paused", due: Self.day(2026, 8, 1), isActive: false),
            Self.rule(id: "overdue", due: Self.day(2026, 8, 1)),
        ]
        let due = CashFlowSummary.dueNow(rules: rules, now: now, calendar: Self.utc)
        #expect(due.map(\.id) == ["overdue"])
    }

    // MARK: upcomingWithin

    @Test("The window includes today and excludes the day it ends on")
    func upcomingWindowBounds() {
        let now = Self.day(2026, 9, 2)
        let items = [
            Self.occurrence(date: Self.day(2026, 9, 1)),   // yesterday
            Self.occurrence(date: Self.day(2026, 9, 2)),   // today
            Self.occurrence(date: Self.day(2026, 9, 15)),  // inside
            Self.occurrence(date: Self.day(2026, 9, 16)),  // the boundary itself
        ]
        let within = CashFlowSummary.upcomingWithin(items, days: 14, now: now, calendar: Self.utc)
        #expect(within.map(\.date) == [Self.day(2026, 9, 2), Self.day(2026, 9, 15)])
    }

    @Test("Occurrences of rules the view mode can't see are dropped")
    func upcomingRespectsVisibleRules() {
        let items = [
            Self.occurrence(ruleId: "mine", date: Self.day(2026, 9, 3)),
            Self.occurrence(ruleId: "theirs", date: Self.day(2026, 9, 4)),
        ]
        let visible = CashFlowSummary.visibleUpcoming(items, visibleRuleIds: ["mine"])
        #expect(visible.map(\.recurringTransactionId) == ["mine"])
    }

    // MARK: attention

    @Test("A household on top of things produces nothing at all")
    func healthyHouseholdIsSilent() {
        let items = CashFlowSummary.attention(
            budgets: [Self.budget(limit: 500, spent: 100, projected: 300)],
            cards: [Self.cardLimit()],
            dueNowCount: 0,
            formatAmount: Self.money,
            baseCurrency: "USD"
        )
        #expect(items.isEmpty)
    }

    @Test("An overspent budget reports the overshoot, not the total")
    func overspentBudget() {
        let items = CashFlowSummary.attention(
            budgets: [Self.budget(limit: 500, spent: 620, projected: 900)],
            cards: [],
            dueNowCount: 0,
            formatAmount: Self.money,
            baseCurrency: "USD"
        )
        #expect(items.count == 1)
        #expect(items[0].tone == .over)
        #expect(items[0].detail == "USD120 over budget")
    }

    @Test("A cap flagged for pace says so before it says how much is left")
    func atRiskCapExplainsItself() {
        let items = CashFlowSummary.attention(
            budgets: [],
            cards: [Self.cardLimit(spent: 775, projectedMissed: true)],
            dueNowCount: 0,
            formatAmount: Self.money,
            baseCurrency: "USD"
        )
        #expect(items.map(\.tone) == [.atRisk])
        #expect(items[0].detail == "On pace to burst · USD225 left")
    }

    @Test("A budget only projected over is at risk, not over")
    func projectedBudgetIsAtRisk() {
        let items = CashFlowSummary.attention(
            budgets: [Self.budget(limit: 500, spent: 200, projected: 600)],
            cards: [],
            dueNowCount: 0,
            formatAmount: Self.money,
            baseCurrency: "USD"
        )
        #expect(items.count == 1)
        #expect(items[0].tone == .atRisk)
    }

    @Test("A limit with no categories pointing at it is skipped, not shown as healthy")
    func unmeteredLimitSkipped() {
        let items = CashFlowSummary.attention(
            budgets: [],
            cards: [Self.cardLimit(settled: true, categoryNames: [])],
            dueNowCount: 0,
            formatAmount: Self.money,
            baseCurrency: "USD"
        )
        #expect(items.isEmpty)
    }

    @Test("A burst cap is over; a missed minimum is only ever at risk")
    func capsAndMinimumsDiffer() {
        let burst = CashFlowSummary.attention(
            budgets: [],
            cards: [Self.cardLimit(settled: true)],
            dueNowCount: 0,
            formatAmount: Self.money,
            baseCurrency: "USD"
        )
        #expect(burst.map(\.tone) == [.over])
        #expect(burst[0].detail == "Cap reached")

        // A floor that is on pace to fall short can still be rescued before the
        // cycle closes, so it must not wear the colour reserved for what has
        // already gone wrong.
        let shortfall = CashFlowSummary.attention(
            budgets: [],
            cards: [Self.cardLimit(direction: .floor, projectedMissed: true)],
            dueNowCount: 0,
            formatAmount: Self.money,
            baseCurrency: "USD"
        )
        #expect(shortfall.map(\.tone) == [.atRisk])
        // The reason leads: "USD900 to go" alone is what someone who needed no
        // warning would read.
        #expect(shortfall[0].detail == "On pace to fall short · USD900 to go")
    }

    @Test("Due recurring rules are pluralised and reported once, not per rule")
    func dueRecurringItem() {
        let one = CashFlowSummary.attention(
            budgets: [], cards: [], dueNowCount: 1,
            formatAmount: Self.money, baseCurrency: "USD"
        )
        #expect(one.map(\.title) == ["1 recurring transaction due"])

        let many = CashFlowSummary.attention(
            budgets: [], cards: [], dueNowCount: 3,
            formatAmount: Self.money, baseCurrency: "USD"
        )
        #expect(many.map(\.title) == ["3 recurring transactions due"])
    }

    @Test("What has already happened sorts above what might")
    func overSortsAboveAtRisk() {
        let items = CashFlowSummary.attention(
            budgets: [
                Self.budget(id: "risk", limit: 500, spent: 200, projected: 600, names: ["Aaa"]),
                Self.budget(id: "over", limit: 500, spent: 700, projected: 900, names: ["Zzz"]),
            ],
            cards: [],
            dueNowCount: 0,
            formatAmount: Self.money,
            baseCurrency: "USD"
        )
        #expect(items.map(\.tone) == [.over, .atRisk])
    }

    // MARK: budgetsSubtitle

    @Test("The budgets row says nothing when there are no budgets to summarise")
    func subtitleNilWithoutBudgets() {
        #expect(CashFlowSummary.budgetsSubtitle([]) == nil)
    }

    @Test("The budgets row leads with what is already over")
    func subtitleWording() {
        #expect(CashFlowSummary.budgetsSubtitle([Self.budget(limit: 500, spent: 100, projected: 200)]) == "On track")
        #expect(CashFlowSummary.budgetsSubtitle([Self.budget(limit: 500, spent: 100, projected: 900)]) == "1 off pace")
        #expect(
            CashFlowSummary.budgetsSubtitle([
                Self.budget(id: "a", limit: 500, spent: 900, projected: 900),
                Self.budget(id: "b", limit: 500, spent: 100, projected: 900),
            ]) == "1 over"
        )
    }
}
