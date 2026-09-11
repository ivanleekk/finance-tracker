package com.ivanlee.financetracker

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.viewmodel.compose.viewModel
import com.ivanlee.financetracker.state.QuickAddViewModel
import com.ivanlee.financetracker.state.ReferenceDataViewModel
import com.ivanlee.financetracker.state.SessionViewModel
import com.ivanlee.financetracker.state.ViewModeViewModel
import com.ivanlee.financetracker.ui.MainScaffold
import com.ivanlee.financetracker.ui.auth.LoginScreen
import com.ivanlee.financetracker.ui.auth.OnboardingScreen
import com.ivanlee.financetracker.ui.theme.WaypointTheme
import kotlinx.coroutines.launch

/**
 * A [FragmentActivity] rather than a plain ComponentActivity: androidx.biometric's
 * `BiometricPrompt` needs a FragmentActivity host, and the private-vault lock is not optional
 * plumbing.
 */
class MainActivity : FragmentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // Called before super so the window is edge-to-edge from the first frame; Compose then
        // draws behind the system bars and the scaffolds apply the insets themselves.
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent { WaypointRoot() }
    }
}

/**
 * Auth-phase switch: loading → login → guided onboarding → the app proper.
 *
 * The theme wraps everything, including the login screen, so the user's saved palette applies
 * the instant their record loads rather than after the first navigation.
 */
@Composable
fun WaypointRoot() {
    val sessionVm: SessionViewModel = viewModel()
    val viewModeVm: ViewModeViewModel = viewModel()
    val quickAddVm: QuickAddViewModel = viewModel()
    val referenceVm: ReferenceDataViewModel = viewModel()

    LaunchedEffect(Unit) { sessionVm.bootstrap() }
    // Coming back to the app is the natural moment the network has recovered.
    val scope = rememberCoroutineScope()
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        if (sessionVm.phase == SessionViewModel.Phase.UNREACHABLE) {
            scope.launch { sessionVm.retryBootstrap() }
        }
    }

    WaypointTheme(appTheme = sessionVm.theme, themeMode = sessionVm.themeMode) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            when {
                sessionVm.phase == SessionViewModel.Phase.LOADING ->
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator()
                    }

                sessionVm.phase == SessionViewModel.Phase.UNREACHABLE ->
                    UnreachableScreen(sessionVm)

                sessionVm.phase == SessionViewModel.Phase.UNAUTHENTICATED ->
                    LoginScreen(sessionVm)

                // A fresh signup has no household, so the guided setup owns the screen until
                // it finishes — see SessionViewModel.needsOnboarding.
                sessionVm.needsOnboarding -> OnboardingScreen(sessionVm)

                else -> MainScaffold(sessionVm, viewModeVm, quickAddVm, referenceVm)
            }
        }
    }
}

/**
 * Shown when launch couldn't load the session for a reason other than the server rejecting it.
 * The tokens are still valid, so this offers Retry rather than a password prompt; Log out stays
 * available so nobody is stuck on it. Twin of iOS's `UnreachableView`.
 */
@Composable
private fun UnreachableScreen(sessionVm: SessionViewModel) {
    val scope = rememberCoroutineScope()
    Column(
        Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Couldn't reach the server", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(8.dp))
        Text(
            sessionVm.bootstrapError ?: "Check your connection and try again.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(24.dp))
        Button(onClick = { scope.launch { sessionVm.retryBootstrap() } }) { Text("Retry") }
        TextButton(onClick = { sessionVm.logout() }) { Text("Log out") }
    }
}
