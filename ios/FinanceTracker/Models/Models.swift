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

enum TradeType: String, Codable, CaseIterable, Identifiable {
    case buy
    case sell

    var id: String { rawValue }

    var label: String { self == .buy ? "Buy" : "Sell" }
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

/// Which slice of the household's finances to show. Mirrors the web ViewModeContext:
/// - `blended`: shared items **and** my own private items (default; the only mode a
///   solo household ever uses).
/// - `household`: shared items only — everyone's shared money, nobody's private.
/// - `private`: only my own private items.
/// The server never returns *other* members' private data, so filtering here is purely
/// about my own private-vs-shared items.
enum ViewMode: String, CaseIterable, Identifiable {
    case blended
    case household
    case `private`

    var id: String { rawValue }

    var label: String {
        switch self {
        case .blended: return "Blended"
        case .household: return "Household"
        case .private: return "Private"
        }
    }

    var icon: String {
        switch self {
        case .blended: return "square.stack.3d.up.fill"
        case .household: return "house.fill"
        case .private: return "lock.fill"
        }
    }
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
    /// Private-vault preferences (schemas.UserBase). Optional so an older backend
    /// response still decodes; the defaults below mirror the server's.
    let hidePrivateFromHousehold: Bool?
    let defaultNewItemsPrivate: Bool?
    /// When true, private (vault) items require a biometric/passcode unlock to be shown.
    let requireFaceIdForVault: Bool?

    var hidesPrivateFromHousehold: Bool { hidePrivateFromHousehold ?? true }
    var defaultsNewItemsPrivate: Bool { defaultNewItemsPrivate ?? true }
    /// Backend defaults this to true; treat an absent value as false so we never lock a
    /// user out on a stale/minimal decode.
    var requiresFaceIdForVault: Bool { requireFaceIdForVault ?? false }
}

/// Partial update for PUT /users (schemas.UserUpdate). Every field is optional and nil
/// fields are omitted from the JSON body (synthesized `encodeIfPresent`), so the server
/// leaves anything we don't send unchanged.
struct UserUpdate: Encodable {
    var name: String? = nil
    var preferredTimezone: String? = nil
    var email: String? = nil
    var password: String? = nil
    var themeMode: String? = nil
    var primaryColor: String? = nil
    var secondaryColor: String? = nil
    var baseColor: String? = nil
    var hidePrivateFromHousehold: Bool? = nil
    var defaultNewItemsPrivate: Bool? = nil
    var requireFaceIdForVault: Bool? = nil
}

struct HouseholdResponse: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let baseCurrency: String
    let countryCode: String
    let defaultFundingAccountId: String?
    let defaultSubPortfolioId: String?
}

/// POST /users/households (schemas.HouseholdCreate). `default_split_mode` defaults to
/// "even" server-side, so we only send the essentials.
struct HouseholdCreate: Encodable {
    let name: String
    let baseCurrency: String
    let countryCode: String
}

/// PUT /users/households/{id} (schemas.HouseholdUpdate); nil fields are left unchanged.
struct HouseholdUpdate: Encodable {
    var name: String? = nil
    var baseCurrency: String? = nil
    var countryCode: String? = nil
}

// MARK: - Reference data (GET /reference/*)

struct ReferenceCurrency: Codable, Identifiable, Hashable {
    let code: String
    let name: String
    var id: String { code }
}

struct ReferenceCountry: Codable, Identifiable, Hashable {
    let code: String
    let name: String
    var id: String { code }
}

struct ReferenceTimezone: Codable, Identifiable, Hashable {
    let name: String
    let label: String
    var id: String { name }
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
/// `date` is a bare "yyyy-MM-dd" string (a `date` field — see Date.apiDateOnly).
struct BalanceCreate: Encodable {
    let accountId: String
    let date: String
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

/// POST /cashflow/transfers (schemas.TransferCreate). Creates a linked
/// withdrawal/deposit pair; the backend derives the "Transfer" category.
struct TransferCreate: Encodable {
    let fromAccountId: String
    let toAccountId: String
    let amount: Double
    let date: Date
    let description: String?
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
    let pricingMode: String?

    var isCash: Bool { type == "cash" }
    var isManualPriced: Bool { pricingMode == "manual" }
}

/// POST /portfolio/assets/{id}/price (schemas.ManualPriceCreate). Only valid for
/// manually-priced assets; re-runs snapshots so valuations update immediately.
/// `date` is a bare "yyyy-MM-dd" string (a `date` field — see Date.apiDateOnly).
struct ManualPriceCreate: Encodable {
    let householdId: String
    let date: String
    let price: Double
}

struct ManualPriceResponse: Codable {
    let ticker: String
    let date: Date
    @MoneyAmount var price: Double
    let currency: String
}

/// POST /portfolio/assets (schemas.AssetCreate). The id is client-generated.
struct AssetCreate: Encodable {
    let id: String
    let ticker: String
    let name: String
    let type: String
    let currency: String
    let pricingMode: String
}

/// POST /portfolio/trades (schemas.TradeCreate). Buy/sell of an asset into a
/// sub-portfolio, funded from an account (or the sub-portfolio's own cash).
struct TradeCreate: Encodable {
    let type: TradeType
    let date: Date
    let quantity: Double
    let price: Double
    let currency: String?
    let exchangeRate: Double
    let description: String?
    let householdId: String
    let subPortfolioId: String
    let assetId: String
    let accountId: String
    let settleFromCash: Bool
}

/// POST /portfolio/subportfolios/{id}/cash (schemas.SubPortfolioCashCreate).
/// Moves cash between a funding account and a sub-portfolio's cash pseudo-asset.
struct SubPortfolioCashCreate: Encodable {
    let householdId: String
    let accountId: String
    let direction: String  // "deposit" | "withdraw"
    let amount: Double
    let currency: String
    let date: Date
    let exchangeRate: Double
    let description: String?
}

/// schemas.TradeResponse — returned by trade create/update and the trades list.
struct TradeResponse: Codable, Identifiable {
    let id: String
    let householdId: String
    let subPortfolioId: String?
    let assetId: String?
    let accountId: String?
    let transactionId: String?
    /// Set when this trade was settled against sub-portfolio cash (has a companion cash leg).
    let settlementTradeId: String?
    let type: TradeType
    let date: Date
    let quantity: Double
    @MoneyAmount var price: Double
    let currency: String?
    let exchangeRate: Double
    let description: String?
}

/// PUT /portfolio/trades/{id} (schemas.TradeUpdate). Optional fields; only the ones sent
/// change. The ID fields are UUIDs (backend previously mis-typed them as ints).
struct TradeUpdate: Encodable {
    let type: TradeType?
    let date: Date?
    let quantity: Double?
    let price: Double?
    let currency: String?
    let exchangeRate: Double?
    let description: String?
    let subPortfolioId: String?
    let assetId: String?
    let accountId: String?
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

/// POST /portfolio/subportfolios (schemas.SubPortfolioCreate). A "goal" is just a
/// sub-portfolio with a target. `targetDate` is a bare "yyyy-MM-dd" string (a `date`
/// field — see Date.apiDateOnly); `ownerUserId` nil = shared, set = private to that user.
struct SubPortfolioCreate: Encodable {
    let householdId: String
    let name: String
    let riskProfile: String
    let targetAmount: Double?
    let targetDate: String?
    let ownerUserId: String?
}

/// PATCH /portfolio/subportfolios/{id} (schemas.SubPortfolioUpdate). Used to set a
/// goal's name and target. Only sent fields change; nil target fields are left as-is.
/// `targetDate` is a bare "yyyy-MM-dd" string (a `date` field — see Date.apiDateOnly).
///
/// Ownership is special: the backend uses `exclude_unset`, so omitting `owner_user_id`
/// leaves it alone while an explicit `null` clears it. A plain `String?` can only express
/// the former, so `ownerUserId` is a `.unchanged`/`.set` enum encoded by hand — that's
/// what lets a private goal be made shared again (the web UI can't).
struct SubPortfolioUpdate: Encodable {
    enum OwnerChange {
        case unchanged
        case set(String?)
    }

    let name: String
    let targetAmount: Double?
    let targetDate: String?
    var ownerUserId: OwnerChange = .unchanged

    private enum CodingKeys: String, CodingKey {
        case name, targetAmount, targetDate, ownerUserId
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(name, forKey: .name)
        try container.encodeIfPresent(targetAmount, forKey: .targetAmount)
        try container.encodeIfPresent(targetDate, forKey: .targetDate)
        if case .set(let owner) = ownerUserId {
            // encode(String?) writes an explicit null when owner is nil — the point.
            try container.encode(owner, forKey: .ownerUserId)
        }
    }
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

/// POST /portfolio/dividends (schemas.DividendCreate). Records a manual dividend payout
/// for an asset held in a sub-portfolio, attributed to a funding account.
struct DividendCreate: Encodable {
    let householdId: String
    let subPortfolioId: String
    let assetId: String
    let accountId: String
    let date: Date
    let amount: Double
    let exchangeRate: Double
}

struct PerformanceMetrics: Codable {
    let simpleReturn: Double
    let timeWeightedReturn: Double
    let moneyWeightedReturn: Double
    let volatility: Double
    let sharpeRatio: Double
    let sortinoRatio: Double
    /// nil when there's no benchmark data (beta unknown).
    let treynorRatio: Double?
    /// Jensen's alpha vs benchmark; nil when there's no benchmark data.
    let alpha: Double?
    let beta: Double?
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

// MARK: - Reports (GET /exports/household/{id}/report → schemas.HouseholdReportResponse)

struct ReportAccountRow: Codable, Identifiable {
    let id: String
    let name: String
    let kind: AccountKind
    let currency: String?
    let liquidity: LiquidityStatus?
    let isPrivate: Bool
    @OptionalMoneyAmount var balance: Double?
    @OptionalMoneyAmount var balanceHomeCurrency: Double?
    let balanceAsOf: Date?
}

struct ReportHoldingRow: Codable, Identifiable {
    let subPortfolio: String
    let ticker: String
    let assetName: String?
    let assetType: String?
    let quantity: Double
    @OptionalMoneyAmount var price: Double?
    let currency: String?
    @OptionalMoneyAmount var valueHomeCurrency: Double?
    @OptionalMoneyAmount var costBasisHomeCurrency: Double?
    @OptionalMoneyAmount var unrealizedGainHomeCurrency: Double?
    let asOf: Date

    var id: String { subPortfolio + "|" + ticker }
}

struct ReportCategoryFlow: Codable, Identifiable {
    let category: String
    let type: TransactionType
    @MoneyAmount var totalHomeCurrency: Double
    let transactionCount: Int

    var id: String { category + "|" + type.rawValue }
}

struct ReportGoalRow: Codable, Identifiable {
    let id: String
    let name: String
    let isPrivate: Bool
    @OptionalMoneyAmount var targetAmount: Double?
    let targetDate: Date?
    @MoneyAmount var currentValueHomeCurrency: Double
    let progressPercent: Double?
}

struct HouseholdReportResponse: Codable {
    let householdId: String
    let householdName: String?
    let baseCurrency: String?
    let generatedAt: Date
    let preparedFor: String
    let periodStart: Date
    let periodEnd: Date
    @MoneyAmount var totalAssets: Double
    @MoneyAmount var totalLiabilities: Double
    @MoneyAmount var netWorth: Double
    let accounts: [ReportAccountRow]
    @MoneyAmount var portfolioValue: Double
    @MoneyAmount var portfolioCostBasis: Double
    @MoneyAmount var portfolioUnrealizedGain: Double
    let holdings: [ReportHoldingRow]
    @MoneyAmount var incomeTotal: Double
    @MoneyAmount var expenseTotal: Double
    @MoneyAmount var netCashflow: Double
    let cashflowByCategory: [ReportCategoryFlow]
    @MoneyAmount var dividendsPeriodTotal: Double
    @MoneyAmount var dividendsAllTimeTotal: Double
    let goals: [ReportGoalRow]
}

// MARK: - Household members & invites (schemas in backend/src/routers/users.py)

enum HouseholdRole: String, Codable, CaseIterable, Identifiable {
    case owner, editor, viewer
    var id: String { rawValue }
    var label: String { rawValue.capitalized }
}

/// GET /users/householdmember/{household_id} (schemas.HouseholdMemberUserResponse).
struct HouseholdMemberUserResponse: Codable, Identifiable {
    let id: String
    let userId: String
    let householdId: String
    let role: HouseholdRole
    let name: String
    let email: String
}

/// GET /users/households/{household_id}/invites (schemas.HouseholdInviteResponse).
struct HouseholdInviteResponse: Codable, Identifiable {
    let id: String
    let householdId: String
    let email: String
    let role: HouseholdRole
    let invitedByUserId: String
    let status: String
    let createdAt: Date
}

/// POST /users/households/{household_id}/invites (schemas.HouseholdInviteCreate).
struct HouseholdInviteCreate: Encodable {
    let email: String
    let role: HouseholdRole
}
