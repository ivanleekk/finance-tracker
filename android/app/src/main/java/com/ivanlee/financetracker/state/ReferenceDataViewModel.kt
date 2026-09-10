package com.ivanlee.financetracker.state

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ivanlee.financetracker.data.model.AccountResponse
import com.ivanlee.financetracker.data.model.AssetResponse
import com.ivanlee.financetracker.data.model.CategoryResponse
import com.ivanlee.financetracker.data.model.SubPortfolioResponse
import com.ivanlee.financetracker.data.net.Api
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

/**
 * The reference sets Quick Add fills its pickers from — accounts, categories, sub-portfolios
 * and assets — held at the app root and loaded once per household instead of once per sheet.
 * Mirrors ios/FinanceTracker/State/ReferenceDataStore.swift.
 *
 * Quick Add used to fetch all four from inside the sheet, and because `MainScaffold` only
 * composes the sheet while it is presented, that happened on *every* open. On a cold start
 * over a real network the account picker therefore sat on "Select…" for a full round trip —
 * indistinguishable from "this household has no accounts", which is what made people close it
 * and go to the Accounts tab to wake the data up (#272). Loading when the household resolves
 * means the sheet almost always opens with its pickers already filled, and reopening is free.
 *
 * Accounts and categories are published **before** the portfolio sets are awaited: an expense
 * is the default mode and needs only those two, and making it wait on `/portfolio/assets`
 * buys it nothing.
 */
class ReferenceDataViewModel : ViewModel() {

    /** What the pickers can offer right now, and whether more is still coming. */
    sealed interface Status {
        /** No household yet, so there is nothing to load. */
        data object Idle : Status

        /** In flight, and [accounts]/[categories] have not landed yet. */
        data object Loading : Status

        /** Accounts and categories are usable; the portfolio sets may still be in flight. */
        data object Essentials : Status
        data object Ready : Status
        data class Failed(val message: String) : Status
    }

    var accounts by mutableStateOf<List<AccountResponse>>(emptyList())
        private set
    var categories by mutableStateOf<List<CategoryResponse>>(emptyList())
        private set
    var subPortfolios by mutableStateOf<List<SubPortfolioResponse>>(emptyList())
        private set
    var assets by mutableStateOf<List<AssetResponse>>(emptyList())
        private set
    var status by mutableStateOf<Status>(Status.Idle)
        private set

    /**
     * Accounts and categories have landed at least once for this household.
     *
     * Not derived from [status]: a *refresh* that fails (or is still in flight) leaves the
     * previous answer sitting in [accounts]/[categories], and that answer is still the best one
     * available. Reading the status instead made a failed refresh hide data the store was still
     * holding, so Quick Add reopened with the pickers back on "Select…" — the very symptom this
     * exists to prevent.
     */
    var hasEssentials by mutableStateOf(false)
        private set

    val failureMessage: String? get() = (status as? Status.Failed)?.message

    /**
     * The household the data above describes. A load for a different one replaces everything
     * rather than merging — two households' accounts must never mix.
     */
    private var loadedHouseholdId: String? = null
    private var inFlight: Job? = null

    /**
     * Fetch the reference sets for [householdId], unless they are already loaded (or loading)
     * for that same household. [force] re-fetches regardless — used after a change is logged,
     * and by the retry button.
     */
    fun load(householdId: String?, force: Boolean = false) {
        if (householdId == null) {
            inFlight?.cancel()
            inFlight = null
            clear()
            status = Status.Idle
            loadedHouseholdId = null
            return
        }
        // Already loaded, or already on its way — either way, don't start a second one.
        // A previous failure is the exception: there is nothing to wait for there.
        if (!force && householdId == loadedHouseholdId && status !is Status.Failed) return

        inFlight?.cancel()
        if (householdId != loadedHouseholdId) clear()
        loadedHouseholdId = householdId
        status = Status.Loading
        inFlight = viewModelScope.launch { fetch(householdId) }
    }

    private suspend fun fetch(householdId: String) {
        try {
            coroutineScope {
                val accountsReq = async { Api.get<List<AccountResponse>>("/accounts/household/$householdId") }
                val categoriesReq = async { Api.get<List<CategoryResponse>>("/cashflow/categories/household/$householdId") }
                val subsReq = async { Api.get<List<SubPortfolioResponse>>("/portfolio/subportfolios/household/$householdId") }
                val assetsReq = async { Api.get<List<AssetResponse>>("/portfolio/assets") }

                val fetchedAccounts = accountsReq.await()
                val fetchedCategories = categoriesReq.await()
                if (loadedHouseholdId != householdId) return@coroutineScope
                // Published before the portfolio sets are awaited, so the account and category
                // pickers fill as soon as their own requests land.
                applyEssentials(fetchedAccounts, fetchedCategories)

                val fetchedSubs = subsReq.await()
                val fetchedAssets = assetsReq.await()
                if (loadedHouseholdId != householdId) return@coroutineScope
                subPortfolios = fetchedSubs
                assets = fetchedAssets
                status = Status.Ready
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (loadedHouseholdId != householdId) return
            // A failure part-way through leaves whatever did land usable rather than blanking
            // the pickers; the status still says something went wrong.
            status = Status.Failed(e.message ?: "Couldn't load your accounts.")
        }
    }

    /**
     * Publish the first stage. Kept as its own step rather than inlined so the latch and the
     * status can't drift apart, and so both are reachable from the tests without a backend.
     */
    fun applyEssentials(accounts: List<AccountResponse>, categories: List<CategoryResponse>) {
        this.accounts = accounts
        this.categories = categories
        hasEssentials = true
        status = Status.Essentials
    }

    /**
     * Move the status without touching the data already published — which is the whole point
     * on a failed refresh.
     */
    fun applyStatus(status: Status) {
        this.status = status
    }

    private fun clear() {
        hasEssentials = false
        accounts = emptyList()
        categories = emptyList()
        subPortfolios = emptyList()
        assets = emptyList()
    }

    // ---- Local edits --------------------------------------------------------------------
    //
    // Quick Add can create a category or an asset from inside the sheet. Folding the new row
    // in beats re-fetching: the sheet needs it selected immediately, and a round trip is the
    // thing this exists to avoid.

    fun add(category: CategoryResponse) {
        if (categories.none { it.id == category.id }) categories = categories + category
    }

    fun add(asset: AssetResponse) {
        if (assets.none { it.id == asset.id }) assets = assets + asset
    }
}
