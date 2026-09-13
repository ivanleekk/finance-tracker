package com.ivanlee.financetracker

import com.ivanlee.financetracker.data.model.CardCategoryResponse
import com.ivanlee.financetracker.data.model.CardLimitResponse
import com.ivanlee.financetracker.data.model.CardLimitStatusRow
import com.ivanlee.financetracker.data.model.CardResponse
import com.ivanlee.financetracker.data.model.CardStatusResponse
import com.ivanlee.financetracker.data.model.CardUpdate
import com.ivanlee.financetracker.data.model.CycleBasis
import com.ivanlee.financetracker.data.model.LimitDirection
import com.ivanlee.financetracker.data.model.LimitResetBasis
import com.ivanlee.financetracker.data.model.cardUpdate
import com.ivanlee.financetracker.data.model.transactionUpdate
import com.ivanlee.financetracker.data.net.Api
import com.ivanlee.financetracker.data.net.apiDateOnly
import com.ivanlee.financetracker.logic.Cards
import com.ivanlee.financetracker.logic.resetOptions
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.util.Locale

/**
 * Per-card spend limits (`logic/Cards.kt`). Twin of the web
 * `frontend/src/lib/cards.test.ts` and iOS's `CardsTests.swift`.
 *
 * What these mostly pin is that a ceiling and a floor never read the same. The
 * maths is identical; the meaning is opposite, and getting that backwards would
 * tell someone they were fine when they were about to miss a fee waiver.
 */
class CardsTest {

    private fun row(
        direction: LimitDirection = LimitDirection.CEILING,
        remaining: Double = 760.0,
        projectedMissed: Boolean = false,
        settled: Boolean = false,
        limitId: String = "lim-1",
        categoryIds: List<String> = listOf("cc-1"),
        periodStart: Instant = Instant.parse("2026-08-19T00:00:00Z"),
        periodEnd: Instant = Instant.parse("2026-09-18T00:00:00Z"),
    ) = CardLimitStatusRow(
        limitId = limitId,
        name = "Dining cap",
        categoryIds = categoryIds,
        categoryNames = listOf("Dining"),
        direction = direction,
        amount = 1000.0,
        spent = 240.0,
        remaining = remaining,
        percentUsed = 24.0,
        periodStart = periodStart,
        periodEnd = periodEnd,
        daysElapsed = 18,
        daysTotal = 31,
        projectedSpend = 413.0,
        projectedMissed = projectedMissed,
        settled = settled,
    )

    private val money: (Double) -> String = { "$${it.toInt()}" }

    // --- Tone ---

    @Test
    fun `reads a comfortable cap as ok`() {
        assertEquals(Cards.Tone.OK, Cards.tone(row()))
    }

    @Test
    fun `warns before the cap is actually burst`() {
        // The whole point of the projection: telling someone on the last day is useless.
        assertEquals(Cards.Tone.AT_RISK, Cards.tone(row(projectedMissed = true)))
    }

    @Test
    fun `reads a burst cap as over`() {
        assertEquals(Cards.Tone.OVER, Cards.tone(row(settled = true)))
    }

    @Test
    fun `never reads a minimum spend as over`() {
        // Same `settled` flag, opposite meaning. A met minimum is a success and
        // must not render in the same red as a burst cap.
        assertEquals(Cards.Tone.OK, Cards.tone(row(direction = LimitDirection.FLOOR, settled = true)))
    }

    @Test
    fun `warns when a minimum is on pace to be missed`() {
        assertEquals(
            Cards.Tone.AT_RISK,
            Cards.tone(row(direction = LimitDirection.FLOOR, projectedMissed = true)),
        )
    }

    // --- Wording ---

    @Test
    fun `counts down for a cap`() {
        assertEquals("$240 left", Cards.headroomLabel(row(remaining = 240.0), money))
    }

    @Test
    fun `counts up for a minimum`() {
        assertEquals(
            "$120 to go",
            Cards.headroomLabel(row(direction = LimitDirection.FLOOR, remaining = 120.0), money),
        )
    }

    @Test
    fun `says which thing happened when the number is reached`() {
        assertEquals("Cap reached", Cards.headroomLabel(row(settled = true), money))
        assertEquals(
            "Minimum met",
            Cards.headroomLabel(row(direction = LimitDirection.FLOOR, settled = true), money),
        )
    }

    @Test
    fun `renders the cycle window in UTC`() {
        // A cycle boundary is a calendar fact about the card, not an instant.
        // Rendering it in the device zone would shift it a day west of Greenwich.
        val label = Cards.cycleLabel(
            Instant.parse("2026-08-19T00:00:00Z"),
            Instant.parse("2026-09-18T00:00:00Z"),
            Locale.UK,
        )
        assertTrue(label, label.startsWith("19 Aug"))
        assertTrue(label, label.contains("18 Sep"))
    }

    // --- Headroom fan-out ---

    private fun status(rows: List<CardLimitStatusRow>) = CardStatusResponse(
        cardId = "card-1",
        accountName = "Amex Platinum",
        currency = "SGD",
        cycleStart = Instant.parse("2026-08-19T00:00:00Z"),
        cycleEnd = Instant.parse("2026-09-18T00:00:00Z"),
        limits = rows,
        categories = emptyList(),
    )

    private fun limit(id: String, categoryIds: List<String>) = CardLimitResponse(
        id = id, cardId = "card-1", name = id, amount = 1.0,
        direction = LimitDirection.CEILING, resetBasis = LimitResetBasis.CYCLE, categoryIds = categoryIds,
    )

    @Test
    fun `fans a shared limit over every category counting towards it`() {
        val map = Cards.headroomByCategory(status(listOf(row(categoryIds = listOf("cc-1", "cc-2")))))
        assertEquals(listOf("lim-1"), map["cc-1"]?.map { it.limitId })
        assertEquals(listOf("lim-1"), map["cc-2"]?.map { it.limitId })
    }

    @Test
    fun `gives a category every limit it counts towards in status order`() {
        val map = Cards.headroomByCategory(
            status(
                listOf(
                    row(direction = LimitDirection.FLOOR, limitId = "monthly-min", categoryIds = listOf("cc-1")),
                    row(limitId = "annual-cap", categoryIds = listOf("cc-1", "cc-2")),
                ),
            ),
        )
        assertEquals(listOf("monthly-min", "annual-cap"), map["cc-1"]?.map { it.limitId })
        assertEquals(listOf("annual-cap"), map["cc-2"]?.map { it.limitId })
    }

    @Test
    fun `gives an unmetered category no entry rather than an empty list`() {
        // "Tracked but unmetered" and "nothing left" must not look the same.
        assertNull(Cards.headroomByCategory(status(listOf(row())))["cc-3"])
        assertTrue(Cards.headroomByCategory(status(emptyList())).isEmpty())
    }

    @Test
    fun `a category is metered once any limit counts it`() {
        val limits = listOf(limit("a", listOf("cc-1")), limit("b", emptyList()))
        assertTrue(Cards.isMetered("cc-1", limits))
        assertFalse(Cards.isMetered("cc-2", limits))
    }

    @Test
    fun `the picker states every limit a category counts towards`() {
        val headroom = Cards.headroomByCategory(
            status(
                listOf(
                    row(direction = LimitDirection.FLOOR, remaining = 300.0, limitId = "min", categoryIds = listOf("cc-1")),
                    row(remaining = 11000.0, limitId = "cap", categoryIds = listOf("cc-1")),
                ),
            ),
        )
        val dining = CardCategoryResponse("cc-1", "card-1", "Dining", true, 0)
        val travel = CardCategoryResponse("cc-2", "card-1", "Travel", false, 1)
        assertEquals("Dining · $300 to go · $11000 left", Cards.categoryLabel(dining, headroom, money))
        assertEquals("Travel", Cards.categoryLabel(travel, headroom, money))
    }

    // --- Windows ---

    @Test
    fun `a limit on the card cycle adds no window of its own`() {
        assertNull(Cards.limitWindowLabel(row(), status(emptyList())))
    }

    @Test
    fun `a limit off the cycle names its window with years`() {
        val label = Cards.limitWindowLabel(
            row(periodStart = Instant.parse("2025-09-14T00:00:00Z"), periodEnd = Instant.parse("2026-09-13T00:00:00Z")),
            status(emptyList()),
            Locale.UK,
        )
        assertEquals("14 Sept 2025 – 13 Sept 2026", label)
    }

    // --- Attention ---

    @Test
    fun `keeps only what is worth interrupting someone about`() {
        val rows = listOf(
            row(limitId = "ok"),
            row(projectedMissed = true, limitId = "risk"),
            row(settled = true, limitId = "burst"),
        )
        assertEquals(listOf("risk", "burst"), Cards.needingAttention(rows).map { it.limitId })
    }

    @Test
    fun `is empty when everything is fine`() {
        assertTrue(Cards.needingAttention(listOf(row(), row())).isEmpty())
    }

    // --- The encoder trap ---

    private fun encoded(cardCategoryId: String?): JsonObject =
        Json.encodeToJsonElement(
            transactionUpdate(
                date = Instant.parse("2026-09-01T12:00:00Z"),
                amount = 10.0,
                description = "",
                accountId = "a",
                categoryId = "c",
                mcc = "",
                cardCategoryId = cardCategoryId,
            )
        ) as JsonObject

    @Test
    fun `always sends the card category even when there is none`() {
        // `explicitNulls = false` drops a Kotlin null, and a dropped key means
        // "preserve" — which would leave no way to untag a transaction at all.
        // JsonNull is what makes the clear expressible.
        val json = encoded(null)
        assertTrue(json.containsKey("cardCategoryId"))
        assertEquals(JsonNull, json["cardCategoryId"])
    }

    @Test
    fun `sends the card category when one is picked`() {
        assertEquals(JsonPrimitive("cc-1"), encoded("cc-1")["cardCategoryId"])
    }

    // --- Anniversary resets ---

    @Test
    fun aCardYearDecodesAsItself() {
        assertEquals(LimitResetBasis.CARD_YEAR, Api.json.decodeFromString<LimitResetBasis>("\"card_year\""))
    }

    @Test
    fun anUnknownScheduleDecodesAsUnknownRatherThanFailingTheCard() {
        assertEquals(LimitResetBasis.UNKNOWN, Api.json.decodeFromString<LimitResetBasis>("\"fortnightly\""))
    }

    @Test
    fun aCardDecodesItsAnniversary() {
        val card = Api.json.decodeFromString<CardResponse>(
            """{"id":"c","financial_account_id":"a","account_name":"Amex","currency":"SGD",
               "cycle_basis":"statement","statement_day":18,"anniversary_date":"2024-03-14",
               "categories":[],"limits":[]}""",
        )
        assertEquals("2024-03-14", card.anniversaryDate?.apiDateOnly())
    }

    @Test
    fun aCardUpdateSendsTheAnniversary() {
        val obj = Api.json.parseToJsonElement(
            Api.json.encodeToString(cardUpdate("statement", 18, "2024-03-14", foreignFeePercent = null)),
        ).jsonObject
        assertEquals("2024-03-14", obj["anniversary_date"]?.jsonPrimitive?.content)
    }

    @Test
    fun aClearedAnniversaryIsAnExplicitNullNotAnOmittedKey() {
        // explicitNulls = false would drop a Kotlin null; only JsonNull reaches the wire.
        val obj = Api.json.parseToJsonElement(
            Api.json.encodeToString(cardUpdate("statement", 18, null, foreignFeePercent = null)),
        ).jsonObject
        assertTrue(obj.containsKey("anniversary_date"))
        assertEquals(JsonNull, obj["anniversary_date"])
    }

    @Test
    fun aCardUpdateSendsTheForeignFeeAndAClearedOneAsNull() {
        val set = Api.json.parseToJsonElement(
            Api.json.encodeToString(cardUpdate("statement", 18, null, foreignFeePercent = 3.25)),
        ).jsonObject
        assertEquals("3.25", set["foreign_fee_percent"]?.jsonPrimitive?.content)
        val cleared = Api.json.parseToJsonElement(
            Api.json.encodeToString(cardUpdate("statement", 18, null, foreignFeePercent = null)),
        ).jsonObject
        assertTrue(cleared.containsKey("foreign_fee_percent"))
        assertEquals(JsonNull, cleared["foreign_fee_percent"])
    }

    @Test
    fun aCardsForeignFeeDecodesFromTheDecimalString() {
        val card = Api.json.decodeFromString<CardResponse>(
            """{"id":"c","financial_account_id":"a","account_name":"Card","currency":"SGD",
               "cycle_basis":"statement","statement_day":18,"foreign_fee_percent":"3.25"}""",
        )
        assertEquals(3.25, card.foreignFeePercent!!, 0.0)
    }

    @Test
    fun anniversaryResetsAreOnlyOfferedOnceTheCardHasADate() {
        assertEquals(
            listOf(LimitResetBasis.CYCLE, LimitResetBasis.CALENDAR_MONTH, LimitResetBasis.QUARTER, LimitResetBasis.YEAR),
            resetOptions(hasAnniversary = false).filter { it.isAvailable }.map { it.basis },
        )
        val available = resetOptions(hasAnniversary = true).filter { it.isAvailable }.map { it.basis }
        assertTrue(LimitResetBasis.CARD_YEAR in available)
        assertTrue(LimitResetBasis.CARD_QUARTER in available)
    }
}
