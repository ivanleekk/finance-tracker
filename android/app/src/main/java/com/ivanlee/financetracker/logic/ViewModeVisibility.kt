package com.ivanlee.financetracker.logic

import com.ivanlee.financetracker.data.model.ViewMode

/**
 * The Private / Household / Blended visibility rules, as pure functions.
 *
 * Kept out of the ViewModel so they can be unit-tested without an Android runtime — this is
 * the logic that decides whether someone's private accounts appear on screen, which is
 * exactly the kind of rule that should not be verifiable only by launching an emulator.
 * `ViewModeViewModel` delegates to these.
 */
object ViewModeVisibility {

    /**
     * Solo households have nobody to hide things from, so everything stays blended regardless
     * of the persisted choice (matches web `effectiveViewMode`).
     */
    fun effectiveMode(mode: ViewMode, hasSecondPerson: Boolean): ViewMode =
        if (hasSecondPerson) mode else ViewMode.BLENDED

    /**
     * Should an item owned by [ownerUserId] (null = shared with the household) be shown?
     *
     * @param vaultLocked while the private vault is locked, private items are hidden in
     *   *every* mode until the user authenticates — the lock outranks the view mode.
     */
    fun isVisible(
        mode: ViewMode,
        hasSecondPerson: Boolean,
        vaultLocked: Boolean,
        ownerUserId: String?,
        currentUserId: String?,
    ): Boolean {
        val isPrivate = ownerUserId != null
        if (isPrivate && vaultLocked) return false
        val isMine = ownerUserId == currentUserId
        return when (effectiveMode(mode, hasSecondPerson)) {
            ViewMode.BLENDED -> !isPrivate || isMine
            ViewMode.HOUSEHOLD -> !isPrivate
            ViewMode.PRIVATE -> isPrivate && isMine
        }
    }

    /**
     * Whether the vault is actually locked right now.
     *
     * Fails **open**: a device that can't authenticate (no biometrics, no screen lock) never
     * counts as locked, so nobody is shut out of their own data by a setting they can't
     * satisfy.
     */
    fun isVaultLocked(
        requireBiometric: Boolean,
        biometricsAvailable: Boolean,
        vaultUnlocked: Boolean,
    ): Boolean = requireBiometric && biometricsAvailable && !vaultUnlocked
}
