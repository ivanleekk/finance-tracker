package com.ivanlee.financetracker

import com.ivanlee.financetracker.data.model.CounterpartyBalanceResponse
import com.ivanlee.financetracker.data.model.CounterpartyDirection
import com.ivanlee.financetracker.data.model.SplitChange
import com.ivanlee.financetracker.data.model.TransactionResponse
import com.ivanlee.financetracker.data.model.transactionUpdate
import com.ivanlee.financetracker.data.net.Api
import com.ivanlee.financetracker.logic.Reimbursements
import com.ivanlee.financetracker.logic.SplitAssessment
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/**
 * Splitting a bill (`logic/Reimbursements.kt`). Twin of the web
 * `frontend/src/lib/reimbursements.test.ts` and iOS's `ReimbursementsTests.swift` — the three
 * must agree about the same numbers.
 */
class ReimbursementsTest {

    @Test
    fun `leaves you the remainder of the bill`() {
        assertEquals(
            SplitAssessment.Valid(yourShare = 40.0, owed = 80.0),
            Reimbursements.assessSplit(120.0, 80.0),
        )
    }

    @Test
    fun `lets you front the whole thing`() {
        // Paying for someone entirely is a normal thing to do, and it should charge your budget
        // nothing rather than being rejected as a mistake.
        assertEquals(
            SplitAssessment.Valid(yourShare = 0.0, owed = 90.0),
            Reimbursements.assessSplit(90.0, 90.0),
        )
    }

    @Test
    fun `refuses a share larger than the bill instead of clamping`() {
        // Clamping would hide a typo behind a plausible number.
        assertTrue(Reimbursements.assessSplit(120.0, 200.0) is SplitAssessment.Invalid)
    }

    @Test
    fun `says nothing until both numbers are there`() {
        assertEquals(SplitAssessment.Incomplete, Reimbursements.assessSplit(120.0, null))
        assertEquals(SplitAssessment.Incomplete, Reimbursements.assessSplit(null, 80.0))
        assertEquals(SplitAssessment.Incomplete, Reimbursements.assessSplit(120.0, 0.0))
    }

    @Test
    fun `treats nonsense as nothing entered`() {
        assertEquals(SplitAssessment.Incomplete, Reimbursements.assessSplit(Double.NaN, 80.0))
        assertEquals(
            SplitAssessment.Incomplete,
            Reimbursements.assessSplit(120.0, Double.POSITIVE_INFINITY),
        )
    }

    @Test
    fun `reads a blank field as nothing rather than zero`() {
        assertNull(Reimbursements.parseMoney(""))
        assertNull(Reimbursements.parseMoney("   "))
        assertNull(Reimbursements.parseMoney("abc"))
    }

    @Test
    fun `reads a number with a typed thousands separator`() {
        assertEquals(1250.5, Reimbursements.parseMoney(" 1,250.50 ")!!, 0.0001)
    }

    @Test
    fun `keeps the two directions apart`() {
        // Netting to 55 would lose the fact that there are two things to settle, with two
        // different people, in two different directions.
        val rows = listOf(
            CounterpartyBalanceResponse("Alice", CounterpartyDirection.OWED_TO_YOU, 80.0),
            CounterpartyBalanceResponse("Bob", CounterpartyDirection.OWED_TO_YOU, 20.0),
            CounterpartyBalanceResponse("Alice", CounterpartyDirection.YOU_OWE, 45.0),
        )
        val totals = Reimbursements.totals(rows)
        assertEquals(100.0, totals.owedToYou, 0.0001)
        assertEquals(45.0, totals.youOwe, 0.0001)
    }

    @Test
    fun `one name in both directions is two rows`() {
        // The list is keyed by identity, so a person who both owes and is owed must not collapse
        // into a single row.
        val owed = CounterpartyBalanceResponse("Alice", CounterpartyDirection.OWED_TO_YOU, 80.0)
        val owes = CounterpartyBalanceResponse("Alice", CounterpartyDirection.YOU_OWE, 45.0)
        assertFalse(owed.key == owes.key)
    }

    @Test
    fun `keeps a repayment out of the spending breakdown`() {
        // Otherwise the same dinner is charged twice: once when the bill was paid, and again
        // when the debt was settled.
        assertFalse(Reimbursements.countsAsSpending("Reimbursement", isTransfer = false))
    }

    @Test
    fun `keeps a transfer out of the spending breakdown`() {
        // Moving your own money between your own accounts is not spending — you still have it.
        // A transfer's withdrawal leg is an expense row with a real category, so nothing else
        // would exclude it.
        assertFalse(Reimbursements.countsAsSpending("Transfer", isTransfer = true))
    }

    @Test
    fun `excludes a transfer whatever its category is called`() {
        // The transfer flag is the signal, not the category name: a household that renamed its
        // Transfer category must not start counting them.
        assertFalse(Reimbursements.countsAsSpending("Moving money", isTransfer = true))
        assertFalse(Reimbursements.countsAsSpending(null, isTransfer = true))
    }

    @Test
    fun `leaves ordinary categories alone`() {
        assertTrue(Reimbursements.countsAsSpending("Dining", isTransfer = false))
        assertTrue(Reimbursements.countsAsSpending("Investment", isTransfer = false))
        assertTrue(Reimbursements.countsAsSpending(null, isTransfer = false))
    }
}

/**
 * Decoding and encoding the split. The absent-keys case is the one that matters: every
 * transaction logged before the ledger existed comes back without them.
 */
class ReimbursementCodingTest {

    @Test
    fun `a transaction without split keys still decodes`() {
        val json = """
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
        """.trimIndent()
        val txn = Api.json.decodeFromString<TransactionResponse>(json)
        assertNull(txn.owedBy)
        assertNull(txn.owedAmount)
    }

    @Test
    fun `a split transaction decodes its share`() {
        // The backend serializes Decimal as a JSON string, hence the money serializer.
        val json = """
            {
              "id": "txn-1",
              "account_id": "acc-1",
              "category_id": "cat-1",
              "date": "2026-07-19T00:00:00",
              "amount": "120",
              "currency": "SGD",
              "description": "Group dinner",
              "transaction_type": "expense",
              "owed_by": "Alice",
              "owed_amount": "80"
            }
        """.trimIndent()
        val txn = Api.json.decodeFromString<TransactionResponse>(json)
        assertEquals("Alice", txn.owedBy)
        assertEquals(80.0, txn.owedAmount!!, 0.0001)
    }

    @Test
    fun `balances decode from the list endpoint`() {
        val json = """
            [{"counterparty_name": "Alice", "direction": "owed_to_you", "amount": "80.00"},
             {"counterparty_name": "Bob", "direction": "you_owe", "amount": "45.00"}]
        """.trimIndent()
        val rows = Api.json.decodeFromString<List<CounterpartyBalanceResponse>>(json)
        assertEquals(2, rows.size)
        assertEquals(CounterpartyDirection.OWED_TO_YOU, rows[0].direction)
        assertEquals(CounterpartyDirection.YOU_OWE, rows[1].direction)
        assertEquals(45.0, rows[1].amount, 0.0001)
    }

    // The three SplitChange cases exist because "leave it alone" and "remove it" are different
    // requests, and the API tells them apart by whether the key is present.

    private fun encoded(split: SplitChange) = Api.json.encodeToString(
        transactionUpdate(
            date = Instant.EPOCH,
            amount = 120.0,
            description = "Group dinner",
            accountId = "acc-1",
            categoryId = "cat-1",
            split = split,
        )
    ).let { Api.json.parseToJsonElement(it).jsonObject }

    @Test
    fun `an unchanged split omits the keys entirely`() {
        // This is what stops an unrelated description edit from quietly making a shared dinner
        // all yours.
        val obj = encoded(SplitChange.Unchanged)
        assertFalse(obj.containsKey("owed_by"))
        assertFalse(obj.containsKey("owed_amount"))
    }

    @Test
    fun `clearing a split sends explicit nulls`() {
        val obj = encoded(SplitChange.Clear)
        assertTrue(obj.containsKey("owed_by"))
        assertTrue(obj.containsKey("owed_amount"))
        assertEquals("null", obj["owed_by"].toString())
        assertEquals("null", obj["owed_amount"].toString())
    }

    @Test
    fun `setting a split sends both halves`() {
        val obj = encoded(SplitChange.Set(owedBy = "Alice", owedAmount = 80.0))
        assertEquals("\"Alice\"", obj["owed_by"].toString())
        assertEquals("80.0", obj["owed_amount"].toString())
    }
}
