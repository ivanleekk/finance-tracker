import Foundation
import Testing
@testable import FinanceTracker

/// Mirrors `frontend/src/lib/budgets.test.ts` — the two clients must say the
/// same thing about the same numbers. These pin the judgement calls: when a
/// budget is "at risk" rather than merely spent, and what an undefined runway
/// is allowed to claim.
struct BudgetPresentationTests {

    private let decoder = APIClient.decoder

    // MARK: Helpers

    private func row(
        spent: Double = 200,
        limit: Double = 600,
        percentUsed: Double = 33.3,
        projectedOver: Bool = true,
        daysElapsed: Int = 10,
        daysTotal: Int = 31,
        remaining: Double = 400,
        projectedSpend: Double = 620
    ) throws -> BudgetStatusRow {
        let json = """
        {
          "budget_id": "b", "category_ids": ["c"], "category_names": ["Dining"],
          "period": "monthly", "is_private": false,
          "limit": "\(limit)", "spent": "\(spent)", "remaining": "\(remaining)",
          "percent_used": \(percentUsed),
          "period_start": "2026-03-01", "period_end": "2026-03-31",
          "days_elapsed": \(daysElapsed), "days_total": \(daysTotal),
          "projected_spend": "\(projectedSpend)", "projected_over": \(projectedOver)
        }
        """.data(using: .utf8)!
        return try decoder.decode(BudgetStatusRow.self, from: json)
    }

    private func fund(
        monthsCovered: String = "6.0",
        targetMonths: Double = 6
    ) throws -> EmergencyFundResponse {
        let json = """
        {
          "household_id": "hh", "base_currency": "USD", "as_of": "2026-07-15",
          "liquid_total": "12000.00", "average_monthly_expenses": "2000.00",
          "months_covered": \(monthsCovered),
          "target_months": "\(targetMonths)", "target_amount": "12000.00",
          "shortfall": "0.00", "months_of_history": 6, "on_track": true
        }
        """.data(using: .utf8)!
        return try decoder.decode(EmergencyFundResponse.self, from: json)
    }

    // MARK: Budget tone

    @Test func flagsABudgetAlreadyOverspent() throws {
        #expect(BudgetPresentation.tone(for: try row(spent: 700, limit: 600)) == .over)
    }

    @Test func flagsABudgetOnPaceToOverspendBeforeItHas() throws {
        // The point of the projection: warn on the 10th, not the 30th.
        let r = try row(spent: 200, limit: 600, projectedOver: true)
        #expect(BudgetPresentation.tone(for: r) == .atRisk)
    }

    @Test func leavesABudgetWithinPaceAlone() throws {
        #expect(BudgetPresentation.tone(for: try row(spent: 100, projectedOver: false)) == .ok)
    }

    @Test func spendingExactlyTheLimitIsNotYetOver() throws {
        let r = try row(spent: 600, limit: 600, projectedOver: false)
        #expect(BudgetPresentation.tone(for: r) == .ok)
    }

    // MARK: Bar geometry

    @Test func barFractionClampsAnOverspentBudget() throws {
        #expect(BudgetPresentation.barFraction(for: try row(percentUsed: 250)) == 1)
    }

    @Test func barFractionSurvivesNonFinitePercent() throws {
        // JSON has no infinity literal, so this can't arrive over the wire —
        // build the row directly to exercise the defensive guard.
        let broken = BudgetStatusRow(
            budgetId: "b", categoryIds: ["c"], categoryNames: ["Dining"],
            period: .monthly, isPrivate: false,
            limit: 600, spent: 200, remaining: 400,
            percentUsed: .infinity,
            periodStart: Date(), periodEnd: Date(),
            daysElapsed: 10, daysTotal: 31,
            projectedSpend: 620, projectedOver: false
        )
        #expect(BudgetPresentation.barFraction(for: broken) == 0)
    }

    @Test func elapsedFractionSurvivesAZeroLengthPeriod() throws {
        #expect(BudgetPresentation.elapsedFraction(for: try row(daysElapsed: 5, daysTotal: 0)) == 0)
    }

    @Test func elapsedFractionClampsPastTheEnd() throws {
        #expect(BudgetPresentation.elapsedFraction(for: try row(daysElapsed: 40, daysTotal: 31)) == 1)
    }

    // MARK: Runway

    @Test func runwayLabelFormatsMonths() throws {
        #expect(BudgetPresentation.runwayLabel(try fund(monthsCovered: "6.0")) == "6.0 months")
        #expect(BudgetPresentation.runwayLabel(try fund(monthsCovered: "2.35")) == "2.4 months")
    }

    @Test func runwayLabelNeverImpliesAnInfiniteRunway() throws {
        // A household that hasn't logged expenses has an *undefined* runway.
        // "∞ months" would be false reassurance.
        #expect(BudgetPresentation.runwayLabel(try fund(monthsCovered: "null")) == "Not enough data")
    }

    @Test func runwayLabelCapsAtTheBackendCeiling() throws {
        #expect(BudgetPresentation.runwayLabel(try fund(monthsCovered: "99.0")) == "99+ months")
    }

    @Test func runwayToneEscalatesBelowOneMonth() throws {
        #expect(BudgetPresentation.runwayTone(try fund(monthsCovered: "0.5")) == .critical)
        #expect(BudgetPresentation.runwayTone(try fund(monthsCovered: "3.0")) == .low)
        #expect(BudgetPresentation.runwayTone(try fund(monthsCovered: "6.0")) == .ok)
        #expect(BudgetPresentation.runwayTone(try fund(monthsCovered: "9.0")) == .ok)
        #expect(BudgetPresentation.runwayTone(try fund(monthsCovered: "null")) == .unknown)
    }

    @Test func runwayFractionIsZeroWithoutATarget() throws {
        #expect(BudgetPresentation.runwayFraction(try fund(monthsCovered: "3.0", targetMonths: 0)) == 0)
    }

    // MARK: Recurring

    @Test func normalizesCadencesIntoAMonthlyCommitment() {
        // 100/week ≈ 433.33/month; 1200/year = 100/month.
        let rules = [
            makeRule(id: "a", categoryId: "expense-cat", amount: 100, frequency: .weekly),
            makeRule(id: "b", categoryId: "income-cat", amount: 1200, frequency: .yearly),
        ]
        let types: [String: TransactionType] = ["expense-cat": .expense, "income-cat": .income]
        let result = BudgetPresentation.monthlyCommitment(rules: rules, categoryTypes: types)

        #expect(abs(result.expense - 433.33) < 0.01)
        #expect(abs(result.income - 100) < 0.01)
        #expect(abs(result.net - (100 - 433.33)) < 0.01)
    }

    @Test func pausedRulesAreNotCommitments() {
        let rules = [
            makeRule(id: "a", categoryId: "c", amount: 500, frequency: .monthly, isActive: false)
        ]
        let result = BudgetPresentation.monthlyCommitment(rules: rules, categoryTypes: ["c": .expense])
        #expect(result.expense == 0)
    }

    @Test func netUpcomingNetsIncomeAgainstExpenses() {
        let items = [
            makeOccurrence(amount: 5000, type: .income),
            makeOccurrence(amount: 1800, type: .expense),
            makeOccurrence(amount: 200, type: .expense),
        ]
        #expect(BudgetPresentation.netUpcoming(items) == 3000)
    }

    @Test func netUpcomingIsZeroForAnEmptySchedule() {
        #expect(BudgetPresentation.netUpcoming([]) == 0)
    }

    @Test func groupsOccurrencesByMonthChronologically() {
        let items = [
            makeOccurrence(amount: 1, type: .expense, date: isoDate("2026-03-01")),
            makeOccurrence(amount: 1, type: .expense, date: isoDate("2026-01-01")),
            makeOccurrence(amount: 1, type: .expense, date: isoDate("2026-02-01")),
            makeOccurrence(amount: 1, type: .expense, date: isoDate("2026-01-15")),
        ]
        let groups = BudgetPresentation.groupedByMonth(items)
        #expect(groups.map(\.id) == ["2026-01", "2026-02", "2026-03"])
        #expect(groups[0].items.count == 2)
    }

    @Test func groupingAnEmptyScheduleYieldsNothing() {
        #expect(BudgetPresentation.groupedByMonth([]).isEmpty)
    }

    // MARK: Fixtures

    private func makeRule(
        id: String,
        categoryId: String,
        amount: Double,
        frequency: RecurrenceFrequency,
        isActive: Bool = true
    ) -> RecurringTransactionResponse {
        let json = """
        {
          "id": "\(id)", "household_id": "hh", "account_id": "acc",
          "category_id": "\(categoryId)", "amount": "\(amount)", "currency": null,
          "description": null, "frequency": "\(frequency.rawValue)",
          "start_date": "2026-01-01", "end_date": null,
          "next_due_date": "2026-02-01", "last_posted_date": null,
          "is_active": \(isActive), "owner_user_id": null
        }
        """.data(using: .utf8)!
        return try! decoder.decode(RecurringTransactionResponse.self, from: json)
    }

    private func makeOccurrence(
        amount: Double,
        type: TransactionType,
        date: String = "2026-03-01"
    ) -> UpcomingOccurrence {
        let json = """
        {
          "recurring_transaction_id": "r", "description": null,
          "category_name": "Rent", "account_name": "Checking",
          "date": "\(date)", "amount": "\(amount)", "currency": "USD",
          "transaction_type": "\(type.rawValue)"
        }
        """.data(using: .utf8)!
        return try! decoder.decode(UpcomingOccurrence.self, from: json)
    }

    private func isoDate(_ value: String) -> String { value }
}
