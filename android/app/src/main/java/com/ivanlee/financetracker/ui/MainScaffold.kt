package com.ivanlee.financetracker.ui

import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffold
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.ivanlee.financetracker.state.QuickAddViewModel
import com.ivanlee.financetracker.state.SessionViewModel
import com.ivanlee.financetracker.state.ViewModeViewModel
import com.ivanlee.financetracker.ui.components.rememberFragmentActivity
import com.ivanlee.financetracker.ui.quickadd.QuickAddSheet
import kotlinx.coroutines.launch

/**
 * The signed-in app shell.
 *
 * [NavigationSuiteScaffold] is the whole point of using it rather than a hand-rolled bottom
 * bar: it swaps a navigation **bar** (compact, <600dp — phones) for a navigation **rail**
 * (medium/expanded — tablets, unfolded foldables, desktop windows) off the current window
 * size class, which is exactly what the Android adaptive-layout guidance asks for. The same
 * five destinations either way, so nothing is hidden on a larger screen.
 */
@Composable
fun MainScaffold(
    sessionVm: SessionViewModel,
    viewModeVm: ViewModeViewModel,
    quickAddVm: QuickAddViewModel,
) {
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentDestination = backStackEntry?.destination
    val activity = rememberFragmentActivity()

    // Refresh the "does this household have a second person?" signal whenever the active
    // household changes — it gates the whole Private/Household/Blended switch.
    LaunchedEffect(sessionVm.activeHousehold?.id) {
        viewModeVm.refresh(sessionVm.activeHousehold?.id)
    }

    // Configure the vault from the user's setting on login / whenever the flag changes, then
    // prompt once so opening the app goes straight to the unlock.
    LaunchedEffect(sessionVm.user?.id, sessionVm.user?.requiresBiometricForVault) {
        viewModeVm.configureVault(sessionVm.user?.requiresBiometricForVault ?: false)
        if (viewModeVm.isVaultLocked && activity != null) viewModeVm.unlockVault(activity)
    }

    // Re-lock on a real background transition (ON_STOP), never on ON_PAUSE: the biometric
    // prompt itself pauses the activity, so locking there would fight the unlock it just
    // triggered and loop. Re-prompting is hung off ON_RESUME rather than off `isVaultLocked`
    // for the same reason — a prompt raised while the app is stopped just errors out unseen.
    val scope = rememberCoroutineScope()
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) { viewModeVm.lockVault() }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        if (viewModeVm.isVaultLocked && activity != null) {
            scope.launch { viewModeVm.unlockVault(activity) }
        }
    }

    NavigationSuiteScaffold(
        navigationSuiteItems = {
            TopLevelDestination.entries.forEach { destination ->
                val selected = currentDestination?.hierarchy?.any { it.route == destination.route } == true
                item(
                    selected = selected,
                    onClick = { navController.navigateToTopLevel(destination) },
                    icon = {
                        Icon(
                            imageVector = if (selected) destination.selectedIcon else destination.unselectedIcon,
                            contentDescription = destination.label,
                        )
                    },
                    label = { Text(destination.label) },
                )
            }
        },
    ) {
        WaypointNavHost(
            navController = navController,
            sessionVm = sessionVm,
            viewModeVm = viewModeVm,
            quickAddVm = quickAddVm,
        )
    }

    if (quickAddVm.isPresented) {
        val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
        ModalBottomSheet(
            onDismissRequest = {
                quickAddVm.dismiss()
                quickAddVm.requestReload()
            },
            sheetState = sheetState,
        ) {
            QuickAddSheet(
                sessionVm = sessionVm,
                onDone = {
                    quickAddVm.dismiss()
                    quickAddVm.requestReload()
                },
            )
        }
    }
}

/**
 * Standard top-level navigation: pop back to the graph's start, keep one copy on the stack,
 * and restore whatever drill-in state that tab had. Without `saveState`/`restoreState` a user
 * would lose their scroll position and any open detail every time they glanced at another tab.
 */
fun NavHostController.navigateToTopLevel(destination: TopLevelDestination) {
    navigate(destination.route) {
        popUpTo(graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}
