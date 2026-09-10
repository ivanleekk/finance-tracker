package com.ivanlee.financetracker

import com.ivanlee.financetracker.data.model.AssetResponse
import com.ivanlee.financetracker.data.model.CategoryResponse
import com.ivanlee.financetracker.data.model.TransactionType
import com.ivanlee.financetracker.state.ReferenceDataViewModel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Kotlin twin of iOS's `ReferenceDataStoreTests`.
 *
 * `ReferenceDataViewModel` is what stops Quick Add opening with an empty account picker on a
 * cold start (#272). Its fetching half needs a backend and isn't exercised here; what is
 * exercised is the part that decides whether the pickers have something to show and how a
 * locally-created row folds in — the two places the empty-picker bug can come back.
 */
class ReferenceDataViewModelTest {

    private fun category(id: String, name: String = "Dining") =
        CategoryResponse(id = id, householdId = "hh", name = name, type = TransactionType.EXPENSE)

    private fun asset(id: String, ticker: String = "VOO") =
        AssetResponse(id = id, ticker = ticker, name = ticker, type = "stock", currency = "USD")

    // ---- hasEssentials ------------------------------------------------------------------

    @Test
    fun `starts with nothing to show`() {
        val vm = ReferenceDataViewModel()
        assertEquals(ReferenceDataViewModel.Status.Idle, vm.status)
        assertFalse(vm.hasEssentials)
        assertNull(vm.failureMessage)
    }

    /** No household means nothing to load — and that is Idle, not a failure, so the sheet shows
     *  neither a spinner nor an error. */
    @Test
    fun `no household clears to idle`() {
        val vm = ReferenceDataViewModel()
        vm.applyEssentials(emptyList(), listOf(category("c1")))
        vm.load(null)
        assertEquals(ReferenceDataViewModel.Status.Idle, vm.status)
        assertTrue(vm.accounts.isEmpty())
        assertTrue(vm.categories.isEmpty())
        assertFalse(vm.hasEssentials)
    }

    // ---- failure reporting --------------------------------------------------------------

    @Test
    fun `failure exposes its message`() {
        val vm = ReferenceDataViewModel()
        vm.applyStatus(ReferenceDataViewModel.Status.Failed("Could not connect to the server."))
        assertEquals("Could not connect to the server.", vm.failureMessage)
    }

    /**
     * The regression this exists to prevent, in miniature: a *refresh* that fails must not take
     * the previously-loaded pickers down with it. `hasEssentials` therefore records that
     * accounts and categories have arrived, rather than being read back off the current status.
     */
    @Test
    fun `failed refresh keeps what already landed`() {
        val vm = ReferenceDataViewModel()
        vm.applyEssentials(emptyList(), listOf(category("c1")))
        assertTrue(vm.hasEssentials)
        vm.applyStatus(ReferenceDataViewModel.Status.Failed("offline"))
        assertTrue(vm.hasEssentials)
        assertEquals(1, vm.categories.size)
    }

    // ---- local edits --------------------------------------------------------------------

    @Test
    fun `adds a category created in the sheet`() {
        val vm = ReferenceDataViewModel()
        vm.add(category("c1"))
        assertEquals(listOf("c1"), vm.categories.map { it.id })
    }

    /**
     * Quick Add folds a newly-created row in *and* the next refresh returns it from the server,
     * so adding the same id twice must not double it up in the picker.
     */
    @Test
    fun `does not duplicate an existing row`() {
        val vm = ReferenceDataViewModel()
        vm.add(category("c1"))
        vm.add(category("c1", name = "Dining (renamed)"))
        assertEquals(1, vm.categories.size)

        vm.add(asset("a1"))
        vm.add(asset("a1"))
        assertEquals(1, vm.assets.size)
    }
}
