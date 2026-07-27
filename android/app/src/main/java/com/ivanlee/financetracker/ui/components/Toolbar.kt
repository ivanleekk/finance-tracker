package com.ivanlee.financetracker.ui.components

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Layers
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.LockOpen
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.fragment.app.FragmentActivity
import com.ivanlee.financetracker.data.model.ViewMode
import com.ivanlee.financetracker.state.ViewModeViewModel
import kotlinx.coroutines.launch

/** Finds the hosting [FragmentActivity] from a composable — needed to raise a biometric prompt. */
@Composable
fun rememberFragmentActivity(): FragmentActivity? {
    val context = LocalContext.current
    return remember(context) {
        var candidate = context
        while (candidate is android.content.ContextWrapper) {
            if (candidate is FragmentActivity) return@remember candidate
            candidate = candidate.baseContext
        }
        null
    }
}

/**
 * The Private / Household / Blended switch.
 *
 * Renders only once the active household has a second person — until then there is nobody to
 * hide anything from, and a three-way privacy control on a solo household is just a confusing
 * no-op. Mirrors iOS's ViewModeSwitcher and the web ViewModeContext.
 */
@Composable
fun ViewModeSwitcher(viewModeVm: ViewModeViewModel) {
    if (!viewModeVm.hasSecondPerson) return
    var expanded by remember { mutableStateOf(false) }
    val current = viewModeVm.effectiveMode
    IconButton(onClick = { expanded = true }) {
        Icon(
            imageVector = when (current) {
                ViewMode.BLENDED -> Icons.Filled.Layers
                ViewMode.HOUSEHOLD -> Icons.Filled.Group
                ViewMode.PRIVATE -> Icons.Filled.Lock
            },
            contentDescription = "View mode: ${current.label}",
        )
    }
    DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
        ViewMode.entries.forEach { mode ->
            DropdownMenuItem(
                text = { Text(mode.label) },
                leadingIcon = {
                    Icon(
                        imageVector = when (mode) {
                            ViewMode.BLENDED -> Icons.Filled.Layers
                            ViewMode.HOUSEHOLD -> Icons.Filled.Group
                            ViewMode.PRIVATE -> Icons.Filled.Lock
                        },
                        contentDescription = null,
                    )
                },
                trailingIcon = if (mode == current) {
                    { Text("✓") }
                } else null,
                onClick = {
                    viewModeVm.chooseViewMode(mode)
                    expanded = false
                },
            )
        }
    }
}

/**
 * Lock / unlock control for the private vault. Shown only when the feature is actually active
 * on this device (setting on **and** the device can authenticate) — a lock icon that can't
 * lock anything is worse than no icon.
 */
@Composable
fun VaultLockButton(viewModeVm: ViewModeViewModel) {
    if (!viewModeVm.vaultLockActive) return
    val activity = rememberFragmentActivity()
    val scope = rememberCoroutineScope()
    val locked = viewModeVm.isVaultLocked
    IconButton(
        onClick = {
            if (locked) {
                activity?.let { scope.launch { viewModeVm.unlockVault(it) } }
            } else {
                viewModeVm.lockVault()
            }
        },
    ) {
        Icon(
            imageVector = if (locked) Icons.Filled.Lock else Icons.Filled.LockOpen,
            contentDescription = if (locked) "Unlock private data" else "Lock private data",
        )
    }
}

/** The standard back affordance for a detail screen's top app bar. */
@Composable
fun BackButton(onBack: () -> Unit) {
    IconButton(onClick = onBack) {
        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
    }
}

/**
 * Auto-prompts for the vault unlock once, when a screen that shows private data appears with
 * the vault locked. Mirrors iOS's prompt-on-launch behaviour.
 */
@Composable
fun AutoUnlockVault(viewModeVm: ViewModeViewModel) {
    val activity = rememberFragmentActivity()
    LaunchedEffect(viewModeVm.isVaultLocked, activity) {
        if (viewModeVm.isVaultLocked && activity != null) {
            viewModeVm.unlockVault(activity)
        }
    }
}
