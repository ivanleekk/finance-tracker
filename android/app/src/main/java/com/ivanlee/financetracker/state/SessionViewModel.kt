package com.ivanlee.financetracker.state

import android.app.Application
import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.ivanlee.financetracker.data.model.AccountCreate
import com.ivanlee.financetracker.data.model.AccountKind
import com.ivanlee.financetracker.data.model.AccountResponse
import com.ivanlee.financetracker.data.model.BalanceCreate
import com.ivanlee.financetracker.data.model.BalanceResponse
import com.ivanlee.financetracker.data.model.HouseholdCreate
import com.ivanlee.financetracker.data.model.HouseholdInviteCreate
import com.ivanlee.financetracker.data.model.HouseholdInviteResponse
import com.ivanlee.financetracker.data.model.HouseholdResponse
import com.ivanlee.financetracker.data.model.HouseholdRole
import com.ivanlee.financetracker.data.model.HouseholdUpdate
import com.ivanlee.financetracker.data.model.LiquidityStatus
import com.ivanlee.financetracker.data.model.TaxTreatment
import com.ivanlee.financetracker.data.model.UserCreate
import com.ivanlee.financetracker.data.model.UserResponse
import com.ivanlee.financetracker.data.model.UserUpdate
import com.ivanlee.financetracker.data.net.Api
import com.ivanlee.financetracker.data.net.TokenStore
import com.ivanlee.financetracker.data.net.apiDateOnly
import com.ivanlee.financetracker.ui.theme.AppTheme
import kotlinx.coroutines.launch
import java.time.Instant

/**
 * App-wide session: auth state, current user, households, active household. Mirrors
 * ios/FinanceTracker/State/SessionStore.swift (and the web's AuthContext + HouseholdContext).
 *
 * A ViewModel rather than a remembered object so it outlives configuration changes — on
 * Android a rotation would otherwise re-run bootstrap and flash the login screen.
 */
class SessionViewModel(app: Application) : AndroidViewModel(app) {

    enum class Phase { LOADING, UNAUTHENTICATED, AUTHENTICATED }

    var phase by mutableStateOf(Phase.LOADING)
        private set
    var user by mutableStateOf<UserResponse?>(null)
        private set
    val households = mutableStateListOf<HouseholdResponse>()

    /**
     * True while the guided first-run flow owns the screen. Set when a brand-new user signs
     * up (backend `POST /users` doesn't create a household, so they'd otherwise land with
     * nothing) and cleared when onboarding finishes. Keeps the onboarding screen mounted even
     * after step 1 creates the household — without this the root would swap in the main
     * scaffold the moment `households` becomes non-empty, mid-flow.
     */
    var isOnboarding by mutableStateOf(false)
        private set

    /**
     * Show the guided setup when there's no household to work in, or while the flow is
     * explicitly active. Mirrors the web redirect to `/onboarding` for household-less users.
     */
    val needsOnboarding: Boolean get() = isOnboarding || households.isEmpty()

    var activeHousehold by mutableStateOf<HouseholdResponse?>(null)
        private set

    /** Resolved palettes for the logged-in user's saved choices. */
    val theme: AppTheme get() = AppTheme.from(user)

    /** The user's `theme_mode`: "light", "dark", or null to follow the device. */
    val themeMode: String? get() = user?.themeMode

    private val prefs = app.getSharedPreferences("waypoint_prefs", Context.MODE_PRIVATE)

    init {
        viewModelScope.launch {
            // A dead refresh token anywhere in the app drops straight to the login screen.
            Api.sessionExpired.collect { forceLogout() }
        }
    }

    fun selectHousehold(household: HouseholdResponse?) {
        activeHousehold = household
        prefs.edit().putString(ACTIVE_HOUSEHOLD_KEY, household?.id).apply()
    }

    suspend fun bootstrap() {
        if (TokenStore.accessToken == null) {
            phase = Phase.UNAUTHENTICATED
            return
        }
        phase = try {
            loadSession()
            Phase.AUTHENTICATED
        } catch (e: Exception) {
            Phase.UNAUTHENTICATED
        }
    }

    suspend fun login(email: String, password: String) {
        Api.login(email, password)
        loadSession()
        phase = Phase.AUTHENTICATED
    }

    suspend fun signup(email: String, password: String, name: String) {
        Api.post<UserCreate, UserResponse>("/users", UserCreate(email, password, name))
        login(email, password)
        // A fresh signup has no household yet — hand off to the guided setup flow.
        if (households.isEmpty()) isOnboarding = true
    }

    /** Partial PUT /users; null fields are omitted and left unchanged server-side. */
    suspend fun updateUser(update: UserUpdate) {
        user = Api.put<UserUpdate, UserResponse>("/users", update)
    }

    suspend fun updateAppearance(
        themeMode: String? = null,
        primaryColor: String? = null,
        secondaryColor: String? = null,
        baseColor: String? = null,
    ) = updateUser(
        UserUpdate(
            themeMode = themeMode,
            primaryColor = primaryColor,
            secondaryColor = secondaryColor,
            baseColor = baseColor,
        )
    )

    /**
     * Rename the active household / change its base reporting currency or its emergency-fund
     * target. Omitted fields are left alone by the backend.
     */
    suspend fun updateHousehold(
        id: String,
        name: String? = null,
        baseCurrency: String? = null,
        emergencyFundTargetMonths: Double? = null,
    ) {
        val updated = Api.put<HouseholdUpdate, HouseholdResponse>(
            "/users/households/$id",
            HouseholdUpdate(
                name = name,
                baseCurrency = baseCurrency,
                emergencyFundTargetMonths = emergencyFundTargetMonths,
            ),
        )
        val index = households.indexOfFirst { it.id == id }
        if (index >= 0) households[index] = updated
        if (activeHousehold?.id == id) selectHousehold(updated)
    }

    /** Create a household, refresh the list, and switch to it as the active one. */
    suspend fun createHousehold(name: String, baseCurrency: String, countryCode: String) {
        val created = Api.post<HouseholdCreate, HouseholdResponse>(
            "/users/households",
            HouseholdCreate(name, baseCurrency, countryCode),
        )
        val refreshed: List<HouseholdResponse> = Api.get("/users/households")
        households.clear()
        households.addAll(refreshed)
        selectHousehold(refreshed.firstOrNull { it.id == created.id } ?: created)
    }

    // ---- Onboarding (guided first-run; mirrors web /onboarding) --------------------------

    /**
     * Create a preset account and, when a starting balance is given, seed it. Used by the
     * onboarding "Cash / Investment account" presets. `ownerUserId` follows the user's
     * private-by-default choice.
     */
    suspend fun createPresetAccount(
        householdId: String,
        name: String,
        liquidity: LiquidityStatus,
        currency: String,
        ownerUserId: String?,
        startingBalance: Double,
    ) {
        val account = Api.post<AccountCreate, AccountResponse>(
            "/accounts",
            AccountCreate(
                householdId = householdId,
                name = name,
                liquidity = liquidity,
                taxStatus = TaxTreatment.TAXABLE,
                kind = AccountKind.ASSET,
                currency = currency,
                ownerUserId = ownerUserId,
            ),
        )
        Api.post<BalanceCreate, BalanceResponse>(
            "/accounts/balances",
            BalanceCreate(
                accountId = account.id,
                date = Instant.now().apiDateOnly(),
                balance = startingBalance,
                isManual = true,
            ),
        )
    }

    /** Send a household invite (onboarding step 2). Editor role, matching web. */
    suspend fun sendInvite(householdId: String, email: String) {
        Api.post<HouseholdInviteCreate, HouseholdInviteResponse>(
            "/users/households/$householdId/invites",
            HouseholdInviteCreate(email, HouseholdRole.EDITOR),
        )
    }

    /** Leave the guided flow and land in the app proper. */
    fun finishOnboarding() {
        isOnboarding = false
    }

    fun logout() {
        TokenStore.clear()
        forceLogout()
    }

    private fun forceLogout() {
        user = null
        households.clear()
        activeHousehold = null
        phase = Phase.UNAUTHENTICATED
    }

    private suspend fun loadSession() {
        user = Api.get("/users")
        val loaded: List<HouseholdResponse> = Api.get("/users/households")
        households.clear()
        households.addAll(loaded)
        val savedId = prefs.getString(ACTIVE_HOUSEHOLD_KEY, null)
        activeHousehold = loaded.firstOrNull { it.id == savedId } ?: loaded.firstOrNull()
    }

    private companion object {
        const val ACTIVE_HOUSEHOLD_KEY = "activeHouseholdId"
    }
}
