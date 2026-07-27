package com.ivanlee.financetracker

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.viewmodel.compose.viewModel
import com.ivanlee.financetracker.state.QuickAddViewModel
import com.ivanlee.financetracker.state.SessionViewModel
import com.ivanlee.financetracker.state.ViewModeViewModel
import com.ivanlee.financetracker.ui.MainScaffold
import com.ivanlee.financetracker.ui.auth.LoginScreen
import com.ivanlee.financetracker.ui.auth.OnboardingScreen
import com.ivanlee.financetracker.ui.theme.WaypointTheme

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

    LaunchedEffect(Unit) { sessionVm.bootstrap() }

    WaypointTheme(appTheme = sessionVm.theme, themeMode = sessionVm.themeMode) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            when {
                sessionVm.phase == SessionViewModel.Phase.LOADING ->
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator()
                    }

                sessionVm.phase == SessionViewModel.Phase.UNAUTHENTICATED ->
                    LoginScreen(sessionVm)

                // A fresh signup has no household, so the guided setup owns the screen until
                // it finishes — see SessionViewModel.needsOnboarding.
                sessionVm.needsOnboarding -> OnboardingScreen(sessionVm)

                else -> MainScaffold(sessionVm, viewModeVm, quickAddVm)
            }
        }
    }
}
