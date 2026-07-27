package com.ivanlee.financetracker

import com.ivanlee.financetracker.data.model.ViewMode
import com.ivanlee.financetracker.logic.ViewModeVisibility
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Kotlin twin of iOS's `ViewModeStoreTests`. */
class ViewModeVisibilityTest {

    private val me = "me"
    private val partner = "partner"

    private fun visible(
        mode: ViewMode,
        owner: String?,
        hasSecondPerson: Boolean = true,
        vaultLocked: Boolean = false,
    ) = ViewModeVisibility.isVisible(mode, hasSecondPerson, vaultLocked, owner, me)

    // ---- Effective mode -----------------------------------------------------------------

    @Test
    fun `a solo household is always blended, whatever was persisted`() {
        assertEquals(ViewMode.BLENDED, ViewModeVisibility.effectiveMode(ViewMode.PRIVATE, hasSecondPerson = false))
        assertEquals(ViewMode.BLENDED, ViewModeVisibility.effectiveMode(ViewMode.HOUSEHOLD, hasSecondPerson = false))
    }

    @Test
    fun `the chosen mode takes effect once there is a second person`() {
        assertEquals(ViewMode.PRIVATE, ViewModeVisibility.effectiveMode(ViewMode.PRIVATE, hasSecondPerson = true))
    }

    @Test
    fun `filtering is a no-op on a solo household`() {
        // Persisted PRIVATE, but nobody to hide from: shared items must still show.
        assertTrue(visible(ViewMode.PRIVATE, owner = null, hasSecondPerson = false))
        assertTrue(visible(ViewMode.PRIVATE, owner = me, hasSecondPerson = false))
    }

    // ---- Blended ------------------------------------------------------------------------

    @Test
    fun `blended shows shared items and my own private ones`() {
        assertTrue(visible(ViewMode.BLENDED, owner = null))
        assertTrue(visible(ViewMode.BLENDED, owner = me))
    }

    @Test
    fun `blended hides another member's private items`() {
        // The server already filters these out; this is belt-and-braces on the client.
        assertFalse(visible(ViewMode.BLENDED, owner = partner))
    }

    // ---- Household ----------------------------------------------------------------------

    @Test
    fun `household shows only shared items - including mine`() {
        assertTrue(visible(ViewMode.HOUSEHOLD, owner = null))
        assertFalse(visible(ViewMode.HOUSEHOLD, owner = me))
        assertFalse(visible(ViewMode.HOUSEHOLD, owner = partner))
    }

    // ---- Private ------------------------------------------------------------------------

    @Test
    fun `private shows only my own private items`() {
        assertTrue(visible(ViewMode.PRIVATE, owner = me))
        assertFalse(visible(ViewMode.PRIVATE, owner = null))
        assertFalse(visible(ViewMode.PRIVATE, owner = partner))
    }

    // ---- Vault lock ---------------------------------------------------------------------

    @Test
    fun `a locked vault hides private items in every mode`() {
        ViewMode.entries.forEach { mode ->
            assertFalse(mode.name, visible(mode, owner = me, vaultLocked = true))
        }
    }

    @Test
    fun `a locked vault still shows shared items`() {
        assertTrue(visible(ViewMode.BLENDED, owner = null, vaultLocked = true))
        assertTrue(visible(ViewMode.HOUSEHOLD, owner = null, vaultLocked = true))
    }

    @Test
    fun `the vault fails open when the device cannot authenticate`() {
        // Setting on, but no biometrics/screen lock: never locked, so nobody is shut out.
        assertFalse(
            ViewModeVisibility.isVaultLocked(
                requireBiometric = true,
                biometricsAvailable = false,
                vaultUnlocked = false,
            )
        )
    }

    @Test
    fun `the vault is locked until unlocked when the device can authenticate`() {
        assertTrue(ViewModeVisibility.isVaultLocked(true, biometricsAvailable = true, vaultUnlocked = false))
        assertFalse(ViewModeVisibility.isVaultLocked(true, biometricsAvailable = true, vaultUnlocked = true))
    }

    @Test
    fun `the vault is never locked when the setting is off`() {
        assertFalse(ViewModeVisibility.isVaultLocked(false, biometricsAvailable = true, vaultUnlocked = false))
    }
}
