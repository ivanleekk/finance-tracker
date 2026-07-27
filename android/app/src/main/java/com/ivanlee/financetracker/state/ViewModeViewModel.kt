package com.ivanlee.financetracker.state

import android.app.Application
import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.AndroidViewModel
import com.ivanlee.financetracker.data.model.HouseholdInviteResponse
import com.ivanlee.financetracker.data.model.HouseholdMemberUserResponse
import com.ivanlee.financetracker.data.model.ViewMode
import com.ivanlee.financetracker.data.net.Api
import com.ivanlee.financetracker.logic.ViewModeVisibility
import com.ivanlee.financetracker.security.BiometricAuth
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope

/**
 * Global Private / Household / Blended switch, mirroring the web `ViewModeContext` and
 * ios/FinanceTracker/State/ViewModeStore.swift.
 *
 * The switch only matters once the active household actually has a second person — a member
 * beyond the owner, or a pending invite. Every user technically has their own household, so
 * household *count* is not the signal; a real second person has to be involved. Until then
 * everything is "blended" (show all of my own data) and the switcher is hidden.
 */
class ViewModeViewModel(app: Application) : AndroidViewModel(app) {

    private val prefs = app.getSharedPreferences("waypoint_prefs", Context.MODE_PRIVATE)

    /** The user's chosen mode. Persisted; only takes effect once [hasSecondPerson]. */
    var viewMode by mutableStateOf(ViewMode.from(prefs.getString(STORAGE_KEY, null)))
        private set

    fun chooseViewMode(mode: ViewMode) {
        viewMode = mode
        prefs.edit().putString(STORAGE_KEY, mode.wire).apply()
    }

    /**
     * True once someone besides the owner is a member of, or invited to, the active
     * household. Controls whether the switcher renders and whether filtering applies.
     */
    var hasSecondPerson by mutableStateOf(false)
        private set

    // ---- Private-vault lock -------------------------------------------------------------

    /** The user's `require_face_id_for_vault` preference. */
    var requireBiometric by mutableStateOf(false)
        private set

    /** Cached at configure time so [isVisible] (called every render) doesn't re-probe. */
    private var biometricsAvailable = false

    /** Whether the vault has been unlocked this session. Only meaningful when [requireBiometric]. */
    var vaultUnlocked by mutableStateOf(false)
        private set

    /**
     * The vault is locked — private items hidden regardless of view mode — only when the user
     * requires biometrics, the device can actually authenticate, and they haven't unlocked
     * yet. On a device with no biometrics/screen lock we fail open so nobody is locked out.
     */
    val isVaultLocked: Boolean
        get() = ViewModeVisibility.isVaultLocked(requireBiometric, biometricsAvailable, vaultUnlocked)

    /**
     * True when the lock feature is active on this device (setting on + biometrics present),
     * so UI can show a lock/unlock control whether currently locked or not.
     */
    val vaultLockActive: Boolean get() = requireBiometric && biometricsAvailable

    /**
     * Solo households have no one to hide things from, so everything stays blended regardless
     * of the persisted choice (matches web `effectiveViewMode`).
     */
    val effectiveMode: ViewMode get() = ViewModeVisibility.effectiveMode(viewMode, hasSecondPerson)

    /**
     * Update the second-person signal from already-fetched counts, so callers that just
     * loaded members/invites don't re-hit the network.
     */
    fun setComposition(memberCount: Int, pendingInviteCount: Int) {
        hasSecondPerson = memberCount > 1 || pendingInviteCount > 0
    }

    /**
     * Re-evaluate whether the active household has a second person (members + invites). Call
     * on launch, when the active household changes, and after invites change.
     */
    suspend fun refresh(householdId: String?) {
        if (householdId == null) {
            hasSecondPerson = false
            return
        }
        hasSecondPerson = try {
            coroutineScope {
                val members = async {
                    Api.get<List<HouseholdMemberUserResponse>>("/users/householdmember/$householdId")
                }
                val invites = async {
                    Api.get<List<HouseholdInviteResponse>>("/users/households/$householdId/invites")
                }
                members.await().size > 1 || invites.await().isNotEmpty()
            }
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Given an item's owner (null = shared) and the current user, should it be shown under
     * the current effective mode? Mirrors web `isVisibleInViewMode`, plus the local vault
     * lock: while the vault is locked, private items are hidden in every mode until the user
     * authenticates.
     */
    fun isVisible(ownerUserId: String?, currentUserId: String?): Boolean =
        ViewModeVisibility.isVisible(
            mode = viewMode,
            hasSecondPerson = hasSecondPerson,
            vaultLocked = isVaultLocked,
            ownerUserId = ownerUserId,
            currentUserId = currentUserId,
        )

    /**
     * Apply the user's biometric preference (call on login and when the user record changes).
     * A fresh configuration re-locks the vault so switching accounts always re-authenticates.
     */
    fun configureVault(requireBiometric: Boolean) = configureVault(
        requireBiometric = requireBiometric,
        biometricsAvailable = requireBiometric && BiometricAuth.isAvailable(getApplication()),
    )

    /** Availability-injecting variant so the gating logic is testable without live hardware. */
    fun configureVault(requireBiometric: Boolean, biometricsAvailable: Boolean) {
        this.requireBiometric = requireBiometric
        this.biometricsAvailable = biometricsAvailable
        vaultUnlocked = false
    }

    /**
     * Prompt for biometrics/device credential; on success the vault stays unlocked for the
     * session. Returns true when the vault ends up usable (already unlocked, not required, or
     * authentication succeeded).
     */
    suspend fun unlockVault(activity: FragmentActivity): Boolean {
        if (!isVaultLocked) return true
        val ok = BiometricAuth.authenticate(activity)
        if (ok) vaultUnlocked = true
        return ok
    }

    /** Re-lock the vault (app backgrounded, or a manual re-lock from the toolbar). */
    fun lockVault() {
        if (requireBiometric) vaultUnlocked = false
    }

    private companion object {
        const val STORAGE_KEY = "viewMode"
    }
}
