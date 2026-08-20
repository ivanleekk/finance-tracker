package com.ivanlee.financetracker

import com.ivanlee.financetracker.data.model.AccountResponse
import com.ivanlee.financetracker.data.model.AssetUpdate
import com.ivanlee.financetracker.data.model.BalanceResponse
import com.ivanlee.financetracker.data.model.EmergencyFundResponse
import com.ivanlee.financetracker.data.model.LiquidityStatus
import com.ivanlee.financetracker.data.model.RecurringTransactionResponse
import com.ivanlee.financetracker.data.model.SubPortfolioUpdate
import com.ivanlee.financetracker.data.model.TransactionResponse
import com.ivanlee.financetracker.data.model.TransactionType
import com.ivanlee.financetracker.data.model.UserResponse
import com.ivanlee.financetracker.data.model.UserUpdate
import com.ivanlee.financetracker.data.net.Api
import com.ivanlee.financetracker.data.net.DateParser
import com.ivanlee.financetracker.data.net.apiDateOnly
import kotlinx.serialization.encodeToString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

/**
 * Kotlin twin of iOS's `ModelDecodingTests` + `MoneyDecodingTests`.
 *
 * These run representative backend JSON through the real [Api.json] configuration, which is
 * what catches `Models.kt` ⇄ `schemas.py` drift before it reaches a screen.
 */
class ModelDecodingTest {

    private val json = Api.json

    // ---- Money as string vs number ------------------------------------------------------

    @Test
    fun `money decodes from Pydantic's Decimal-as-string`() {
        val balance = json.decodeFromString<BalanceResponse>(
            """{"id":"b1","account_id":"a1","date":"2026-07-19","balance":"5000.00",
               "balance_home_currency":"6800.50","is_manual":true}"""
        )
        assertEquals(5000.0, balance.balance, 1e-9)
        assertEquals(6800.50, balance.balanceHomeCurrency!!, 1e-9)
    }

    @Test
    fun `money also decodes from a plain JSON number`() {
        val balance = json.decodeFromString<BalanceResponse>(
            """{"id":"b1","account_id":"a1","date":"2026-07-19","balance":1234.5,"is_manual":false}"""
        )
        assertEquals(1234.5, balance.balance, 1e-9)
        assertNull(balance.balanceHomeCurrency)
    }

    @Test
    fun `an explicit null optional money field decodes to null`() {
        val balance = json.decodeFromString<BalanceResponse>(
            """{"id":"b1","account_id":"a1","date":"2026-07-19","balance":"1.00",
               "balance_home_currency":null,"is_manual":false}"""
        )
        assertNull(balance.balanceHomeCurrency)
    }

    // ---- Dates --------------------------------------------------------------------------

    @Test
    fun `every backend date shape parses, and naive values are read as UTC`() {
        val expected = LocalDate.parse("2026-07-19").atStartOfDay(ZoneOffset.UTC).toInstant()
        assertEquals(expected, DateParser.parse("2026-07-19"))
        assertEquals(expected, DateParser.parse("2026-07-19T00:00:00"))
        assertEquals(expected, DateParser.parse("2026-07-19T00:00:00.000000"))
        assertEquals(expected, DateParser.parse("2026-07-19T00:00:00Z"))
        assertEquals(expected, DateParser.parse("2026-07-19T08:00:00+08:00"))
    }

    @Test
    fun `apiDateOnly is UTC yyyy-MM-dd, so date-only fields round-trip`() {
        // 23:30 UTC would be "tomorrow" anywhere east of Greenwich — the whole reason this
        // formatter is pinned to UTC.
        val late = Instant.parse("2026-07-19T23:30:00Z")
        assertEquals("2026-07-19", late.apiDateOnly())
        assertEquals(late.apiDateOnly(), DateParser.parse(late.apiDateOnly())!!.apiDateOnly())
    }

    @Test
    fun `an unparseable date is null rather than an exception`() {
        assertNull(DateParser.parse("not a date"))
    }

    // ---- Lenient enums ------------------------------------------------------------------

    @Test
    fun `an unknown liquidity value falls back instead of failing the whole list`() {
        val account = json.decodeFromString<AccountResponse>(
            """{"id":"a1","household_id":"h1","name":"Vault","liquidity":"quantum",
               "tax_status":"taxable","kind":"asset","currency":"USD"}"""
        )
        assertEquals(LiquidityStatus.LIQUID, account.liquidity)
    }

    @Test
    fun `known liquidity values map to their wire names`() {
        val account = json.decodeFromString<AccountResponse>(
            """{"id":"a1","household_id":"h1","name":"House","liquidity":"illiquid",
               "tax_status":"taxable","kind":"asset","currency":"USD"}"""
        )
        assertEquals(LiquidityStatus.ILLIQUID, account.liquidity)
        assertEquals("Property", account.liquidity.label)
    }

    // ---- Representative payloads --------------------------------------------------------

    @Test
    fun `an account with full loan terms reports hasLoanTerms`() {
        val account = json.decodeFromString<AccountResponse>(
            """{"id":"a1","household_id":"h1","name":"Mortgage","liquidity":"liquid",
               "tax_status":"taxable","kind":"liability","currency":"SGD",
               "original_principal":"500000.00","interest_rate_annual":"3.5",
               "loan_term_months":360,"monthly_payment":"2245.22","loan_start_date":"2024-01-01"}"""
        )
        assertTrue(account.isLiability)
        assertTrue(account.hasLoanTerms)
    }

    @Test
    fun `a liability missing one loan term is not amortizable`() {
        val account = json.decodeFromString<AccountResponse>(
            """{"id":"a1","household_id":"h1","name":"Card","liquidity":"liquid",
               "tax_status":"taxable","kind":"liability","currency":"SGD",
               "original_principal":"5000.00","interest_rate_annual":"18.0"}"""
        )
        assertFalse(account.hasLoanTerms)
    }

    @Test
    fun `a transaction decodes with its type and optional transfer link`() {
        val txn = json.decodeFromString<TransactionResponse>(
            """{"id":"t1","account_id":"a1","category_id":"c1","date":"2026-07-19T00:00:00",
               "amount":"42.50","amount_home_currency":"57.80","currency":"USD",
               "description":"Lunch","transaction_type":"expense","transfer_id":null}"""
        )
        assertEquals(TransactionType.EXPENSE, txn.transactionType)
        assertEquals(42.50, txn.amount, 1e-9)
        assertNull(txn.transferId)
    }

    @Test
    fun `an emergency fund with no spending history has a null runway, not infinity`() {
        val fund = json.decodeFromString<EmergencyFundResponse>(
            """{"household_id":"h1","base_currency":"SGD","as_of":"2026-07-19",
               "liquid_total":"10000.00","average_monthly_expenses":"0.00","months_covered":null,
               "target_months":"6","target_amount":"0.00","shortfall":"0.00",
               "months_of_history":0,"on_track":false}"""
        )
        assertNull(fund.monthsCovered)
    }

    @Test
    fun `an unknown recurrence frequency falls back to monthly`() {
        val rule = json.decodeFromString<RecurringTransactionResponse>(
            """{"id":"r1","household_id":"h1","account_id":"a1","category_id":"c1",
               "amount":"1200.00","currency":"SGD","description":"Rent","frequency":"fortnightly",
               "start_date":"2026-01-01","next_due_date":"2026-08-01","is_active":true}"""
        )
        assertEquals("monthly", rule.frequency.wire)
    }

    @Test
    fun `unknown response keys are ignored so an older build survives a newer backend`() {
        val user = json.decodeFromString<UserResponse>(
            """{"id":"u1","email":"a@b.c","name":"Ada","brand_new_field":"surprise"}"""
        )
        assertEquals("Ada", user.name)
    }

    @Test
    fun `the biometric vault flag keeps its backend wire name`() {
        val user = json.decodeFromString<UserResponse>(
            """{"id":"u1","email":"a@b.c","name":"Ada","require_face_id_for_vault":true}"""
        )
        assertTrue(user.requiresBiometricForVault)
    }

    @Test
    fun `an absent vault flag reads as false so nobody is locked out by a partial decode`() {
        val user = json.decodeFromString<UserResponse>("""{"id":"u1","email":"a@b.c","name":"Ada"}""")
        assertFalse(user.requiresBiometricForVault)
    }

    // ---- Request encoding ---------------------------------------------------------------

    @Test
    fun `null fields are omitted from a partial update body`() {
        val body = json.encodeToString(UserUpdate(name = "Ada"))
        assertEquals("""{"name":"Ada"}""", body)
    }

    @Test
    fun `an asset edit sends the pricing mode values the backend accepts`() {
        // schemas.AssetBase.pricing_mode is Literal["market", "manual"] — "auto" is a 422.
        val body = json.encodeToString(AssetUpdate(ticker = "AAPL", pricingMode = "market"))
        assertTrue(body, body.contains(""""pricing_mode":"market""""))
    }

    @Test
    fun `a ticker-only asset fix omits name and currency so the backend re-enriches them`() {
        val body = json.encodeToString(AssetUpdate(ticker = "AAPL", type = "stock"))
        assertEquals("""{"ticker":"AAPL","type":"stock"}""", body)
    }

    @Test
    fun `camelCase properties encode to snake_case keys`() {
        val body = json.encodeToString(UserUpdate(defaultNewItemsPrivate = true))
        assertTrue(body, body.contains("default_new_items_private"))
    }

    @Test
    fun `omitting the goal owner leaves ownership alone`() {
        val body = json.encodeToString(
            SubPortfolioUpdate(name = "House", ownerUserId = SubPortfolioUpdate.ownerUnchanged)
        )
        assertFalse(body, body.contains("owner_user_id"))
    }

    @Test
    fun `an explicit null owner clears ownership - private becomes shared`() {
        // The whole reason this field is a JsonElement: with `explicitNulls = false` a plain
        // String? could never express "send null", so Private → Shared would silently no-op.
        val body = json.encodeToString(
            SubPortfolioUpdate(name = "House", ownerUserId = SubPortfolioUpdate.ownerSetTo(null))
        )
        assertTrue(body, body.contains(""""owner_user_id":null"""))
    }

    @Test
    fun `setting an owner sends the id`() {
        val body = json.encodeToString(
            SubPortfolioUpdate(name = "House", ownerUserId = SubPortfolioUpdate.ownerSetTo("u1"))
        )
        assertTrue(body, body.contains(""""owner_user_id":"u1""""))
    }
}
