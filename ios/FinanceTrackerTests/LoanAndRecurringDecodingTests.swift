import Foundation
import Testing
@testable import FinanceTracker

/// Decoding for the loan/property, recurring and budget schemas. A drift between
/// `Models.swift` and `backend/src/schemas.py` should fail here rather than
/// blanking a screen at runtime.
struct LoanAndRecurringDecodingTests {

    private let decoder = APIClient.decoder

    // MARK: Accounts with loan/property terms

    @Test func decodesAccountWithLoanTerms() throws {
        let json = """
        {
          "id": "acc-1", "household_id": "hh-1", "name": "HDB Mortgage",
          "liquidity": "liquid", "tax_status": "taxable", "kind": "liability",
          "currency": "SGD", "owner_user_id": null,
          "original_principal": "440000", "interest_rate_annual": "2.6",
          "loan_term_months": 300, "monthly_payment": null,
          "loan_start_date": "2026-07-01",
          "appreciation_rate_annual": null, "linked_account_id": "acc-2"
        }
        """.data(using: .utf8)!
        let account = try decoder.decode(AccountResponse.self, from: json)

        #expect(account.originalPrincipal == 440_000)
        #expect(account.interestRateAnnual == 2.6)
        #expect(account.loanTermMonths == 300)
        #expect(account.linkedAccountId == "acc-2")
        #expect(account.isLiability)
        #expect(account.hasLoanTerms)
    }

    @Test func accountWithoutFullTermsIsNotAmortizable() throws {
        // Mirrors `loan_terms_for` on the backend: a partial set means the
        // account keeps its flat manual balance, so there's no schedule to show.
        let json = """
        {
          "id": "acc-1", "household_id": "hh-1", "name": "Credit Card",
          "liquidity": "liquid", "tax_status": "taxable", "kind": "liability",
          "currency": "SGD", "owner_user_id": null,
          "original_principal": "5000", "interest_rate_annual": "18",
          "loan_term_months": null, "monthly_payment": null,
          "loan_start_date": null
        }
        """.data(using: .utf8)!
        let account = try decoder.decode(AccountResponse.self, from: json)
        #expect(!account.hasLoanTerms)
    }

    @Test func assetAccountIsNeverAmortizable() throws {
        let json = """
        {
          "id": "acc-1", "household_id": "hh-1", "name": "Flat",
          "liquidity": "illiquid", "tax_status": "taxable", "kind": "asset",
          "currency": "SGD", "owner_user_id": null,
          "appreciation_rate_annual": "2.5"
        }
        """.data(using: .utf8)!
        let account = try decoder.decode(AccountResponse.self, from: json)
        #expect(account.liquidity == .illiquid)
        #expect(account.appreciationRateAnnual == 2.5)
        #expect(!account.hasLoanTerms)
    }

    @Test func unknownLiquidityFallsBackInsteadOfFailingTheList() throws {
        // An older build must still show the accounts it understands rather
        // than an empty screen when the backend adds a bucket.
        let json = """
        {
          "id": "acc-1", "household_id": "hh-1", "name": "Something New",
          "liquidity": "crypto_vault", "tax_status": "taxable", "kind": "asset",
          "currency": "USD", "owner_user_id": null
        }
        """.data(using: .utf8)!
        let account = try decoder.decode(AccountResponse.self, from: json)
        #expect(account.liquidity == .liquid)
    }

    // MARK: Loan schedule

    @Test func decodesLoanSchedule() throws {
        let json = """
        {
          "account_id": "acc-1", "account_name": "HDB Mortgage", "currency": "SGD",
          "original_principal": "440000", "interest_rate_annual": "2.6",
          "loan_term_months": 300, "monthly_payment": "1996.15",
          "loan_start_date": "2026-07-01", "payoff_date": "2051-07-01",
          "current_balance": "440000.00", "principal_paid": "0.00",
          "interest_paid": "0.00", "total_interest": "158843.11",
          "remaining_interest": "158843.11",
          "schedule": [
            {"period": 1, "date": "2026-08-01", "payment": "1996.15",
             "interest": "953.33", "principal": "1042.82", "balance": "438957.18"}
          ]
        }
        """.data(using: .utf8)!
        let schedule = try decoder.decode(LoanScheduleResponse.self, from: json)

        #expect(schedule.monthlyPayment == 1996.15)
        #expect(schedule.payoffDate != nil)
        #expect(schedule.schedule.count == 1)
        #expect(schedule.schedule[0].interest == 953.33)
    }

    @Test func decodesLoanScheduleThatNeverPaysOff() throws {
        // Negative amortization: the backend returns a null payoff date rather
        // than inventing one.
        let json = """
        {
          "account_id": "a", "account_name": "Bad Loan", "currency": "USD",
          "original_principal": "100000", "interest_rate_annual": "12",
          "loan_term_months": 360, "monthly_payment": "100",
          "loan_start_date": "2026-01-01", "payoff_date": null,
          "current_balance": "100000.00", "principal_paid": "0.00",
          "interest_paid": "0.00", "total_interest": "0.00",
          "remaining_interest": "0.00", "schedule": []
        }
        """.data(using: .utf8)!
        let schedule = try decoder.decode(LoanScheduleResponse.self, from: json)
        #expect(schedule.payoffDate == nil)
    }

    // MARK: Projection & equity

    @Test func decodesNetWorthProjection() throws {
        let json = """
        {
          "household_id": "hh", "base_currency": "SGD", "start": "2026-07-25",
          "months": 360, "current_net_worth": "-239896.00",
          "net_worth_positive_date": "2034-10-25", "debt_free_date": null,
          "total_interest_remaining": "158843.11",
          "points": [
            {"date": "2026-07-25", "assets": "550104.00",
             "liabilities": "790000.00", "net_worth": "-239896.00"}
          ]
        }
        """.data(using: .utf8)!
        let projection = try decoder.decode(NetWorthProjectionResponse.self, from: json)

        #expect(projection.currentNetWorth == -239_896)
        #expect(projection.netWorthPositiveDate != nil)
        #expect(projection.debtFreeDate == nil)
        #expect(projection.points.count == 1)
    }

    @Test func decodesLinkedEquityRow() throws {
        let json = """
        [{
          "asset_account_id": "acc-1", "asset_account_name": "Punggol Flat",
          "asset_value": "550000.0", "loan_account_id": "acc-2",
          "loan_account_name": "HDB Mortgage", "loan_balance": "440000.0",
          "equity": "110000.0", "equity_percent": 20.0
        }]
        """.data(using: .utf8)!
        let rows = try decoder.decode([LinkedEquityRow].self, from: json)

        #expect(rows[0].equity == 110_000)
        #expect(rows[0].equityPercent == 20.0)
    }

    @Test func decodesUnencumberedProperty() throws {
        let json = """
        [{
          "asset_account_id": "acc-1", "asset_account_name": "Car",
          "asset_value": "20000.0", "loan_account_id": null,
          "loan_account_name": null, "loan_balance": "0.0",
          "equity": "20000.0", "equity_percent": 100.0
        }]
        """.data(using: .utf8)!
        let rows = try decoder.decode([LinkedEquityRow].self, from: json)
        #expect(rows[0].loanAccountId == nil)
        #expect(rows[0].equity == 20_000)
    }

    // MARK: Recurring & budgets

    @Test func decodesRecurringTransaction() throws {
        let json = """
        {
          "id": "r-1", "household_id": "hh", "account_id": "acc",
          "category_id": "cat", "amount": "2400", "currency": null,
          "description": "Rent", "frequency": "monthly",
          "start_date": "2026-06-01", "end_date": null,
          "next_due_date": "2026-08-01", "last_posted_date": "2026-07-01",
          "is_active": true, "owner_user_id": null
        }
        """.data(using: .utf8)!
        let rule = try decoder.decode(RecurringTransactionResponse.self, from: json)

        #expect(rule.amount == 2400)
        #expect(rule.frequency == .monthly)
        #expect(rule.isActive)
        #expect(rule.lastPostedDate != nil)
    }

    @Test func unknownFrequencyFallsBackToMonthly() throws {
        let json = """
        {
          "id": "r-1", "household_id": "hh", "account_id": "acc",
          "category_id": "cat", "amount": "10", "currency": null,
          "description": null, "frequency": "fortnightly",
          "start_date": "2026-06-01", "end_date": null,
          "next_due_date": "2026-08-01", "last_posted_date": null,
          "is_active": true, "owner_user_id": null
        }
        """.data(using: .utf8)!
        let rule = try decoder.decode(RecurringTransactionResponse.self, from: json)
        #expect(rule.frequency == .monthly)
    }

    @Test func decodesBudgetStatus() throws {
        let json = """
        {
          "household_id": "hh", "base_currency": "SGD", "as_of": "2026-07-25",
          "total_limit": "1200.00", "total_spent": "448.00",
          "budgets": [{
            "budget_id": "b", "category_ids": ["c"], "category_names": ["Dining"],
            "period": "monthly", "is_private": false,
            "limit": "500.00", "spent": "448.00", "remaining": "52.00",
            "percent_used": 89.6, "period_start": "2026-07-01",
            "period_end": "2026-07-31", "days_elapsed": 25, "days_total": 31,
            "projected_spend": "555.52", "projected_over": true
          }]
        }
        """.data(using: .utf8)!
        let status = try decoder.decode(BudgetStatusResponse.self, from: json)

        #expect(status.totalSpent == 448)
        #expect(status.budgets[0].projectedOver)
        #expect(BudgetPresentation.tone(for: status.budgets[0]) == .atRisk)
    }

    @Test func decodesEmergencyFundWithNullRunway() throws {
        let json = """
        {
          "household_id": "hh", "base_currency": "USD", "as_of": "2026-07-15",
          "liquid_total": "5000.00", "average_monthly_expenses": "0.00",
          "months_covered": null, "target_months": "6",
          "target_amount": "0.00", "shortfall": "0.00",
          "months_of_history": 0, "on_track": false
        }
        """.data(using: .utf8)!
        let fund = try decoder.decode(EmergencyFundResponse.self, from: json)

        #expect(fund.monthsCovered == nil)
        #expect(!fund.onTrack)
    }

    @Test func decodesHouseholdWithoutEmergencyTarget() throws {
        // An older backend response must still decode.
        let json = """
        {
          "id": "hh", "name": "Home", "base_currency": "USD",
          "country_code": "US", "default_funding_account_id": null,
          "default_sub_portfolio_id": null
        }
        """.data(using: .utf8)!
        let household = try decoder.decode(HouseholdResponse.self, from: json)
        #expect(household.emergencyFundTargetMonths == nil)
    }
}

/// URL building. A path carrying a query string must produce a real query, not
/// a percent-encoded "?" buried in the path — that silently 404s, which is how
/// the dashboard's net-worth outlook first went missing.
struct APIURLTests {

    private let base = URL(string: "http://localhost:8000")!

    @Test func plainPathIsUnchanged() {
        let url = APIClient.url(base: base, path: "/accounts/household/abc")
        #expect(url.absoluteString == "http://localhost:8000/accounts/household/abc")
    }

    @Test func queryStringBecomesARealQuery() {
        let url = APIClient.url(base: base, path: "/accounts/household/abc/projection?months=360")
        #expect(url.path() == "/accounts/household/abc/projection")
        #expect(url.query() == "months=360")
        #expect(!url.absoluteString.contains("%3F"))
    }

    @Test func multipleQueryItemsSurvive() {
        let url = APIClient.url(base: base, path: "/x?days=90&foo=bar")
        #expect(url.query()?.contains("days=90") == true)
        #expect(url.query()?.contains("foo=bar") == true)
    }

    @Test func emptyQueryIsIgnored() {
        let url = APIClient.url(base: base, path: "/x?")
        #expect(url.path() == "/x")
    }
}

/// The posting stats added to `RecurringTransactionResponse`.
///
/// They carry defaults so a client pointed at an older backend — and the
/// create/update responses, which return a freshly written row — decode rather
/// than failing the whole list. Swift's synthesized decoder does not obviously
/// honour a default for a missing key, so this pins it rather than assuming it.
struct RecurringPostingStatsDecodingTests {

    private static let base = """
    {
      "id": "01a04358-0000-0000-0000-000000000001",
      "household_id": "01a04358-0000-0000-0000-000000000002",
      "account_id": "01a04358-0000-0000-0000-000000000003",
      "category_id": "01a04358-0000-0000-0000-000000000004",
      "amount": "42.50",
      "currency": "SGD",
      "description": "Rent",
      "frequency": "monthly",
      "start_date": "2026-01-01",
      "end_date": null,
      "next_due_date": "2026-10-01",
      "last_posted_date": "2026-09-01",
      "is_active": true,
      "owner_user_id": null
    """

    @Test("Posting stats decode from the backend payload")
    func statsDecode() throws {
        let json = Self.base + """
        ,
          "posted_count": 3,
          "posted_total_home_currency": "127.50"
        }
        """
        let rule = try APIClient.decoder.decode(
            RecurringTransactionResponse.self, from: Data(json.utf8)
        )
        #expect(rule.timesPosted == 3)
        #expect(rule.totalPosted == 127.50)
    }

    @Test("A payload with no stats at all still decodes, reporting nothing posted")
    func missingStatsDecodeAsZero() throws {
        let json = Self.base + "\n}"
        let rule = try APIClient.decoder.decode(
            RecurringTransactionResponse.self, from: Data(json.utf8)
        )
        #expect(rule.postedCount == nil)
        #expect(rule.timesPosted == 0)
        #expect(rule.totalPosted == 0)
    }
}

/// What a rule records *about the payment* — the merchant code and the card
/// category it counts towards — and the three-state encoding that lets an edit
/// clear either one.
struct RecurringPaymentDetailCodingTests {

    @Test("A rule decodes the fields it records about the payment")
    func decodesPaymentDetail() throws {
        let json = """
        {
          "id": "01a04358-0000-0000-0000-000000000001",
          "household_id": "01a04358-0000-0000-0000-000000000002",
          "account_id": "01a04358-0000-0000-0000-000000000003",
          "category_id": "01a04358-0000-0000-0000-000000000004",
          "amount": "12.98", "currency": "SGD", "description": "Streaming",
          "frequency": "monthly", "start_date": "2026-01-01", "end_date": null,
          "next_due_date": "2026-10-01", "last_posted_date": null,
          "is_active": true, "owner_user_id": null,
          "mcc": "5814",
          "card_category_id": "01a04358-0000-0000-0000-000000000005"
        }
        """
        let rule = try APIClient.decoder.decode(
            RecurringTransactionResponse.self, from: Data(json.utf8)
        )
        #expect(rule.mcc == "5814")
        #expect(rule.cardCategoryId == "01a04358-0000-0000-0000-000000000005")
    }

    private func encodedKeys(_ edit: RecurringTransactionEdit) throws -> [String: Any] {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        let data = try encoder.encode(edit)
        return try JSONSerialization.jsonObject(with: data) as! [String: Any]
    }

    private func edit(mcc: String?, cardCategoryId: String?) -> RecurringTransactionEdit {
        RecurringTransactionEdit(
            accountId: "acc", categoryId: "cat", amount: 10,
            description: "Streaming", frequency: .monthly,
            startDate: "2026-01-01", endDate: nil,
            mcc: mcc, cardCategoryId: cardCategoryId, splits: nil
        )
    }

    @Test("Clearing either field sends an explicit null, never an omitted key")
    func clearingSendsNull() throws {
        // The form resends every field, and the backend's `exclude_unset` reads
        // an omitted key as "leave it alone" — so `encodeIfPresent` here would
        // make clearing a code silently do nothing.
        let object = try encodedKeys(edit(mcc: nil, cardCategoryId: nil))
        #expect(object.keys.contains("mcc"))
        #expect(object.keys.contains("card_category_id"))
        #expect(object["mcc"] is NSNull)
        #expect(object["card_category_id"] is NSNull)
    }

    @Test("A rule decodes the standing split, and its absence as no split")
    func decodesStandingSplit() throws {
        let base = """
        {
          "id": "r", "household_id": "hh", "account_id": "acc", "category_id": "cat",
          "amount": "1000", "currency": null, "description": "Rent",
          "frequency": "monthly", "start_date": "2026-01-01", "end_date": null,
          "next_due_date": "2026-10-01", "last_posted_date": null,
          "is_active": true, "owner_user_id": null
        """
        let withSplit = try APIClient.decoder.decode(
            RecurringTransactionResponse.self,
            from: Data((base + """
            ,
              "splits": [
                {"counterparty_id": "cp-1", "counterparty_name": "Alice", "amount": "400"}
              ]
            }
            """).utf8)
        )
        #expect(withSplit.standingSplits.count == 1)
        #expect(withSplit.standingSplits[0].counterpartyName == "Alice")
        #expect(withSplit.standingSplits[0].amount == 400)

        // Every rule created before the feature existed comes back this way.
        let without = try APIClient.decoder.decode(
            RecurringTransactionResponse.self, from: Data((base + "\n}").utf8)
        )
        #expect(without.standingSplits.isEmpty)
    }

    @Test("Leaving a split alone omits the key; clearing it sends an empty array")
    func splitIsThreeState() throws {
        // nil must *omit*, not null: the backend's `exclude_unset` is what makes
        // an unrelated edit preserve the recorded split.
        let untouched = try encodedKeys(
            RecurringTransactionEdit(
                accountId: "acc", categoryId: "cat", amount: 10, description: nil,
                frequency: .monthly, startDate: "2026-01-01", endDate: nil,
                mcc: nil, cardCategoryId: nil, splits: nil
            )
        )
        #expect(!untouched.keys.contains("splits"))

        let cleared = try encodedKeys(
            RecurringTransactionEdit(
                accountId: "acc", categoryId: "cat", amount: 10, description: nil,
                frequency: .monthly, startDate: "2026-01-01", endDate: nil,
                mcc: nil, cardCategoryId: nil, splits: []
            )
        )
        #expect((cleared["splits"] as? [Any])?.isEmpty == true)
    }

    @Test("A recorded code and category are sent as their values")
    func valuesAreSent() throws {
        let object = try encodedKeys(edit(mcc: "5814", cardCategoryId: "cc-1"))
        #expect(object["mcc"] as? String == "5814")
        #expect(object["card_category_id"] as? String == "cc-1")
    }
}
