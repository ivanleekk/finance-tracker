package com.ivanlee.financetracker

import com.ivanlee.financetracker.data.model.CardCategoryResponse
import com.ivanlee.financetracker.data.model.CardLimitStatusRow
import com.ivanlee.financetracker.data.model.CardResponse
import com.ivanlee.financetracker.data.model.CardStatusResponse
import com.ivanlee.financetracker.data.model.CycleBasis
import com.ivanlee.financetracker.data.model.LimitDirection
import com.ivanlee.financetracker.data.model.SplitChange
import com.ivanlee.financetracker.data.model.transactionUpdate
import com.ivanlee.financetracker.logic.Cards
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.encodeToJsonElement
import org.junit.Assert.assertEquals
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
    ) = CardLimitStatusRow(
        limitId = limitId,
        name = "Dining cap",
        categoryNames = listOf("Dining"),
        direction = direction,
        amount = 1000.0,
        spent = 240.0,
        remaining = remaining,
        percentUsed = 24.0,
        periodStart = Instant.parse("2026-08-19T00:00:00Z"),
        periodEnd = Instant.parse("2026-09-18T00:00:00Z"),
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

    private val card = CardResponse(
        id = "card-1",
        financialAccountId = "acc-1",
        accountName = "Amex Platinum",
        currency = "SGD",
        cycleBasis = CycleBasis.STATEMENT,
        statementDay = 18,
        categories = listOf(
            CardCategoryResponse("cc-1", "card-1", "Dining", true, 0, "lim-1"),
            CardCategoryResponse("cc-2", "card-1", "Groceries", false, 1, "lim-1"),
            CardCategoryResponse("cc-3", "card-1", "Everything else", false, 2, null),
        ),
        limits = emptyList(),
    )

    private fun status(rows: List<CardLimitStatusRow>) = CardStatusResponse(
        cardId = "card-1",
        accountName = "Amex Platinum",
        currency = "SGD",
        cycleStart = Instant.parse("2026-08-19T00:00:00Z"),
        cycleEnd = Instant.parse("2026-09-18T00:00:00Z"),
        limits = rows,
        categories = emptyList(),
    )

    @Test
    fun `fans a shared limit over every category drawing on it`() {
        val map = Cards.headroomByCategory(card, status(listOf(row())))
        assertEquals("lim-1", map["cc-1"]?.limitId)
        assertEquals("lim-1", map["cc-2"]?.limitId)
    }

    @Test
    fun `gives an unmetered category no entry rather than a zero`() {
        // "Tracked but unmetered" and "nothing left" must not look the same.
        assertNull(Cards.headroomByCategory(card, status(listOf(row())))["cc-3"])
    }

    @Test
    fun `omits a category whose limit is missing from the status`() {
        assertTrue(Cards.headroomByCategory(card, status(emptyList())).isEmpty())
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
                split = SplitChange.Unchanged,
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
}
