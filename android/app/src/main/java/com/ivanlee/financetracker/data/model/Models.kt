package com.ivanlee.financetracker.data.model

import com.ivanlee.financetracker.data.net.InstantSerializer
import com.ivanlee.financetracker.data.net.MoneySerializer
import com.ivanlee.financetracker.data.net.OptionalInstantSerializer
import com.ivanlee.financetracker.data.net.OptionalMoneySerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import java.time.Instant

// Mirrors backend/src/schemas.py (see also ios/FinanceTracker/Models/Models.swift).
//
// Decoded with JsonNamingStrategy.SnakeCase, so property names are the camelCase versions of
// the Pydantic field names — the same rule as iOS's `.convertFromSnakeCase`.
//
// TWO THINGS THAT WILL BITE:
//  - Money fields must be annotated @Serializable(with = MoneySerializer::class) (or the
//    Optional variant). Pydantic writes Decimal as a JSON *string*; a plain Double fails.
//  - Every request body relies on `explicitNulls = false` (see Api.json): a null property is
//    omitted from the body, so the server leaves that field unchanged.

// MARK: - Auth & Users

@Serializable
data class TokenResponse(
    val accessToken: String,
    val refreshToken: String? = null,
    val tokenType: String? = null,
)

@Serializable
data class UserResponse(
    val id: String,
    val email: String,
    val name: String,
    val preferredTimezone: String? = null,
    val themeMode: String? = null,
    val primaryColor: String? = null,
    val secondaryColor: String? = null,
    val baseColor: String? = null,
    /** Private-vault preferences (schemas.UserBase). Optional so an older backend still decodes. */
    val hidePrivateFromHousehold: Boolean? = null,
    val defaultNewItemsPrivate: Boolean? = null,
    /**
     * When true, private (vault) items require a biometric/device-credential unlock.
     * The backend column is `require_face_id_for_vault` — an iOS-flavoured name for a
     * cross-platform flag — so the wire name is pinned while the Kotlin name says what it
     * actually means here (fingerprint, face, or device PIN).
     */
    @SerialName("require_face_id_for_vault")
    val requireBiometricForVault: Boolean? = null,
    /** Preselected account for new expense/income transactions (Quick Add, New Transaction). */
    val defaultAccountId: String? = null,
) {
    val hidesPrivateFromHousehold: Boolean get() = hidePrivateFromHousehold ?: true
    val defaultsNewItemsPrivate: Boolean get() = defaultNewItemsPrivate ?: true

    /**
     * Backend defaults this to true; treat an absent value as false so we never lock a user
     * out on a stale/minimal decode.
     */
    val requiresBiometricForVault: Boolean get() = requireBiometricForVault ?: false
}

/**
 * Partial update for PUT /users (schemas.UserUpdate). Every field is optional and nulls are
 * omitted from the body, so the server leaves anything we don't send unchanged.
 */
@Serializable
data class UserUpdate(
    val name: String? = null,
    val preferredTimezone: String? = null,
    val email: String? = null,
    val password: String? = null,
    val themeMode: String? = null,
    val primaryColor: String? = null,
    val secondaryColor: String? = null,
    val baseColor: String? = null,
    val hidePrivateFromHousehold: Boolean? = null,
    val defaultNewItemsPrivate: Boolean? = null,
    @SerialName("require_face_id_for_vault")
    val requireBiometricForVault: Boolean? = null,
    val defaultAccountId: String? = null,
    /**
     * Set true to explicitly clear defaultAccountId back to "always ask" — a null
     * defaultAccountId alone is indistinguishable from "not sending this field".
     */
    val clearDefaultAccount: Boolean? = null,
)

@Serializable
data class UserCreate(val email: String, val password: String, val name: String)

@Serializable
data class HouseholdResponse(
    val id: String,
    val name: String,
    val baseCurrency: String,
    val countryCode: String,
    val defaultFundingAccountId: String? = null,
    val defaultSubPortfolioId: String? = null,
    /** Months of expenses the household wants held in liquid cash. */
    @Serializable(with = OptionalMoneySerializer::class)
    val emergencyFundTargetMonths: Double? = null,
)

/** POST /users/households (schemas.HouseholdCreate). */
@Serializable
data class HouseholdCreate(
    val name: String,
    val baseCurrency: String,
    val countryCode: String,
)

/** PUT /users/households/{id} (schemas.HouseholdUpdate); null fields are left unchanged. */
@Serializable
data class HouseholdUpdate(
    val name: String? = null,
    val baseCurrency: String? = null,
    val countryCode: String? = null,
    val emergencyFundTargetMonths: Double? = null,
)

// MARK: - Reference data (GET /reference/*)

@Serializable
data class ReferenceCurrency(val code: String, val name: String)

@Serializable
data class ReferenceCountry(val code: String, val name: String)

@Serializable
data class ReferenceTimezone(val name: String, val label: String)

// MARK: - Accounts & Balances

@Serializable
data class AccountResponse(
    val id: String,
    val householdId: String,
    val name: String,
    val liquidity: LiquidityStatus,
    val taxStatus: String,
    val kind: String? = null,
    val currency: String,
    /** null = shared with the household; set = private to that user. */
    val ownerUserId: String? = null,

    // Loan terms — liability accounts only. All optional: without the full set the account
    // keeps whatever balance was last entered, exactly as before.
    @Serializable(with = OptionalMoneySerializer::class)
    val originalPrincipal: Double? = null,
    @Serializable(with = OptionalMoneySerializer::class)
    val interestRateAnnual: Double? = null, // percent per year
    val loanTermMonths: Int? = null,
    @Serializable(with = OptionalMoneySerializer::class)
    val monthlyPayment: Double? = null, // derived if unset
    @Serializable(with = OptionalInstantSerializer::class)
    val loanStartDate: Instant? = null,

    // Property terms — illiquid asset accounts only. null holds today's valuation flat.
    @Serializable(with = OptionalMoneySerializer::class)
    val appreciationRateAnnual: Double? = null,

    /** Ties a property to the loan secured against it (settable from either side). */
    val linkedAccountId: String? = null,
) {
    val isLiability: Boolean get() = kind == "liability"

    /**
     * Whether this liability has enough detail to amortize. Mirrors `loan_terms_for` on the
     * backend — without all four there is no schedule.
     */
    val hasLoanTerms: Boolean
        get() = isLiability &&
            (originalPrincipal ?: 0.0) > 0 &&
            interestRateAnnual != null &&
            (loanTermMonths ?: 0) > 0 &&
            loanStartDate != null
}

/** POST /accounts (schemas.AccountCreate). */
@Serializable
data class AccountCreate(
    val householdId: String,
    val name: String,
    val liquidity: LiquidityStatus,
    val taxStatus: TaxTreatment,
    val kind: AccountKind,
    val currency: String,
    val ownerUserId: String? = null,
    val originalPrincipal: Double? = null,
    val interestRateAnnual: Double? = null,
    val loanTermMonths: Int? = null,
    val monthlyPayment: Double? = null,
    /** Date-only field — encode with `Instant.apiDateOnly()`. */
    val loanStartDate: String? = null,
    val appreciationRateAnnual: Double? = null,
    val linkedAccountId: String? = null,
)

/** PUT /accounts/{id} (schemas.AccountUpdate). */
@Serializable
data class AccountUpdate(
    val name: String,
    val liquidity: LiquidityStatus,
    val taxStatus: TaxTreatment,
    val kind: AccountKind,
    val currency: String,
    val ownerUserId: String? = null,
    val originalPrincipal: Double? = null,
    val interestRateAnnual: Double? = null,
    val loanTermMonths: Int? = null,
    val monthlyPayment: Double? = null,
    val loanStartDate: String? = null,
    val appreciationRateAnnual: Double? = null,
    val linkedAccountId: String? = null,
)

@Serializable
data class BalanceResponse(
    val id: String,
    val accountId: String,
    @Serializable(with = InstantSerializer::class)
    val date: Instant,
    @Serializable(with = MoneySerializer::class)
    val balance: Double,
    @Serializable(with = OptionalMoneySerializer::class)
    val balanceHomeCurrency: Double? = null,
    val isManual: Boolean = false,
) {
    val homeValue: Double get() = balanceHomeCurrency ?: balance
}

/**
 * POST /accounts/balances (schemas.BalanceCreate). Records/overwrites the manual balance on
 * `date`; the backend creates a reconciliation transaction for the delta. `date` is a bare
 * "yyyy-MM-dd" string.
 */
@Serializable
data class BalanceCreate(
    val accountId: String,
    val date: String,
    val balance: Double,
    val isManual: Boolean,
)

// MARK: - Cash flow

@Serializable
data class CategoryResponse(
    val id: String,
    val householdId: String,
    val name: String,
    val type: TransactionType,
)

@Serializable
data class TransactionResponse(
    val id: String,
    val accountId: String,
    val categoryId: String,
    @Serializable(with = InstantSerializer::class)
    val date: Instant,
    @Serializable(with = MoneySerializer::class)
    val amount: Double,
    @Serializable(with = OptionalMoneySerializer::class)
    val amountHomeCurrency: Double? = null,
    val currency: String? = null,
    val description: String? = null,
    val transactionType: TransactionType,
    val transferId: String? = null,
)

@Serializable
data class TransactionCreate(
    @Serializable(with = InstantSerializer::class)
    val date: Instant,
    val amount: Double,
    val description: String? = null,
    val accountId: String,
    val categoryId: String,
)

/**
 * PUT /cashflow/transactions/{id} (schemas.TransactionUpdate). `description` is always sent
 * (empty string clears it); the sign follows the category.
 */
@Serializable
data class TransactionUpdate(
    @Serializable(with = InstantSerializer::class)
    val date: Instant,
    val amount: Double,
    val description: String,
    val accountId: String,
    val categoryId: String,
)

/**
 * POST /cashflow/transfers (schemas.TransferCreate). Creates a linked withdrawal/deposit
 * pair; the backend derives the "Transfer" category.
 */
@Serializable
data class TransferCreate(
    val fromAccountId: String,
    val toAccountId: String,
    val amount: Double,
    @Serializable(with = InstantSerializer::class)
    val date: Instant,
    val description: String? = null,
)

@Serializable
data class CategoryCreate(
    val householdId: String,
    val name: String,
    val type: TransactionType,
)

@Serializable
data class CategoryUpdate(val name: String, val type: TransactionType)

// MARK: - Portfolio

@Serializable
data class AssetResponse(
    val id: String,
    val ticker: String,
    val name: String,
    val type: String,
    val currency: String,
    val pricingMode: String? = null,
) {
    val isCash: Boolean get() = type == "cash"
    val isManualPriced: Boolean get() = pricingMode == "manual"

    /**
     * Cash (CASH.<CUR>) and earmarked-account (ACCT.<uuid>) holdings are generated from the
     * account or sub-portfolio they stand for; the API refuses to edit them.
     */
    val isPseudoAsset: Boolean get() = type == "cash" || type == "linked_account"
}

/**
 * POST /portfolio/assets/{id}/price (schemas.ManualPriceCreate). Only valid for
 * manually-priced assets; re-runs snapshots so valuations update immediately.
 */
@Serializable
data class ManualPriceCreate(
    val householdId: String,
    val date: String,
    val price: Double,
)

@Serializable
data class ManualPriceResponse(
    val ticker: String,
    @Serializable(with = InstantSerializer::class)
    val date: Instant,
    @Serializable(with = MoneySerializer::class)
    val price: Double,
    val currency: String,
)

/** POST /portfolio/assets (schemas.AssetCreate). The id is client-generated. */
@Serializable
data class AssetCreate(
    val id: String,
    val ticker: String,
    val name: String,
    val type: String,
    val currency: String,
    val pricingMode: String,
)

/**
 * PUT /portfolio/assets/{id} (schemas.AssetUpdate). Corrects an asset's identity -- most often
 * a ticker created under the wrong currency. Changing the ticker or the currency replays the
 * holding households' snapshots server-side, so reload after saving.
 */
@Serializable
data class AssetUpdate(
    val ticker: String,
    val name: String,
    val type: String,
    val currency: String,
    val pricingMode: String,
)

/**
 * POST /portfolio/trades (schemas.TradeCreate). Buy/sell of an asset into a sub-portfolio,
 * funded from an account (or the sub-portfolio's own cash).
 */
@Serializable
data class TradeCreate(
    val type: TradeType,
    @Serializable(with = InstantSerializer::class)
    val date: Instant,
    val quantity: Double,
    val price: Double,
    val currency: String? = null,
    val exchangeRate: Double,
    val description: String? = null,
    val householdId: String,
    val subPortfolioId: String,
    val assetId: String,
    val accountId: String,
    val settleFromCash: Boolean,
)

/**
 * POST /portfolio/subportfolios/{id}/cash (schemas.SubPortfolioCashCreate). Moves cash
 * between a funding account and a sub-portfolio's cash pseudo-asset.
 */
@Serializable
data class SubPortfolioCashCreate(
    val householdId: String,
    val accountId: String,
    val direction: String, // "deposit" | "withdraw"
    val amount: Double,
    val currency: String,
    @Serializable(with = InstantSerializer::class)
    val date: Instant,
    val exchangeRate: Double,
    val description: String? = null,
)

@Serializable
data class TradeResponse(
    val id: String,
    val householdId: String,
    val subPortfolioId: String? = null,
    val assetId: String? = null,
    val accountId: String? = null,
    val transactionId: String? = null,
    /** Set when this trade was settled against sub-portfolio cash (has a companion cash leg). */
    val settlementTradeId: String? = null,
    val type: TradeType,
    @Serializable(with = InstantSerializer::class)
    val date: Instant,
    val quantity: Double,
    @Serializable(with = MoneySerializer::class)
    val price: Double,
    val currency: String? = null,
    val exchangeRate: Double = 1.0,
    val description: String? = null,
)

/**
 * PUT /portfolio/trades/{id} (schemas.TradeUpdate). Optional fields; only the ones sent
 * change. The ID fields are UUIDs (backend previously mis-typed them as ints).
 */
@Serializable
data class TradeUpdate(
    val type: TradeType? = null,
    @Serializable(with = OptionalInstantSerializer::class)
    val date: Instant? = null,
    val quantity: Double? = null,
    val price: Double? = null,
    val currency: String? = null,
    val exchangeRate: Double? = null,
    val description: String? = null,
    val subPortfolioId: String? = null,
    val assetId: String? = null,
    val accountId: String? = null,
)

@Serializable
data class SubPortfolioResponse(
    val id: String,
    val householdId: String,
    val name: String,
    val riskProfile: String? = null,
    @Serializable(with = OptionalInstantSerializer::class)
    val targetDate: Instant? = null,
    @Serializable(with = OptionalMoneySerializer::class)
    val targetAmount: Double? = null,
    val ownerUserId: String? = null,
)

/**
 * POST /portfolio/subportfolios (schemas.SubPortfolioCreate). A "goal" is just a
 * sub-portfolio with a target. `targetDate` is a bare "yyyy-MM-dd" string; `ownerUserId`
 * null = shared, set = private to that user.
 */
@Serializable
data class SubPortfolioCreate(
    val householdId: String,
    val name: String,
    val riskProfile: String,
    val targetAmount: Double? = null,
    val targetDate: String? = null,
    val ownerUserId: String? = null,
)

/**
 * PATCH /portfolio/subportfolios/{id} (schemas.SubPortfolioUpdate). Used to set a goal's
 * name and target. Only sent fields change; null target fields are left as-is.
 *
 * Ownership is special: the backend uses `exclude_unset`, so *omitting* `owner_user_id`
 * leaves it alone while an *explicit null* clears it. A plain `String?` can only express the
 * first — with `explicitNulls = false` a null is simply dropped — which would make
 * "Private → Shared" silently do nothing (the web UI has that limitation). So the field is
 * a [JsonElement]: leave it null to omit the key, pass [JsonNull] to clear ownership, or a
 * [JsonPrimitive] user id to set it. Use the [ownerUnchanged] / [ownerSetTo] helpers.
 */
@Serializable
data class SubPortfolioUpdate(
    val name: String,
    val targetAmount: Double? = null,
    val targetDate: String? = null,
    val ownerUserId: JsonElement? = null,
) {
    companion object {
        /** Leave ownership exactly as it is. */
        val ownerUnchanged: JsonElement? = null

        /** Set ownership, or clear it back to "shared with the household" with null. */
        fun ownerSetTo(userId: String?): JsonElement =
            if (userId == null) JsonNull else JsonPrimitive(userId)
    }
}

@Serializable
data class PortfolioSnapshotResponse(
    val id: String,
    val householdId: String,
    override val subPortfolioId: String,
    val assetId: String,
    @Serializable(with = InstantSerializer::class)
    override val date: Instant,
    val quantity: Double,
    @Serializable(with = MoneySerializer::class)
    val price: Double,
    val exchangeRateUsed: Double = 1.0,
    @Serializable(with = MoneySerializer::class)
    val currentValueHomeCurrency: Double,
    @Serializable(with = MoneySerializer::class)
    val averageCostBasis: Double,
    @Serializable(with = MoneySerializer::class)
    val averageCostBasisHomeCurrency: Double,
) : SnapshotValuePoint {
    override val value: Double
        get() = if (currentValueHomeCurrency.isFinite()) currentValueHomeCurrency else 0.0
}

/**
 * One (date, sub-portfolio) total — the per-asset PortfolioSnapshot rows summed server-side.
 * Chart/goal-history consumers use this instead of raw snapshots since they never need
 * per-asset detail.
 */
@Serializable
data class PortfolioTimeseriesPoint(
    @Serializable(with = InstantSerializer::class)
    override val date: Instant,
    override val subPortfolioId: String,
    @Serializable(with = MoneySerializer::class)
    val totalValueHomeCurrency: Double,
) : SnapshotValuePoint {
    override val value: Double
        get() = if (totalValueHomeCurrency.isFinite()) totalValueHomeCurrency else 0.0
}

@Serializable
data class DividendResponse(
    val id: String,
    val assetId: String,
    val subPortfolioId: String,
    @Serializable(with = InstantSerializer::class)
    val date: Instant,
    @Serializable(with = MoneySerializer::class)
    val amount: Double,
    @Serializable(with = OptionalMoneySerializer::class)
    val amountHomeCurrency: Double? = null,
    /** Payout per share, in the asset's own currency; null for hand-entered totals. */
    @Serializable(with = OptionalMoneySerializer::class)
    val perShareAmount: Double? = null,
    /** Shares held at the ex-date. Optional for the same reason as [perShareAmount]. */
    val quantity: Double? = null,
    /** True when entered by hand rather than synced from market data. */
    val isManual: Boolean? = null,
)

/**
 * POST /portfolio/dividends (schemas.DividendCreate). Records a manual dividend payout for
 * an asset held in a sub-portfolio, attributed to a funding account.
 */
@Serializable
data class DividendCreate(
    val householdId: String,
    val subPortfolioId: String,
    val assetId: String,
    val accountId: String,
    @Serializable(with = InstantSerializer::class)
    val date: Instant,
    val amount: Double,
    val exchangeRate: Double,
)

@Serializable
data class PerformanceMetrics(
    val simpleReturn: Double = 0.0,
    val timeWeightedReturn: Double = 0.0,
    val moneyWeightedReturn: Double = 0.0,
    val volatility: Double = 0.0,
    val sharpeRatio: Double = 0.0,
    val sortinoRatio: Double = 0.0,
    /** null when there's no benchmark data (beta unknown). */
    val treynorRatio: Double? = null,
    /** Jensen's alpha vs benchmark; null when there's no benchmark data. */
    val alpha: Double? = null,
    val beta: Double? = null,
    val dividendIncome: Double? = null,
    val dividendYield: Double? = null,
)

@Serializable
data class SubPortfolioMetricsResponse(
    val subPortfolioId: String,
    val name: String,
    val metrics: PerformanceMetrics,
)

@Serializable
data class PortfolioMetricsResponse(
    val householdId: String,
    val overallMetrics: PerformanceMetrics,
    val subPortfolioMetrics: List<SubPortfolioMetricsResponse> = emptyList(),
)

// MARK: - Reports (GET /exports/household/{id}/report)

@Serializable
data class ReportAccountRow(
    val id: String,
    val name: String,
    val kind: AccountKind,
    val currency: String? = null,
    val liquidity: LiquidityStatus? = null,
    val isPrivate: Boolean = false,
    @Serializable(with = OptionalMoneySerializer::class)
    val balance: Double? = null,
    @Serializable(with = OptionalMoneySerializer::class)
    val balanceHomeCurrency: Double? = null,
    @Serializable(with = OptionalInstantSerializer::class)
    val balanceAsOf: Instant? = null,
)

@Serializable
data class ReportHoldingRow(
    val subPortfolio: String,
    val ticker: String,
    val assetName: String? = null,
    val assetType: String? = null,
    val quantity: Double = 0.0,
    @Serializable(with = OptionalMoneySerializer::class)
    val price: Double? = null,
    val currency: String? = null,
    @Serializable(with = OptionalMoneySerializer::class)
    val valueHomeCurrency: Double? = null,
    @Serializable(with = OptionalMoneySerializer::class)
    val costBasisHomeCurrency: Double? = null,
    @Serializable(with = OptionalMoneySerializer::class)
    val unrealizedGainHomeCurrency: Double? = null,
    @Serializable(with = InstantSerializer::class)
    val asOf: Instant,
)

@Serializable
data class ReportCategoryFlow(
    val category: String,
    val type: TransactionType,
    @Serializable(with = MoneySerializer::class)
    val totalHomeCurrency: Double,
    val transactionCount: Int = 0,
)

@Serializable
data class ReportGoalRow(
    val id: String,
    val name: String,
    val isPrivate: Boolean = false,
    @Serializable(with = OptionalMoneySerializer::class)
    val targetAmount: Double? = null,
    @Serializable(with = OptionalInstantSerializer::class)
    val targetDate: Instant? = null,
    @Serializable(with = MoneySerializer::class)
    val currentValueHomeCurrency: Double,
    val progressPercent: Double? = null,
)

@Serializable
data class HouseholdReportResponse(
    val householdId: String,
    val householdName: String? = null,
    val baseCurrency: String? = null,
    @Serializable(with = InstantSerializer::class)
    val generatedAt: Instant,
    val preparedFor: String = "",
    @Serializable(with = InstantSerializer::class)
    val periodStart: Instant,
    @Serializable(with = InstantSerializer::class)
    val periodEnd: Instant,
    @Serializable(with = MoneySerializer::class)
    val totalAssets: Double,
    @Serializable(with = MoneySerializer::class)
    val totalLiabilities: Double,
    @Serializable(with = MoneySerializer::class)
    val netWorth: Double,
    val accounts: List<ReportAccountRow> = emptyList(),
    @Serializable(with = MoneySerializer::class)
    val portfolioValue: Double,
    @Serializable(with = MoneySerializer::class)
    val portfolioCostBasis: Double,
    @Serializable(with = MoneySerializer::class)
    val portfolioUnrealizedGain: Double,
    val holdings: List<ReportHoldingRow> = emptyList(),
    @Serializable(with = MoneySerializer::class)
    val incomeTotal: Double,
    @Serializable(with = MoneySerializer::class)
    val expenseTotal: Double,
    @Serializable(with = MoneySerializer::class)
    val netCashflow: Double,
    val cashflowByCategory: List<ReportCategoryFlow> = emptyList(),
    @Serializable(with = MoneySerializer::class)
    val dividendsPeriodTotal: Double,
    @Serializable(with = MoneySerializer::class)
    val dividendsAllTimeTotal: Double,
    val goals: List<ReportGoalRow> = emptyList(),
)

// MARK: - Household members & invites

@Serializable
data class HouseholdMemberUserResponse(
    val id: String,
    val userId: String,
    val householdId: String,
    val role: HouseholdRole,
    val name: String,
    val email: String,
)

@Serializable
data class HouseholdInviteResponse(
    val id: String,
    val householdId: String,
    val email: String,
    val role: HouseholdRole,
    val invitedByUserId: String,
    val status: String,
    @Serializable(with = InstantSerializer::class)
    val createdAt: Instant,
)

@Serializable
data class HouseholdInviteCreate(val email: String, val role: HouseholdRole)

// MARK: - Loans, property & net worth projection
//
// A mortgage recorded as a plain liability makes net worth read like a catastrophe: the debt
// is there in full and the house it bought is not. These types carry the amortization and
// the forward trajectory that fix that.

@Serializable
data class AmortizationRow(
    val period: Int,
    @Serializable(with = InstantSerializer::class)
    val date: Instant,
    @Serializable(with = MoneySerializer::class)
    val payment: Double,
    @Serializable(with = MoneySerializer::class)
    val interest: Double,
    @Serializable(with = MoneySerializer::class)
    val principal: Double,
    @Serializable(with = MoneySerializer::class)
    val balance: Double,
)

/** GET /accounts/{id}/loan-schedule */
@Serializable
data class LoanScheduleResponse(
    val accountId: String,
    val accountName: String,
    val currency: String,
    @Serializable(with = MoneySerializer::class)
    val originalPrincipal: Double,
    @Serializable(with = MoneySerializer::class)
    val interestRateAnnual: Double,
    val loanTermMonths: Int,
    @Serializable(with = MoneySerializer::class)
    val monthlyPayment: Double,
    @Serializable(with = InstantSerializer::class)
    val loanStartDate: Instant,
    /** null when the payment is too small to ever clear the balance. */
    @Serializable(with = OptionalInstantSerializer::class)
    val payoffDate: Instant? = null,
    @Serializable(with = MoneySerializer::class)
    val currentBalance: Double,
    @Serializable(with = MoneySerializer::class)
    val principalPaid: Double,
    @Serializable(with = MoneySerializer::class)
    val interestPaid: Double,
    @Serializable(with = MoneySerializer::class)
    val totalInterest: Double,
    @Serializable(with = MoneySerializer::class)
    val remainingInterest: Double,
    val schedule: List<AmortizationRow> = emptyList(),
)

@Serializable
data class NetWorthProjectionPoint(
    @Serializable(with = InstantSerializer::class)
    val date: Instant,
    @Serializable(with = MoneySerializer::class)
    val assets: Double,
    @Serializable(with = MoneySerializer::class)
    val liabilities: Double,
    @Serializable(with = MoneySerializer::class)
    val netWorth: Double,
)

/** GET /accounts/household/{id}/projection */
@Serializable
data class NetWorthProjectionResponse(
    val householdId: String,
    val baseCurrency: String,
    @Serializable(with = InstantSerializer::class)
    val start: Instant,
    val months: Int,
    @Serializable(with = MoneySerializer::class)
    val currentNetWorth: Double,
    /** When the household stops being underwater; null if it never crosses in-window. */
    @Serializable(with = OptionalInstantSerializer::class)
    val netWorthPositiveDate: Instant? = null,
    @Serializable(with = OptionalInstantSerializer::class)
    val debtFreeDate: Instant? = null,
    @Serializable(with = MoneySerializer::class)
    val totalInterestRemaining: Double,
    val points: List<NetWorthProjectionPoint> = emptyList(),
)

/** GET /accounts/household/{id}/equity — a property netted against its loan. */
@Serializable
data class LinkedEquityRow(
    val assetAccountId: String,
    val assetAccountName: String,
    @Serializable(with = MoneySerializer::class)
    val assetValue: Double,
    val loanAccountId: String? = null,
    val loanAccountName: String? = null,
    @Serializable(with = MoneySerializer::class)
    val loanBalance: Double,
    @Serializable(with = MoneySerializer::class)
    val equity: Double,
    val equityPercent: Double? = null,
)

// MARK: - Recurring transactions

@Serializable
data class RecurringTransactionResponse(
    val id: String,
    val householdId: String,
    val accountId: String,
    val categoryId: String,
    /** Positive magnitude; direction comes from the category. */
    @Serializable(with = MoneySerializer::class)
    val amount: Double,
    val currency: String? = null,
    val description: String? = null,
    val frequency: RecurrenceFrequency,
    @Serializable(with = InstantSerializer::class)
    val startDate: Instant,
    @Serializable(with = OptionalInstantSerializer::class)
    val endDate: Instant? = null,
    @Serializable(with = InstantSerializer::class)
    val nextDueDate: Instant,
    @Serializable(with = OptionalInstantSerializer::class)
    val lastPostedDate: Instant? = null,
    val isActive: Boolean = true,
    val ownerUserId: String? = null,
)

@Serializable
data class RecurringTransactionCreate(
    val householdId: String,
    val accountId: String,
    val categoryId: String,
    val amount: Double,
    val description: String? = null,
    val frequency: RecurrenceFrequency,
    /** Date-only strings — see `Instant.apiDateOnly()`. */
    val startDate: String,
    val endDate: String? = null,
    val ownerUserId: String? = null,
)

/** PUT /cashflow/recurring/{id}. Every field optional; omitted keys are left alone. */
@Serializable
data class RecurringTransactionUpdate(
    val amount: Double? = null,
    val description: String? = null,
    val frequency: RecurrenceFrequency? = null,
    val startDate: String? = null,
    val endDate: String? = null,
    val isActive: Boolean? = null,
)

/** GET /cashflow/recurring/household/{id}/upcoming */
@Serializable
data class UpcomingOccurrence(
    val recurringTransactionId: String,
    val description: String? = null,
    val categoryName: String,
    val accountName: String,
    @Serializable(with = InstantSerializer::class)
    val date: Instant,
    @Serializable(with = MoneySerializer::class)
    val amount: Double,
    val currency: String? = null,
    val transactionType: TransactionType,
)

@Serializable
data class RecurringRunResponse(val posted: Int)

// MARK: - Budgets & emergency fund

@Serializable
data class BudgetResponse(
    val id: String,
    val householdId: String,
    val categoryIds: List<String>,
    @Serializable(with = MoneySerializer::class)
    val amount: Double,
    val period: BudgetPeriod,
    val ownerUserId: String? = null,
)

@Serializable
data class BudgetCreate(
    val householdId: String,
    val categoryIds: List<String>,
    val amount: Double,
    val period: BudgetPeriod,
    val ownerUserId: String? = null,
)

@Serializable
data class BudgetUpdate(
    val amount: Double? = null,
    val period: BudgetPeriod? = null,
)

@Serializable
data class BudgetStatusRow(
    val budgetId: String,
    val categoryIds: List<String>,
    val categoryNames: List<String>,
    val period: BudgetPeriod,
    val isPrivate: Boolean = false,
    @Serializable(with = MoneySerializer::class)
    val limit: Double,
    @Serializable(with = MoneySerializer::class)
    val spent: Double,
    @Serializable(with = MoneySerializer::class)
    val remaining: Double,
    val percentUsed: Double = 0.0,
    @Serializable(with = InstantSerializer::class)
    val periodStart: Instant,
    @Serializable(with = InstantSerializer::class)
    val periodEnd: Instant,
    val daysElapsed: Int = 0,
    val daysTotal: Int = 0,
    /** Spend extrapolated to the end of the period at the current daily rate. */
    @Serializable(with = MoneySerializer::class)
    val projectedSpend: Double,
    val projectedOver: Boolean = false,
)

/** GET /cashflow/budgets/household/{id}/status */
@Serializable
data class BudgetStatusResponse(
    val householdId: String,
    val baseCurrency: String,
    @Serializable(with = InstantSerializer::class)
    val asOf: Instant,
    @Serializable(with = MoneySerializer::class)
    val totalLimit: Double,
    @Serializable(with = MoneySerializer::class)
    val totalSpent: Double,
    val budgets: List<BudgetStatusRow> = emptyList(),
)

/** GET /cashflow/household/{id}/emergency-fund */
@Serializable
data class EmergencyFundResponse(
    val householdId: String,
    val baseCurrency: String,
    @Serializable(with = InstantSerializer::class)
    val asOf: Instant,
    @Serializable(with = MoneySerializer::class)
    val liquidTotal: Double,
    @Serializable(with = MoneySerializer::class)
    val averageMonthlyExpenses: Double,
    /**
     * null when no spending has been recorded — an *undefined* runway, not an infinite one.
     * Never render this as "∞".
     */
    @Serializable(with = OptionalMoneySerializer::class)
    val monthsCovered: Double? = null,
    @Serializable(with = MoneySerializer::class)
    val targetMonths: Double,
    @Serializable(with = MoneySerializer::class)
    val targetAmount: Double,
    @Serializable(with = MoneySerializer::class)
    val shortfall: Double,
    val monthsOfHistory: Int = 0,
    val onTrack: Boolean = false,
)
