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
    /// Property, vehicles and other physical assets: part of net worth, never
    /// part of "liquid now".
    case illiquid

    var id: String { rawValue }

    var label: String {
        switch self {
        case .liquid: return "Liquid"
        case .marketLiquid: return "Market Liquid"
        case .timeLocked: return "Time Locked"
        case .retirement: return "Retirement"
        case .illiquid: return "Property"
        }
    }

    /// A liquidity value the app doesn't know about must not fail the decode of
    /// the whole accounts list — an older build should still show the accounts
    /// it understands rather than an empty screen.
    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = LiquidityStatus(rawValue: raw) ?? .liquid
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
    /// Reveals the optional MCC field on the transaction form. Recorded, never evaluated.
    let recordMerchantCodes: Bool?
    /// When true, private (vault) items require a biometric/passcode unlock to be shown.
    let requireFaceIdForVault: Bool?
    /// Preselected account for new expense/income transactions (QuickAdd, New Transaction).
    let defaultAccountId: String?

    var hidesPrivateFromHousehold: Bool { hidePrivateFromHousehold ?? true }
    var defaultsNewItemsPrivate: Bool { defaultNewItemsPrivate ?? true }
    /// Off unless the user asked for it — a four-digit field on every form would
    /// tax everyone for a minority feature.
    var recordsMerchantCodes: Bool { recordMerchantCodes ?? false }
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
    var recordMerchantCodes: Bool? = nil
    var requireFaceIdForVault: Bool? = nil
    var defaultAccountId: String? = nil
    /// Set true to explicitly clear defaultAccountId back to "always ask" — a nil
    /// defaultAccountId alone is indistinguishable from "not sending this field".
    var clearDefaultAccount: Bool? = nil
}

struct HouseholdResponse: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let baseCurrency: String
    let countryCode: String
    let defaultFundingAccountId: String?
    let defaultSubPortfolioId: String?
    /// Months of expenses the household wants held in liquid cash. Optional so
    /// older backends (before the emergency-fund migration) still decode.
    @OptionalMoneyAmount var emergencyFundTargetMonths: Double?
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
    var emergencyFundTargetMonths: Double? = nil
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
    /// Closed but kept. Optional on the wire, and a missing value means *open* —
    /// an absent flag must never hide an account.
    let isArchived: Bool?

    // Loan terms — liability accounts only. All optional: without the full set
    // the account keeps whatever balance was last entered, exactly as before.
    @OptionalMoneyAmount var originalPrincipal: Double?
    @OptionalMoneyAmount var interestRateAnnual: Double?   // percent per year
    let loanTermMonths: Int?
    @OptionalMoneyAmount var monthlyPayment: Double?       // derived if unset
    let loanStartDate: Date?

    // Property terms — illiquid asset accounts only. nil holds today's
    // valuation flat in the projection.
    @OptionalMoneyAmount var appreciationRateAnnual: Double?

    /// Ties a property to the loan secured against it (settable from either side).
    let linkedAccountId: String?

    var isLiability: Bool { kind == "liability" }

    /// Whether this liability has enough detail to amortize. Mirrors
    /// `loan_terms_for` on the backend — without all four there is no schedule.
    var hasLoanTerms: Bool {
        isLiability
            && (originalPrincipal ?? 0) > 0
            && interestRateAnnual != nil
            && (loanTermMonths ?? 0) > 0
            && loanStartDate != nil
    }
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

    // Optional loan/property terms. nil is omitted from the body, so an account
    // created without them behaves exactly as before.
    var originalPrincipal: Double? = nil
    var interestRateAnnual: Double? = nil
    var loanTermMonths: Int? = nil
    var monthlyPayment: Double? = nil
    /// Date-only field — encode with `Formatters.apiDateOnly`.
    var loanStartDate: String? = nil
    var appreciationRateAnnual: Double? = nil
    var linkedAccountId: String? = nil
    /// nil omits the key, which the backend's `exclude_unset` reads as "leave it
    /// alone" — so renaming an account cannot silently reopen it.
    var isArchived: Bool? = nil
}

/// PUT /accounts/{id} (schemas.AccountUpdate).
struct AccountUpdate: Encodable {
    let name: String
    let liquidity: LiquidityStatus
    let taxStatus: TaxTreatment
    let kind: AccountKind
    let currency: String
    let ownerUserId: String?

    var originalPrincipal: Double? = nil
    var interestRateAnnual: Double? = nil
    var loanTermMonths: Int? = nil
    var monthlyPayment: Double? = nil
    var loanStartDate: String? = nil
    var appreciationRateAnnual: Double? = nil
    var linkedAccountId: String? = nil
}

/// Just the archive flag.
///
/// A separate body from `AccountUpdate` on purpose: that type sends the account's
/// whole identity (name, liquidity, kind, currency…), and closing an account
/// should not restate all of it. The API's `exclude_unset` means the keys you
/// leave out are the ones it leaves alone.
struct AccountArchiveUpdate: Encodable {
    let isArchived: Bool
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

/// A row from GET /reference/mccs — static reference data, like currencies.
struct ReferenceMcc: Codable, Hashable {
    let code: String
    let name: String
    let group: String
    /// The 3000-3999 airline/hotel brand block. Rows arrive with these last already.
    let isBrand: Bool
}

struct CategoryResponse: Codable, Identifiable, Hashable {
    let id: String
    let householdId: String
    let name: String
    let type: TransactionType
    /// True for a bookkeeping category the app creates for itself (Transfer,
    /// Balance Adjustment, ...) rather than one a user chose — see the
    /// backend's SYSTEM_CATEGORY_NAMES. Filing a real transaction under one
    /// would misclassify it and fight the balance-reconciliation logic that
    /// owns it, so pickers (recurring rules) exclude these and the Categories
    /// screen marks them read-only.
    let isSystem: Bool
}

/// One counterparty's share of a transaction being created or edited.
struct TransactionSplitInput: Encodable, Hashable {
    let counterpartyId: String
    let amount: Double
}

/// One counterparty's share of a transaction, read back from the ledger.
struct TransactionSplitRow: Codable, Identifiable, Hashable {
    let counterpartyId: String
    let counterpartyName: String
    @MoneyAmount var amount: Double

    var id: String { counterpartyId }
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
    /// Part of this expense was one or more other people's. `amount` is still
    /// the full sum that left the account — the splits say whose the rest was,
    /// not what happened to the money. Empty means none of it was, which is
    /// also how every row logged before the ledger existed decodes.
    let splits: [TransactionSplitRow]
    /// The merchant category code, when the user happened to know it. Four digits
    /// or absent — nothing in the app derives anything from it.
    let mcc: String?
    /// Which of the card's own categories this counts towards, if any.
    let cardCategoryId: String?

    private enum CodingKeys: String, CodingKey {
        case id, accountId, categoryId, date, amount, amountHomeCurrency, currency
        case description, transactionType, transferId, splits, mcc, cardCategoryId
    }

    /// Hand-written only so `splits` can default to empty when the key is
    /// missing entirely, rather than failing to decode — a defensive fallback
    /// for any fixture or cached payload that predates this field.
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        accountId = try container.decode(String.self, forKey: .accountId)
        categoryId = try container.decode(String.self, forKey: .categoryId)
        date = try container.decode(Date.self, forKey: .date)
        _amount = try container.decode(MoneyAmount.self, forKey: .amount)
        _amountHomeCurrency = try container.decodeIfPresent(OptionalMoneyAmount.self, forKey: .amountHomeCurrency)
            ?? OptionalMoneyAmount(wrappedValue: nil)
        currency = try container.decodeIfPresent(String.self, forKey: .currency)
        description = try container.decodeIfPresent(String.self, forKey: .description)
        transactionType = try container.decode(TransactionType.self, forKey: .transactionType)
        transferId = try container.decodeIfPresent(String.self, forKey: .transferId)
        splits = try container.decodeIfPresent([TransactionSplitRow].self, forKey: .splits) ?? []
        mcc = try container.decodeIfPresent(String.self, forKey: .mcc)
        cardCategoryId = try container.decodeIfPresent(String.self, forKey: .cardCategoryId)
    }
}

struct TransactionCreate: Encodable {
    let date: Date
    let amount: Double
    let description: String?
    let accountId: String
    let categoryId: String
    /// Part of this expense was one or more other people's. Nil means no split
    /// at all — the key is simply omitted.
    var splits: [TransactionSplitInput]?
    /// Blank is sent as-is: the API reads "" as "not given" rather than rejecting
    /// it, so an empty picker needs no special-casing here.
    var mcc: String? = nil
    /// Nil falls to the card's default category, so untagged spend is still metered.
    var cardCategoryId: String? = nil
}

/// PUT /cashflow/transactions/{id} (schemas.TransactionUpdate).
/// `description` is always sent (empty string clears it); the sign follows the category.
struct TransactionUpdate: Encodable {
    let date: Date
    let amount: Double
    let description: String
    let accountId: String
    let categoryId: String
    /// Omit to leave the split already recorded alone; send `[]` to clear it and
    /// make the whole expense the household's own again; send a populated array
    /// to replace it wholesale. A plain optional array already has an
    /// unambiguous empty state, so — unlike `cardCategoryId` below — there is no
    /// need for a hand-rolled tri-state wrapper here.
    var splits: [TransactionSplitInput]?

    /// Always sent, like `description`. No default: `""` *clears* a recorded code,
    /// so the destructive value must never be the one you get by forgetting.
    let mcc: String

    /// The card's own category. Always sent, and nil encodes as an explicit
    /// JSON null rather than an omitted key — omitting it would mean "preserve",
    /// and there would then be no way to untag a transaction at all.
    let cardCategoryId: String?

    private enum CodingKeys: String, CodingKey {
        case date, amount, description, accountId, categoryId, splits, mcc, cardCategoryId
    }

    /// Hand-written only because `cardCategoryId` needs an explicit JSON null on
    /// nil rather than an omitted key (see above) — the synthesized encoder
    /// can't express that. `splits` uses ordinary `encodeIfPresent` semantics:
    /// nil omits the key, `[]` sends an empty array, a populated array sends it.
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(date, forKey: .date)
        try container.encode(amount, forKey: .amount)
        try container.encode(description, forKey: .description)
        try container.encode(accountId, forKey: .accountId)
        try container.encode(categoryId, forKey: .categoryId)
        try container.encode(mcc, forKey: .mcc)
        // `encode` rather than `encodeIfPresent`: nil has to reach the wire as
        // null, because that is what clears the tag.
        try container.encode(cardCategoryId, forKey: .cardCategoryId)
        try container.encodeIfPresent(splits, forKey: .splits)
    }
}

// MARK: - Reimbursements

/// Which way a debt runs, named from the household's point of view.
enum CounterpartyDirection: String, Codable {
    case owedToYou = "owed_to_you"
    case youOwe = "you_owe"
}

/// A reusable person split expenses are tracked against, scoped to a household —
/// picked from a list instead of retyped as a free-text name every time.
struct Counterparty: Codable, Identifiable, Hashable {
    let id: String
    let householdId: String
    let name: String
}

/// POST /cashflow/counterparties (schemas.CounterpartyCreate).
struct CounterpartyCreate: Encodable {
    let householdId: String
    let name: String
}

/// PUT /cashflow/counterparties/{id} (schemas.CounterpartyUpdate).
struct CounterpartyUpdate: Encodable {
    let name: String
}

/// GET /cashflow/reimbursements/household/{id}.
struct CounterpartyBalanceResponse: Codable, Identifiable, Hashable {
    let counterpartyId: String
    let counterpartyName: String
    let direction: CounterpartyDirection
    @MoneyAmount var amount: Double
    /// Which owner scope this debt belongs to (nil = shared with the household),
    /// not which account happens to settle it. Must be echoed back unchanged on
    /// `SettlementCreate.ownerUserId` — see the note there.
    let ownerUserId: String?

    /// One person can appear in both directions, so the id alone is not unique either.
    var id: String { "\(direction.rawValue):\(counterpartyId)" }
}

/// POST /cashflow/reimbursements/on-behalf. Somebody else paid for something of
/// yours: no account and no amount leaving one, because none did.
struct SpendOnYourBehalfCreate: Encodable {
    let householdId: String
    let categoryId: String
    let counterpartyId: String
    let amount: Double
    let date: Date
    let description: String?
}

/// POST /cashflow/reimbursements/settle. Money actually changing hands to clear
/// a debt — it moves an account balance but charges no category.
struct SettlementCreate: Encodable {
    let accountId: String
    let counterpartyId: String
    let direction: CounterpartyDirection
    let amount: Double
    let date: Date
    let description: String?
    /// The debt's own owner scope (`CounterpartyBalanceResponse.ownerUserId`),
    /// not the settling account's. Passing the settling account's owner instead
    /// opens a second, disconnected ledger account whenever the two differ,
    /// leaving the original debt outstanding instead of clearing it.
    let ownerUserId: String?
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
    /// Cash (CASH.<CUR>) and earmarked-account (ACCT.<uuid>) holdings are generated
    /// from the account or sub-portfolio they stand for; the API refuses to edit them.
    var isPseudoAsset: Bool { type == "cash" || type == "linked_account" }
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

/// PUT /portfolio/assets/{id} (schemas.AssetUpdate). Corrects an asset's identity --
/// most often a ticker created under the wrong currency. Changing the ticker or the
/// currency replays the holding households' snapshots server-side, so reload after.
struct AssetUpdate: Encodable {
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

/// One (date, sub-portfolio) total — the per-asset PortfolioSnapshot rows summed
/// server-side. Chart/goal-history consumers use this instead of raw snapshots since they
/// never need per-asset detail; see `equityCurve`/`valueHistory` in PortfolioAnalytics.swift
/// and GoalProjection.swift, which are generic over `SnapshotValuePoint` so either model works.
struct PortfolioTimeseriesPoint: Codable {
    let date: Date
    let subPortfolioId: String
    @MoneyAmount var totalValueHomeCurrency: Double
}

struct DividendResponse: Codable, Identifiable {
    let id: String
    let assetId: String
    let subPortfolioId: String
    let date: Date
    @MoneyAmount var amount: Double
    @OptionalMoneyAmount var amountHomeCurrency: Double?
    /// Payout per share, in the asset's own currency. Optional on the backend, so nil for
    /// hand-entered dividends that only recorded a total.
    @OptionalMoneyAmount var perShareAmount: Double?
    /// Shares held at the ex-date. Optional for the same reason as `perShareAmount`.
    let quantity: Double?
    /// True when entered by hand rather than synced from market data.
    let isManual: Bool?
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
    /// True when the window was long enough (>= 1 year) for the two returns
    /// above to be annualized; false when they are plain period returns over
    /// the window. Optional so older backends still decode.
    let annualized: Bool?
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

// MARK: - Loans, property & net worth projection
//
// Mirrors the schemas added alongside `backend/src/services/loan_service.py`.
// A mortgage recorded as a plain liability makes net worth read like a
// catastrophe: the debt is there in full and the house it bought is not. These
// types carry the amortization and the forward trajectory that fix that.

struct AmortizationRow: Codable, Identifiable, Hashable {
    let period: Int
    let date: Date
    @MoneyAmount var payment: Double
    @MoneyAmount var interest: Double
    @MoneyAmount var principal: Double
    @MoneyAmount var balance: Double

    var id: Int { period }
}

/// GET /accounts/{id}/loan-schedule
struct LoanScheduleResponse: Codable {
    let accountId: String
    let accountName: String
    let currency: String
    @MoneyAmount var originalPrincipal: Double
    @MoneyAmount var interestRateAnnual: Double
    let loanTermMonths: Int
    @MoneyAmount var monthlyPayment: Double
    let loanStartDate: Date
    /// nil when the payment is too small to ever clear the balance.
    let payoffDate: Date?
    @MoneyAmount var currentBalance: Double
    @MoneyAmount var principalPaid: Double
    @MoneyAmount var interestPaid: Double
    @MoneyAmount var totalInterest: Double
    @MoneyAmount var remainingInterest: Double
    let schedule: [AmortizationRow]
}

struct NetWorthProjectionPoint: Codable, Identifiable, Hashable {
    let date: Date
    @MoneyAmount var assets: Double
    @MoneyAmount var liabilities: Double
    @MoneyAmount var netWorth: Double

    var id: Date { date }
}

/// GET /accounts/household/{id}/projection
struct NetWorthProjectionResponse: Codable {
    let householdId: String
    let baseCurrency: String
    let start: Date
    let months: Int
    @MoneyAmount var currentNetWorth: Double
    /// When the household stops being underwater; nil if it never crosses
    /// inside the projected window.
    let netWorthPositiveDate: Date?
    let debtFreeDate: Date?
    @MoneyAmount var totalInterestRemaining: Double
    let points: [NetWorthProjectionPoint]
}

/// GET /accounts/household/{id}/equity — a property netted against its loan.
struct LinkedEquityRow: Codable, Identifiable, Hashable {
    let assetAccountId: String
    let assetAccountName: String
    @MoneyAmount var assetValue: Double
    let loanAccountId: String?
    let loanAccountName: String?
    @MoneyAmount var loanBalance: Double
    @MoneyAmount var equity: Double
    let equityPercent: Double?

    var id: String { assetAccountId }
}

// MARK: - Recurring transactions

enum RecurrenceFrequency: String, Codable, CaseIterable, Identifiable {
    case weekly
    case biweekly
    case monthly
    case quarterly
    case yearly

    var id: String { rawValue }

    var label: String {
        switch self {
        case .weekly: return "Weekly"
        case .biweekly: return "Every 2 weeks"
        case .monthly: return "Monthly"
        case .quarterly: return "Quarterly"
        case .yearly: return "Yearly"
        }
    }

    /// How many times a year this fires — used to normalize rules of different
    /// cadences into one comparable "per month" commitment figure.
    var occurrencesPerMonth: Double {
        switch self {
        case .weekly: return 52.0 / 12.0
        case .biweekly: return 26.0 / 12.0
        case .monthly: return 1
        case .quarterly: return 1.0 / 3.0
        case .yearly: return 1.0 / 12.0
        }
    }

    /// An unknown cadence must not fail the decode of the whole list.
    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = RecurrenceFrequency(rawValue: raw) ?? .monthly
    }
}

struct RecurringTransactionResponse: Codable, Identifiable, Hashable {
    let id: String
    let householdId: String
    let accountId: String
    let categoryId: String
    /// Positive magnitude; direction comes from the category.
    @MoneyAmount var amount: Double
    let currency: String?
    let description: String?
    let frequency: RecurrenceFrequency
    let startDate: Date
    let endDate: Date?
    let nextDueDate: Date
    let lastPostedDate: Date?
    let isActive: Bool
    let ownerUserId: String?
}

struct RecurringTransactionCreate: Encodable {
    let householdId: String
    let accountId: String
    let categoryId: String
    let amount: Double
    let description: String?
    let frequency: RecurrenceFrequency
    /// Date-only strings — see Formatters.apiDateOnly.
    let startDate: String
    let endDate: String?
    let ownerUserId: String?
}

/// PUT /cashflow/recurring/{id}. Every field optional; omitted keys are left alone.
/// Used only for the pause/resume toggle, which sends `isActive` alone.
struct RecurringTransactionUpdate: Encodable {
    var amount: Double? = nil
    var description: String? = nil
    var frequency: RecurrenceFrequency? = nil
    var startDate: String? = nil
    var endDate: String? = nil
    var isActive: Bool? = nil
}

/// PUT /cashflow/recurring/{id} from the edit form, which resends every field
/// like the web edit action does — so `description`/`endDate` must reach the
/// wire as an explicit JSON `null` when cleared rather than an omitted key
/// (which the backend's `exclude_unset` would read as "leave alone"). Mirrors
/// `TransactionUpdate`'s hand-written encoder for the same reason.
struct RecurringTransactionEdit: Encodable {
    let accountId: String
    let categoryId: String
    let amount: Double
    let description: String?
    let frequency: RecurrenceFrequency
    /// Date-only strings — see Formatters.apiDateOnly.
    let startDate: String
    let endDate: String?

    private enum CodingKeys: String, CodingKey {
        case accountId, categoryId, amount, description, frequency, startDate, endDate
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(accountId, forKey: .accountId)
        try container.encode(categoryId, forKey: .categoryId)
        try container.encode(amount, forKey: .amount)
        // `encode` rather than `encodeIfPresent`: nil must reach the wire as
        // null, because that is what clears a description/end date.
        try container.encode(description, forKey: .description)
        try container.encode(frequency, forKey: .frequency)
        try container.encode(startDate, forKey: .startDate)
        try container.encode(endDate, forKey: .endDate)
    }
}

/// GET /cashflow/recurring/household/{id}/upcoming
struct UpcomingOccurrence: Codable, Identifiable, Hashable {
    let recurringTransactionId: String
    let description: String?
    let categoryName: String
    let accountName: String
    let date: Date
    @MoneyAmount var amount: Double
    let currency: String?
    let transactionType: TransactionType

    /// Occurrences repeat per rule, so the rule id alone isn't unique in a list.
    var id: String { "\(recurringTransactionId)-\(date.timeIntervalSince1970)" }
}

struct RecurringRunResponse: Codable {
    let posted: Int
}

// MARK: - Budgets & emergency fund

enum BudgetPeriod: String, Codable, CaseIterable, Identifiable {
    case monthly
    case yearly

    var id: String { rawValue }

    var label: String { self == .monthly ? "Monthly" : "Yearly" }

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = BudgetPeriod(rawValue: raw) ?? .monthly
    }
}

struct BudgetResponse: Codable, Identifiable, Hashable {
    let id: String
    let householdId: String
    let categoryIds: [String]
    @MoneyAmount var amount: Double
    let period: BudgetPeriod
    let ownerUserId: String?
}

struct BudgetCreate: Encodable {
    let householdId: String
    let categoryIds: [String]
    let amount: Double
    let period: BudgetPeriod
    let ownerUserId: String?
}

struct BudgetUpdate: Encodable {
    var amount: Double? = nil
    var period: BudgetPeriod? = nil
}

// MARK: - Cards & spend limits

enum CycleBasis: String, Codable, Hashable {
    case statement
    case calendar
}

enum LimitDirection: String, Codable, Hashable {
    case ceiling
    case floor
}

enum LimitResetBasis: String, Codable, Hashable {
    case cycle
    case calendarMonth = "calendar_month"
    case quarter
    case year
}

struct CardLimitResponse: Codable, Identifiable, Hashable {
    let id: String
    let cardId: String
    let name: String
    @MoneyAmount var amount: Double
    let direction: LimitDirection
    let resetBasis: LimitResetBasis
}

struct CardCategoryResponse: Codable, Identifiable, Hashable {
    let id: String
    let cardId: String
    let name: String
    let isDefault: Bool
    let sortOrder: Int
    /// Nil means tracked but unmetered — deliberately distinct from "nothing left".
    let limitId: String?
}

struct CardResponse: Codable, Identifiable, Hashable {
    let id: String
    let financialAccountId: String
    let accountName: String
    let currency: String?
    let cycleBasis: CycleBasis
    let statementDay: Int
    let categories: [CardCategoryResponse]
    let limits: [CardLimitResponse]
}

/// Deliberately the same shape as `BudgetStatusRow`, so `BudgetPresentation`'s
/// bar and pace fractions read it unchanged. `direction` is the one addition:
/// it says which way to read `remaining`.
struct CardLimitStatusRow: Codable, Identifiable, Hashable {
    let limitId: String
    let name: String
    let categoryNames: [String]
    let direction: LimitDirection
    @MoneyAmount var amount: Double
    @MoneyAmount var spent: Double
    /// Ceiling: headroom left. Floor: how much more is still needed.
    @MoneyAmount var remaining: Double
    let percentUsed: Double
    let periodStart: Date
    let periodEnd: Date
    let daysElapsed: Int
    let daysTotal: Int
    @MoneyAmount var projectedSpend: Double
    /// Ceiling: on pace to burst. Floor: on pace to fall short.
    let projectedMissed: Bool
    let settled: Bool

    var id: String { limitId }
}

struct CardCategorySpendRow: Codable, Identifiable, Hashable {
    let cardCategoryId: String
    let name: String
    @MoneyAmount var spent: Double

    var id: String { cardCategoryId }
}

struct CardStatusResponse: Codable, Hashable {
    let cardId: String
    let accountName: String
    let currency: String?
    let cycleStart: Date
    let cycleEnd: Date
    let limits: [CardLimitStatusRow]
    let categories: [CardCategorySpendRow]
}

struct CardCreate: Encodable {
    let financialAccountId: String
    let cycleBasis: String
    let statementDay: Int
}

struct CardLimitCreate: Encodable {
    let name: String
    let amount: Double
    let direction: String
    let resetBasis: String
}

struct CardCategoryCreate: Encodable {
    let name: String
    let limitId: String?
}

/// Sets a category as its card's default. `isDefault` is the only field sent —
/// the backend's `exclude_unset` leaves name/limit alone on an omitted key.
struct CardCategoryDefaultUpdate: Encodable {
    let isDefault = true
}

struct BudgetStatusRow: Codable, Identifiable, Hashable {
    let budgetId: String
    let categoryIds: [String]
    let categoryNames: [String]
    let period: BudgetPeriod
    let isPrivate: Bool
    @MoneyAmount var limit: Double
    @MoneyAmount var spent: Double
    @MoneyAmount var remaining: Double
    let percentUsed: Double
    let periodStart: Date
    let periodEnd: Date
    let daysElapsed: Int
    let daysTotal: Int
    /// Spend extrapolated to the end of the period at the current daily rate.
    @MoneyAmount var projectedSpend: Double
    let projectedOver: Bool

    var id: String { budgetId }
}

/// GET /cashflow/budgets/household/{id}/status
struct BudgetStatusResponse: Codable {
    let householdId: String
    let baseCurrency: String
    let asOf: Date
    @MoneyAmount var totalLimit: Double
    @MoneyAmount var totalSpent: Double
    let budgets: [BudgetStatusRow]
}

/// GET /cashflow/household/{id}/emergency-fund
struct EmergencyFundResponse: Codable {
    let householdId: String
    let baseCurrency: String
    let asOf: Date
    @MoneyAmount var liquidTotal: Double
    @MoneyAmount var averageMonthlyExpenses: Double
    /// nil when no spending has been recorded — an *undefined* runway, not an
    /// infinite one. Never render this as "∞".
    @OptionalMoneyAmount var monthsCovered: Double?
    @MoneyAmount var targetMonths: Double
    @MoneyAmount var targetAmount: Double
    @MoneyAmount var shortfall: Double
    let monthsOfHistory: Int
    let onTrack: Bool
}
