import Foundation
import Testing
@testable import FinanceTracker

/// Decodes representative backend JSON payloads through the app's real decoder
/// (`APIClient.decoder`: `.convertFromSnakeCase` + the custom `DateParser` strategy),
/// so a schema drift between `Models.swift` and `backend/src/schemas.py` shows up as a
/// failing test rather than a runtime decode crash.
struct ModelDecodingTests {

    private let decoder = APIClient.decoder
    private let encoder = APIClient.encoder

    // MARK: snake_case → camelCase + Decimal-as-string

    @Test func decodesAccountResponse() throws {
        let json = """
        {
          "id": "acc-1",
          "household_id": "hh-1",
          "name": "Chase Checking",
          "liquidity": "market_liquid",
          "tax_status": "taxable",
          "kind": "asset",
          "currency": "USD",
          "owner_user_id": null
        }
        """.data(using: .utf8)!
        let acc = try decoder.decode(AccountResponse.self, from: json)
        #expect(acc.id == "acc-1")
        #expect(acc.householdId == "hh-1")
        #expect(acc.liquidity == .marketLiquid)
        #expect(acc.ownerUserId == nil)
    }

    @Test func decodesPrivateOwnerUserId() throws {
        let json = """
        {"id":"a","household_id":"h","name":"Vault","liquidity":"liquid",
         "tax_status":"taxable","kind":"asset","currency":"SGD","owner_user_id":"user-9"}
        """.data(using: .utf8)!
        let acc = try decoder.decode(AccountResponse.self, from: json)
        #expect(acc.ownerUserId == "user-9")
    }

    @Test func decodesTransactionWithDecimalStrings() throws {
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
        #expect(abs(txn.amount - 125.5) < 0.0001)
        #expect(abs((txn.amountHomeCurrency ?? 0) - 170.2) < 0.0001)
        #expect(txn.transactionType == .expense)
        #expect(txn.transferId == nil)
    }

    @Test func decodesPersonalSpendResponse() throws {
        let json = """
        {
          "household_id": "hh-1",
          "base_currency": "SGD",
          "period_start": "2026-08-01",
          "period_end": "2026-08-31",
          "total": "1355.00",
          "previous_period_start": "2026-07-01",
          "previous_period_end": "2026-07-31",
          "previous_total": "0.00",
          "categories": [
            {"category_id": "cat-1", "category_name": "Dining", "amount": "1355.00"}
          ]
        }
        """.data(using: .utf8)!
        let spend = try decoder.decode(PersonalSpendResponse.self, from: json)
        #expect(spend.baseCurrency == "SGD")
        #expect(abs(spend.total - 1355.0) < 0.0001)
        #expect(abs(spend.previousTotal - 0.0) < 0.0001)
        #expect(spend.categories.count == 1)
        #expect(spend.categories[0].categoryName == "Dining")
    }

    // MARK: date-only vs datetime parsing

    @Test func decodesDateOnlyField() throws {
        let json = """
        {
          "id": "sp-1",
          "household_id": "hh-1",
          "name": "House Downpayment",
          "risk_profile": "balanced",
          "target_date": "2027-12-31",
          "target_amount": "150000.00",
          "owner_user_id": null
        }
        """.data(using: .utf8)!
        let sp = try decoder.decode(SubPortfolioResponse.self, from: json)
        #expect(sp.name == "House Downpayment")
        #expect(abs((sp.targetAmount ?? 0) - 150_000) < 0.0001)
        // 2027-12-31 parsed at UTC midnight.
        let comps = Calendar(identifier: .gregorian).dateComponents(
            in: TimeZone(identifier: "UTC")!, from: try #require(sp.targetDate)
        )
        #expect(comps.year == 2027)
        #expect(comps.month == 12)
        #expect(comps.day == 31)
    }

    @Test func decodesFractionalZonedDatetime() throws {
        let json = """
        {
          "id": "d-1",
          "asset_id": "as-1",
          "sub_portfolio_id": "sp-1",
          "date": "2026-07-19T01:53:01.787071Z",
          "amount": "12.34",
          "amount_home_currency": null
        }
        """.data(using: .utf8)!
        let div = try decoder.decode(DividendResponse.self, from: json)
        #expect(abs(div.amount - 12.34) < 0.0001)
        #expect(div.amountHomeCurrency == nil)
    }

    @Test func decodesPerformanceMetrics() throws {
        // Backend serialises these as JSON numbers (floats), not strings.
        let json = """
        {
          "simple_return": 0.12,
          "time_weighted_return": 0.11,
          "money_weighted_return": 0.095,
          "annualized": true,
          "volatility": 0.18,
          "sharpe_ratio": 1.2,
          "sortino_ratio": 1.6,
          "treynor_ratio": 0.08,
          "alpha": 0.02,
          "beta": 1.05,
          "dividend_income": 1200.0,
          "dividend_yield": 0.021
        }
        """.data(using: .utf8)!
        let m = try decoder.decode(PerformanceMetrics.self, from: json)
        #expect(abs(m.sharpeRatio - 1.2) < 0.0001)
        #expect(abs(m.sortinoRatio - 1.6) < 0.0001)
        #expect(abs((m.beta ?? 0) - 1.05) < 0.0001)
        #expect(abs((m.alpha ?? 0) - 0.02) < 0.0001)
        #expect(m.annualized == true)
    }

    @Test func decodesPerformanceMetricsWithoutAnnualizedFlag() throws {
        // `annualized` is optional so a response from an older backend (or any
        // payload predating it) still decodes, reading as "not annualized".
        let json = """
        {
          "simple_return": 0.12,
          "time_weighted_return": 0.11,
          "money_weighted_return": 0.095,
          "volatility": 0.18,
          "sharpe_ratio": 1.2,
          "sortino_ratio": 1.6,
          "treynor_ratio": null,
          "alpha": null,
          "beta": null
        }
        """.data(using: .utf8)!
        let m = try decoder.decode(PerformanceMetrics.self, from: json)
        #expect(m.annualized == nil)
    }

    // MARK: encoding — snake_case out + partial-update omission semantics

    @Test func decodesDividendWithPerShareDetail() throws {
        let json = """
        {
          "id": "div-1",
          "household_id": "hh-1",
          "sub_portfolio_id": "sp-1",
          "asset_id": "a-1",
          "account_id": "acc-1",
          "date": "2026-03-12T00:00:00",
          "amount": "213.00",
          "exchange_rate": 1.0,
          "per_share_amount": "1.42",
          "quantity": 150.0,
          "amount_home_currency": "288.55",
          "is_manual": true
        }
        """.data(using: .utf8)!
        let dividend = try decoder.decode(DividendResponse.self, from: json)
        #expect(dividend.amount == 213.00)
        #expect(dividend.amountHomeCurrency == 288.55)
        #expect(dividend.perShareAmount == 1.42)
        #expect(dividend.quantity == 150.0)
        #expect(dividend.isManual == true)
    }

    @Test func decodesDividendWithoutOptionalDetail() throws {
        // Every optional on DividendBase can be absent; the sub-portfolio dividend list
        // must still decode rather than throwing and blanking the whole tab.
        let json = """
        {"id":"div-2","household_id":"hh-1","sub_portfolio_id":"sp-1","asset_id":"a-1",
         "account_id":"acc-1","date":"2026-03-12T00:00:00","amount":"10.00","exchange_rate":1.0}
        """.data(using: .utf8)!
        let dividend = try decoder.decode(DividendResponse.self, from: json)
        #expect(dividend.amount == 10.0)
        #expect(dividend.amountHomeCurrency == nil)
        #expect(dividend.perShareAmount == nil)
        #expect(dividend.quantity == nil)
        #expect(dividend.isManual == nil)
    }

    @Test func encodesSubPortfolioUpdateToSnakeCase() throws {
        let update = SubPortfolioUpdate(
            name: "Emergency Fund", targetAmount: 20_000, targetDate: "2028-01-01"
        )
        let text = String(data: try encoder.encode(update), encoding: .utf8)!
        #expect(text.contains("\"name\":\"Emergency Fund\""))
        #expect(text.contains("target_amount"))
        #expect(text.contains("target_date"))
        // .unchanged owner → the key is omitted entirely (backend exclude_unset leaves it).
        #expect(!text.contains("owner_user_id"))
    }

    @Test func subPortfolioUpdateSetNilEmitsExplicitNullOwner() throws {
        // "Private → Shared" must send an explicit owner_user_id: null.
        var update = SubPortfolioUpdate(name: "Fund", targetAmount: nil, targetDate: nil)
        update.ownerUserId = .set(nil)
        let text = String(data: try encoder.encode(update), encoding: .utf8)!
        #expect(text.contains("\"owner_user_id\":null"))
    }

    @Test func subPortfolioUpdateOmitsNilTargets() throws {
        let update = SubPortfolioUpdate(name: "Fund", targetAmount: nil, targetDate: nil)
        let text = String(data: try encoder.encode(update), encoding: .utf8)!
        #expect(!text.contains("target_amount"))
        #expect(!text.contains("target_date"))
    }

    @Test func encodesAssetUpdateToSnakeCase() throws {
        let update = AssetUpdate(
            ticker: "AAPL", name: "Apple Inc.", type: "stock",
            currency: "USD", pricingMode: "market"
        )
        let text = String(data: try encoder.encode(update), encoding: .utf8)!
        #expect(text.contains("\"ticker\":\"AAPL\""))
        #expect(text.contains("\"name\":\"Apple Inc.\""))
        #expect(text.contains("\"pricing_mode\":\"market\""))
    }
}
