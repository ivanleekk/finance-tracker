import Foundation

// Mirrors backend/src/schemas.py (see also mobile/src/types/types.ts).
// Decoded with .convertFromSnakeCase, so property names are camelCase.

// MARK: - Decimal-as-string decoding

/// Pydantic serializes Decimal fields as JSON strings ("5000.00") but float
/// fields as numbers — these wrappers accept either.
@propertyWrapper
struct MoneyAmount: Codable, Hashable {
    var wrappedValue: Double

    init(wrappedValue: Double) { self.wrappedValue = wrappedValue }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let number = try? container.decode(Double.self) {
            wrappedValue = number
        } else if let string = try? container.decode(String.self), let number = Double(string) {
            wrappedValue = number
        } else {
            throw DecodingError.dataCorruptedError(
                in: container, debugDescription: "Expected a number or numeric string"
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(wrappedValue)
    }
}

@propertyWrapper
struct OptionalMoneyAmount: Codable, Hashable {
    var wrappedValue: Double?

    init(wrappedValue: Double?) { self.wrappedValue = wrappedValue }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            wrappedValue = nil
        } else if let number = try? container.decode(Double.self) {
            wrappedValue = number
        } else if let string = try? container.decode(String.self) {
            wrappedValue = Double(string)
        } else {
            wrappedValue = nil
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(wrappedValue)
    }
}

extension KeyedDecodingContainer {
    /// Treat a missing key the same as an explicit null for optional money fields.
    func decode(_ type: OptionalMoneyAmount.Type, forKey key: Key) throws -> OptionalMoneyAmount {
        try decodeIfPresent(OptionalMoneyAmount.self, forKey: key) ?? OptionalMoneyAmount(wrappedValue: nil)
    }
}

// MARK: - Enums

enum LiquidityStatus: String, Codable, CaseIterable, Identifiable {
    case liquid
    case marketLiquid = "market_liquid"
    case timeLocked = "time_locked"
    case retirement

    var id: String { rawValue }

    var label: String {
        switch self {
        case .liquid: return "Liquid"
        case .marketLiquid: return "Market Liquid"
        case .timeLocked: return "Time Locked"
        case .retirement: return "Retirement"
        }
    }
}

enum TransactionType: String, Codable, CaseIterable, Identifiable {
    case income
    case expense

    var id: String { rawValue }
}

enum TaxTreatment: String, Codable, CaseIterable, Identifiable {
    case taxable
    case taxDeferred = "tax_deferred"
    case taxFree = "tax_free"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .taxable: return "Taxable"
        case .taxDeferred: return "Tax-Deferred"
        case .taxFree: return "Tax-Free"
        }
    }
}

enum AccountKind: String, Codable, CaseIterable, Identifiable {
    case asset
    case liability

    var id: String { rawValue }

    var label: String { self == .asset ? "Asset" : "Liability" }
}

// MARK: - Auth & Users

struct TokenResponse: Codable {
    let accessToken: String
    let refreshToken: String?
    let tokenType: String?
}

struct UserResponse: Codable, Identifiable {
    let id: String
    let email: String
    let name: String
    let preferredTimezone: String?
    let themeMode: String?
    let primaryColor: String?
    let secondaryColor: String?
    let baseColor: String?
}

/// Partial update for PUT /users (schemas.UserUpdate) — appearance fields only.
struct UserAppearanceUpdate: Encodable {
    let themeMode: String?
    let primaryColor: String?
    let secondaryColor: String?
    let baseColor: String?
}

struct HouseholdResponse: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let baseCurrency: String
    let countryCode: String
    let defaultFundingAccountId: String?
    let defaultSubPortfolioId: String?
}

// MARK: - Accounts & Balances

struct AccountResponse: Codable, Identifiable, Hashable {
    let id: String
    let householdId: String
    let name: String
    let liquidity: LiquidityStatus
    let taxStatus: String
    let kind: String?
    let currency: String
    /// nil = shared with the household; set = private to that user.
    let ownerUserId: String?
}

/// POST /accounts (schemas.AccountCreate).
struct AccountCreate: Encodable {
    let householdId: String
    let name: String
    let liquidity: LiquidityStatus
    let taxStatus: TaxTreatment
    let kind: AccountKind
    let currency: String
    let ownerUserId: String?
}

/// PUT /accounts/{id} (schemas.AccountUpdate).
struct AccountUpdate: Encodable {
    let name: String
    let liquidity: LiquidityStatus
    let taxStatus: TaxTreatment
    let kind: AccountKind
    let currency: String
    let ownerUserId: String?
}

struct BalanceResponse: Codable, Identifiable {
    let id: String
    let accountId: String
    let date: Date
    @MoneyAmount var balance: Double
    @OptionalMoneyAmount var balanceHomeCurrency: Double?
    let isManual: Bool

    var homeValue: Double { balanceHomeCurrency ?? balance }
}

/// POST /accounts/balances (schemas.BalanceCreate). Records/overwrites the manual
/// balance on `date`; the backend creates a reconciliation transaction for the delta.
struct BalanceCreate: Encodable {
    let accountId: String
    let date: Date
    let balance: Double
    let isManual: Bool
}

// MARK: - Cash flow

struct CategoryResponse: Codable, Identifiable, Hashable {
    let id: String
    let householdId: String
    let name: String
    let type: TransactionType
}

struct TransactionResponse: Codable, Identifiable {
    let id: String
    let accountId: String
    let categoryId: String
    let date: Date
    @MoneyAmount var amount: Double
    @OptionalMoneyAmount var amountHomeCurrency: Double?
    let currency: String?
    let description: String?
    let transactionType: TransactionType
    let transferId: String?
}

struct TransactionCreate: Encodable {
    let date: Date
    let amount: Double
    let description: String?
    let accountId: String
    let categoryId: String
}

/// PUT /cashflow/transactions/{id} (schemas.TransactionUpdate).
/// `description` is always sent (empty string clears it); the sign follows the category.
struct TransactionUpdate: Encodable {
    let date: Date
    let amount: Double
    let description: String
    let accountId: String
    let categoryId: String
}

/// POST /cashflow/categories (schemas.CategoryCreate).
struct CategoryCreate: Encodable {
    let householdId: String
    let name: String
    let type: TransactionType
}

/// PUT /cashflow/categories/{id} (schemas.CategoryUpdate).
struct CategoryUpdate: Encodable {
    let name: String
    let type: TransactionType
}

// MARK: - Portfolio

struct AssetResponse: Codable, Identifiable, Hashable {
    let id: String
    let ticker: String
    let name: String
    let type: String
    let currency: String

    var isCash: Bool { type == "cash" }
}

struct SubPortfolioResponse: Codable, Identifiable, Hashable {
    let id: String
    let householdId: String
    let name: String
    let riskProfile: String?
    let targetDate: Date?
    @OptionalMoneyAmount var targetAmount: Double?
    let ownerUserId: String?
}

/// PATCH /portfolio/subportfolios/{id} (schemas.SubPortfolioUpdate). Used to set a
/// goal's name and target. Only sent fields change; nil target fields are left as-is.
struct SubPortfolioUpdate: Encodable {
    let name: String
    let targetAmount: Double?
    let targetDate: Date?
}

struct PortfolioSnapshotResponse: Codable, Identifiable {
    let id: String
    let householdId: String
    let subPortfolioId: String
    let assetId: String
    let date: Date
    let quantity: Double
    @MoneyAmount var price: Double
    let exchangeRateUsed: Double
    @MoneyAmount var currentValueHomeCurrency: Double
    @MoneyAmount var averageCostBasis: Double
    @MoneyAmount var averageCostBasisHomeCurrency: Double
}

struct DividendResponse: Codable, Identifiable {
    let id: String
    let assetId: String
    let subPortfolioId: String
    let date: Date
    @MoneyAmount var amount: Double
    @OptionalMoneyAmount var amountHomeCurrency: Double?
}

struct PerformanceMetrics: Codable {
    let simpleReturn: Double
    let timeWeightedReturn: Double
    let moneyWeightedReturn: Double
    let volatility: Double
    let sharpeRatio: Double
    let dividendIncome: Double?
    let dividendYield: Double?
}

struct SubPortfolioMetricsResponse: Codable, Identifiable {
    let subPortfolioId: String
    let name: String
    let metrics: PerformanceMetrics

    var id: String { subPortfolioId }
}

struct PortfolioMetricsResponse: Codable {
    let householdId: String
    let overallMetrics: PerformanceMetrics
    let subPortfolioMetrics: [SubPortfolioMetricsResponse]
}
