package com.ivanlee.financetracker

import com.ivanlee.financetracker.data.model.CounterpartyBalanceResponse
import com.ivanlee.financetracker.data.model.CounterpartyDirection
import com.ivanlee.financetracker.data.model.TransactionResponse
import com.ivanlee.financetracker.data.model.TransactionSplitInput
import com.ivanlee.financetracker.data.model.transactionUpdate
import com.ivanlee.financetracker.data.net.Api
import com.ivanlee.financetracker.logic.Reimbursements
import com.ivanlee.financetracker.logic.SplitAssessment
import com.ivanlee.financetracker.logic.SplitEntry
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
            Reimbursements.assessSplit(120.0, listOf(SplitEntry("alice", 80.0))),
        )
    }

    @Test
    fun `sums several people's shares`() {
        val result = Reimbursements.assessSplit(
            300.0,
            listOf(SplitEntry("alice", 100.0), SplitEntry("bob", 100.0)),
        )
        assertEquals(SplitAssessment.Valid(yourShare = 100.0, owed = 200.0), result)
    }

    @Test
    fun `lets you front the whole thing`() {
        // Paying for someone entirely is a normal thing to do, and it should charge your budget
        // nothing rather than being rejected as a mistake.
        assertEquals(
            SplitAssessment.Valid(yourShare = 0.0, owed = 90.0),
            Reimbursements.assessSplit(90.0, listOf(SplitEntry("alice", 90.0))),
        )
    }

    @Test
    fun `refuses a combined share larger than the bill instead of clamping`() {
        // Clamping would hide a typo behind a plausible number.
        val result = Reimbursements.assessSplit(
            120.0,
            listOf(SplitEntry("alice", 100.0), SplitEntry("bob", 100.0)),
        )
        assertTrue(result is SplitAssessment.Invalid)
    }

    @Test
    fun `refuses the same person appearing twice`() {
        val result = Reimbursements.assessSplit(
            120.0,
            listOf(SplitEntry("alice", 40.0), SplitEntry("alice", 40.0)),
        )
        assertTrue(result is SplitAssessment.Invalid)
    }

    @Test
    fun `says nothing until the bill and every entry has an amount`() {
        assertEquals(SplitAssessment.Incomplete, Reimbursements.assessSplit(120.0, emptyList()))
        assertEquals(
            SplitAssessment.Incomplete,
            Reimbursements.assessSplit(null, listOf(SplitEntry("alice", 80.0))),
        )
        assertEquals(
            SplitAssessment.Incomplete,
            Reimbursements.assessSplit(120.0, listOf(SplitEntry("alice", null))),
        )
        assertEquals(
            SplitAssessment.Incomplete,
            Reimbursements.assessSplit(120.0, listOf(SplitEntry("alice", 0.0))),
        )
    }

    @Test
    fun `treats nonsense as nothing entered`() {
        assertEquals(
            SplitAssessment.Incomplete,
            Reimbursements.assessSplit(Double.NaN, listOf(SplitEntry("alice", 80.0))),
        )
        assertEquals(
            SplitAssessment.Incomplete,
            Reimbursements.assessSplit(120.0, listOf(SplitEntry("alice", Double.POSITIVE_INFINITY))),
        )
    }

    @Test
    fun `divides what's left after specified shares across the rest`() {
        assertEquals(100.0, Reimbursements.evenSplitRemainder(300.0, listOf(100.0), 2)!!, 0.0001)
    }

    @Test
    fun `even split is null when there's nobody left to split the remainder among`() {
        assertNull(Reimbursements.evenSplitRemainder(300.0, listOf(100.0), 0))
    }

    @Test
    fun `even split is null when the specified shares already cover the bill`() {
        assertNull(Reimbursements.evenSplitRemainder(100.0, listOf(100.0), 1))
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
            CounterpartyBalanceResponse("alice", "Alice", CounterpartyDirection.OWED_TO_YOU, 80.0),
            CounterpartyBalanceResponse("bob", "Bob", CounterpartyDirection.OWED_TO_YOU, 20.0),
            CounterpartyBalanceResponse("alice", "Alice", CounterpartyDirection.YOU_OWE, 45.0),
        )
        val totals = Reimbursements.totals(rows)
        assertEquals(100.0, totals.owedToYou, 0.0001)
        assertEquals(45.0, totals.youOwe, 0.0001)
    }

    @Test
    fun `one name in both directions is two rows`() {
        // The list is keyed by identity, so a person who both owes and is owed must not collapse
        // into a single row.
        val owed = CounterpartyBalanceResponse("alice", "Alice", CounterpartyDirection.OWED_TO_YOU, 80.0)
        val owes = CounterpartyBalanceResponse("alice", "Alice", CounterpartyDirection.YOU_OWE, 45.0)
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
 * Decoding and encoding the split. The absent-key case is the one that matters: every
 * transaction logged before the ledger existed comes back without it.
 */
class ReimbursementCodingTest {

    @Test
    fun `a transaction without a splits key still decodes`() {
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
        assertTrue(txn.splits.isEmpty())
    }

    @Test
    fun `a split transaction decodes every share`() {
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
              "splits": [
                {"counterparty_id": "alice", "counterparty_name": "Alice", "amount": "50"},
                {"counterparty_id": "bob", "counterparty_name": "Bob", "amount": "30"}
              ]
            }
        """.trimIndent()
        val txn = Api.json.decodeFromString<TransactionResponse>(json)
        assertEquals(2, txn.splits.size)
        assertEquals("Alice", txn.splits[0].counterpartyName)
        assertEquals(50.0, txn.splits[0].amount, 0.0001)
        assertEquals(30.0, txn.splits[1].amount, 0.0001)
    }

    @Test
    fun `balances decode from the list endpoint`() {
        val json = """
            [{"counterparty_id": "alice", "counterparty_name": "Alice", "direction": "owed_to_you", "amount": "80.00", "owner_user_id": null},
             {"counterparty_id": "bob", "counterparty_name": "Bob", "direction": "you_owe", "amount": "45.00", "owner_user_id": "user-1"}]
        """.trimIndent()
        val rows = Api.json.decodeFromString<List<CounterpartyBalanceResponse>>(json)
        assertEquals(2, rows.size)
        assertEquals(CounterpartyDirection.OWED_TO_YOU, rows[0].direction)
        assertEquals(CounterpartyDirection.YOU_OWE, rows[1].direction)
        assertEquals(45.0, rows[1].amount, 0.0001)
        // The debt's own owner scope, not the account that will eventually settle
        // it — a settle request must echo this back verbatim (see SettlementCreate).
        assertEquals(null, rows[0].ownerUserId)
        assertEquals("user-1", rows[1].ownerUserId)
    }

    @Test
    fun `a balance with no owner key still decodes as shared`() {
        // Older responses, or a row with no owner scope at all, must decode as
        // "shared" rather than failing — an absent key is not the same as a bug.
        val json = """
            [{"counterparty_id": "alice", "counterparty_name": "Alice", "direction": "owed_to_you", "amount": "80.00"}]
        """.trimIndent()
        val rows = Api.json.decodeFromString<List<CounterpartyBalanceResponse>>(json)
        assertEquals(null, rows[0].ownerUserId)
    }

    // A plain nullable list already has an unambiguous empty state, so there is no JsonElement
    // dance here the way there is for `cardCategoryId`: null omits the key (leave the split
    // alone), and emptyList() sends `[]` (clear it).

    private fun encoded(splits: List<TransactionSplitInput>?) = Api.json.encodeToString(
        transactionUpdate(
            date = Instant.EPOCH,
            amount = 120.0,
            description = "Group dinner",
            accountId = "acc-1",
            categoryId = "cat-1",
            // The form always sends a code (blank when there is none); this helper
            // is about the splits key, so it sends what an untouched field would.
            mcc = "",
            splits = splits,
        )
    ).let { Api.json.parseToJsonElement(it).jsonObject }

    @Test
    fun `an unchanged split omits the key entirely`() {
        // This is what stops an unrelated description edit from quietly making a shared dinner
        // all yours.
        val obj = encoded(null)
        assertFalse(obj.containsKey("splits"))
    }

    @Test
    fun `clearing a split sends an empty array`() {
        val obj = encoded(emptyList())
        assertTrue(obj.containsKey("splits"))
        assertEquals("[]", obj["splits"].toString())
    }

    @Test
    fun `setting a split sends every share`() {
        val obj = encoded(
            listOf(
                TransactionSplitInput(counterpartyId = "alice", amount = 50.0),
                TransactionSplitInput(counterpartyId = "bob", amount = 30.0),
            )
        )
        val splits = obj["splits"].toString()
        assertTrue(splits.contains("\"alice\""))
        assertTrue(splits.contains("\"bob\""))
        assertTrue(splits.contains("50.0"))
        assertTrue(splits.contains("30.0"))
    }
}
