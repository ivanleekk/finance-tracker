package com.ivanlee.financetracker

import com.ivanlee.financetracker.data.model.TransferCreate
import com.ivanlee.financetracker.data.model.TransactionCreate
import com.ivanlee.financetracker.data.model.transactionUpdate
import com.ivanlee.financetracker.data.net.Api
import com.ivanlee.financetracker.logic.Fx
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.time.Instant
import kotlin.math.abs
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Foreign-currency charges on a form (`logic/Fx.kt`). Twin of the web
 * `frontend/src/lib/fx.test.ts` and the iOS `FxTests.swift` — the three must agree about the
 * same numbers and the same strings.
 */
class FxTest {
    @Test
    fun `a charge in the account's own currency is not foreign`() {
        assertFalse(Fx.isForeignCharge("SGD", "SGD"))
    }

    @Test
    fun `both currencies have to be known before a charge is foreign`() {
        assertTrue(Fx.isForeignCharge("JPY", "SGD"))
        // An unknown currency on either side is a form that has not finished loading; prompting
        // for a converted amount there asks the user to convert into nothing.
        assertFalse(Fx.isForeignCharge("JPY", ""))
        assertFalse(Fx.isForeignCharge(null, "SGD"))
    }

    @Test
    fun `the rate is what was charged over what was billed`() {
        val rate = Fx.impliedRate(12000.0, 124.80)!!
        assertTrue(abs(rate - 0.0104) < 1e-10)
    }

    @Test
    fun `there is no rate without two positive figures`() {
        assertNull(Fx.impliedRate(null, 124.80))
        assertNull(Fx.impliedRate(12000.0, null))
        assertNull(Fx.impliedRate(0.0, 124.80))
        assertNull(Fx.impliedRate(12000.0, -5.0))
        assertNull(Fx.impliedRate(12000.0, Double.NaN))
    }

    @Test
    fun `a rate below one keeps the decimals its information lives in`() {
        assertEquals("0.0104", Fx.formatRate(0.0104))
        assertEquals("0.006712", Fx.formatRate(0.006712))
        assertEquals("149.23", Fx.formatRate(149.23))
    }

    @Test
    fun `a clean rate is not padded out`() {
        assertEquals("1.35", Fx.formatRate(1.35))
        assertEquals("2", Fx.formatRate(2.0))
    }

    @Test
    fun `the fee is a percentage of the converted amount, to the cent`() {
        // What the card bills a percentage of is what it charged you, so a ¥12,000 dinner
        // settled at S$124.80 carries S$3.74 — not 3% of ¥12,000.
        assertEquals(3.74, Fx.feeAmount(124.80, 3.0)!!, 1e-9)
        assertEquals(3.0, Fx.feeAmount(100.0, 3.0)!!, 1e-9)
    }

    @Test
    fun `there is no fee to show without two positive figures`() {
        assertNull(Fx.feeAmount(124.80, 0.0))
        assertNull(Fx.feeAmount(124.80, null))
        assertNull(Fx.feeAmount(null, 3.0))
        assertNull(Fx.feeAmount(0.0, 3.0))
        assertNull(Fx.feeAmount(124.80, Double.NaN))
    }

    @Test
    fun `the hint names both currencies so the direction cannot be misread`() {
        assertEquals(
            "1 JPY = 0.0104 SGD",
            Fx.impliedRateLabel(12000.0, 124.80, "JPY", "SGD"),
        )
    }

    @Test
    fun `a transfer reads as sent over received`() {
        // S$1,000 out, US$731 in: the rate the bank gave.
        assertEquals("1 SGD = 0.731 USD", Fx.impliedRateLabel(1000.0, 731.0, "SGD", "USD"))
    }

    @Test
    fun `both legs and the conversion row are part of the transfer`() {
        val legs = mapOf("withdrawal" to "t1", "deposit" to "t1")
        assertTrue(Fx.isPartOfTransfer("t1", null) { legs[it] })
        assertTrue(Fx.isPartOfTransfer(null, "withdrawal") { legs[it] })
    }

    @Test
    fun `a card surcharge and an ordinary row are not`() {
        val legs = mapOf("withdrawal" to "t1")
        assertFalse(Fx.isPartOfTransfer(null, "dinner") { legs[it] })
        assertFalse(Fx.isPartOfTransfer(null, null) { legs[it] })
    }

    @Test
    fun `a foreign charge takes the card's foreign fee`() {
        assertEquals(3.0, Fx.defaultFeePercent(3.0, "JPY", "SGD")!!, 0.0)
    }

    @Test
    fun `a domestic charge or a card with no default takes nothing`() {
        assertNull(Fx.defaultFeePercent(3.0, "SGD", "SGD"))
        assertNull(Fx.defaultFeePercent(null, "JPY", "SGD"))
        assertNull(Fx.defaultFeePercent(0.0, "JPY", "SGD"))
        assertNull(Fx.defaultFeePercent(3.0, "JPY", ""))
    }

    @Test
    fun `a rule sends a currency only when it is foreign`() {
        assertNull(Fx.ruleCurrency("", "SGD"))
        assertNull(Fx.ruleCurrency("SGD", "SGD"))
        assertEquals("USD", Fx.ruleCurrency("USD", "SGD"))
    }

    @Test
    fun `a blank rule fee is the card's default and zero is none`() {
        assertNull(Fx.ruleFeePercent(""))
        assertNull(Fx.ruleFeePercent("  "))
        assertEquals(0.0, Fx.ruleFeePercent("0")!!, 0.0)
        assertEquals(2.5, Fx.ruleFeePercent("2.5")!!, 0.0)
    }

    @Test
    fun `an edited rule always sends currency and fee, and a new one omits them when empty`() {
        val (noCurrency, noFee) = com.ivanlee.financetracker.data.model.ruleFx(null, null)
        val edit = Api.json.parseToJsonElement(
            Api.json.encodeToString(
                com.ivanlee.financetracker.data.model.RecurringTransactionUpdate(currency = noCurrency, feePercent = noFee),
            ),
        ).jsonObject
        assertTrue(edit.containsKey("currency") && edit.containsKey("fee_percent"))
        assertEquals(kotlinx.serialization.json.JsonNull, edit["currency"])

        val pause = Api.json.parseToJsonElement(
            Api.json.encodeToString(com.ivanlee.financetracker.data.model.RecurringTransactionUpdate(isActive = false)),
        ).jsonObject
        assertFalse("the pause toggle must not reset a rule's currency", pause.containsKey("currency"))

        val create = Api.json.parseToJsonElement(
            Api.json.encodeToString(
                com.ivanlee.financetracker.data.model.RecurringTransactionCreate(
                    householdId = "hh", accountId = "a", categoryId = "c", amount = 10.0,
                    frequency = com.ivanlee.financetracker.data.model.RecurrenceFrequency.MONTHLY, startDate = "2026-01-01",
                ),
            ),
        ).jsonObject
        assertFalse(create.containsKey("currency") || create.containsKey("fee_percent"))
    }

    @Test
    fun `the hint is empty while there is nothing to show`() {
        assertEquals("", Fx.impliedRateLabel(12000.0, null, "JPY", "SGD"))
        assertEquals("", Fx.impliedRateLabel(12000.0, 124.80, "JPY", ""))
    }
}

/**
 * The encoder side: what a transaction write actually puts on the wire.
 *
 * Twin of iOS's `FxEncodingTests`. Kotlin's `explicitNulls = false` and Swift's synthesized
 * encoder both drop a null, so both clients have to be checked rather than assumed.
 */
class FxEncodingTest {
    private fun encoded(
        currency: String?,
        amountCharged: Double?,
        feePercent: Double? = null,
    ) = Api.json.encodeToString(
        transactionUpdate(
            date = Instant.EPOCH,
            amount = 12000.0,
            description = "Ramen",
            accountId = "acc-1",
            categoryId = "cat-1",
            mcc = "",
            currency = currency,
            amountCharged = amountCharged,
            feePercent = feePercent,
        ),
    ).let { Api.json.parseToJsonElement(it).jsonObject }

    private fun transfer(amountReceived: Double?) = Api.json.encodeToString(
        TransferCreate(
            fromAccountId = "sgd",
            toAccountId = "usd",
            amount = 1000.0,
            date = Instant.EPOCH,
            amountReceived = amountReceived,
        ),
    ).let { Api.json.parseToJsonElement(it).jsonObject }

    @Test
    fun `a transfer sends the received amount only when there is one`() {
        assertFalse(transfer(amountReceived = null).containsKey("amount_received"))
        assertEquals(731.0, transfer(amountReceived = 731.0)["amount_received"]!!.jsonPrimitive.double, 0.0)
    }

    @Test
    fun `a new charge leaves the fee out until the user types, and sends zero when cleared`() {
        fun body(fee: Double?) = Api.json.parseToJsonElement(
            Api.json.encodeToString(
                TransactionCreate(
                    date = Instant.EPOCH, amount = 12000.0, accountId = "a", categoryId = "c",
                    currency = "JPY", feePercent = fee,
                ),
            ),
        ).jsonObject
        assertFalse("omitted lets the card's default apply", body(null).containsKey("fee_percent"))
        assertEquals(0.0, body(0.0)["fee_percent"]!!.jsonPrimitive.double, 0.0)
    }

    @Test
    fun `omits the charged amount when there is nothing to say`() {
        // Unlike cardCategoryId, null here means "nothing to say about the rate", not "clear
        // it" — there is no such thing as a transaction with no rate, so an explicit null would
        // be asking for the impossible.
        val json = encoded(currency = "SGD", amountCharged = null)
        assertFalse(json.containsKey("amount_charged"))
        assertEquals("SGD", json["currency"]?.jsonPrimitive?.content)
    }

    @Test
    fun `sends both when the charge was foreign`() {
        val json = encoded(currency = "JPY", amountCharged = 124.80)
        assertEquals("JPY", json["currency"]?.jsonPrimitive?.content)
        assertEquals(124.80, json["amount_charged"]?.jsonPrimitive?.double)
    }

    @Test
    fun `sends a zero fee so a surcharge can be removed`() {
        // The API reads an omitted key as "preserve", so null would leave no way to take a
        // recorded surcharge off a transaction. The form sends 0.
        val json = encoded(currency = "SGD", amountCharged = null, feePercent = 0.0)
        assertEquals(0.0, json["fee_percent"]?.jsonPrimitive?.double)
    }

    @Test
    fun `sends the fee when one is set`() {
        val json = encoded(currency = "SGD", amountCharged = null, feePercent = 3.0)
        assertEquals(3.0, json["fee_percent"]?.jsonPrimitive?.double)
    }

    @Test
    fun `omits the currency when the form has none to offer`() {
        assertFalse(encoded(currency = null, amountCharged = null).containsKey("currency"))
    }
}
