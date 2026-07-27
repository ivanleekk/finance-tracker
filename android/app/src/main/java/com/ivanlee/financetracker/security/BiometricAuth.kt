package com.ivanlee.financetracker.security

import android.content.Context
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * Fingerprint / face / device-PIN gate for the private vault. Android counterpart of
 * ios/FinanceTracker/Support/BiometricAuth.swift.
 *
 * [BIOMETRIC_WEAK or DEVICE_CREDENTIAL] is deliberate: the point is "prove you're the phone's
 * owner before private balances appear", and a device PIN does that. Requiring
 * BIOMETRIC_STRONG would lock out anyone whose sensor is unenrolled or unavailable, which is
 * the opposite of what this feature is for.
 */
object BiometricAuth {

    private const val ALLOWED =
        BiometricManager.Authenticators.BIOMETRIC_WEAK or
            BiometricManager.Authenticators.DEVICE_CREDENTIAL

    /**
     * Whether this device can actually authenticate the user right now.
     *
     * The vault **fails open**: a device with no biometrics and no screen lock returns false
     * here, which leaves the vault permanently unlocked. Nobody gets shut out of their own
     * data because their phone has no PIN.
     */
    fun isAvailable(context: Context): Boolean =
        BiometricManager.from(context).canAuthenticate(ALLOWED) == BiometricManager.BIOMETRIC_SUCCESS

    /**
     * Prompt, suspending until the user succeeds, fails, or dismisses.
     *
     * @return true only on a successful authentication.
     */
    suspend fun authenticate(
        activity: FragmentActivity,
        title: String = "Unlock your private data",
        subtitle: String = "Verify it's you to show private accounts and goals",
    ): Boolean = suspendCancellableCoroutine { continuation ->
        val executor = ContextCompat.getMainExecutor(activity)
        val prompt = BiometricPrompt(
            activity,
            executor,
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    if (continuation.isActive) continuation.resume(true)
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    // Covers cancel, lockout and "no credential enrolled" alike: none of them
                    // are an unlock, and a retry loop here would trap the user.
                    if (continuation.isActive) continuation.resume(false)
                }
                // onAuthenticationFailed (a bad finger) is intentionally not handled — the
                // prompt stays up and lets the user try again.
            },
        )

        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setSubtitle(subtitle)
            .setAllowedAuthenticators(ALLOWED)
            .build()

        runCatching { prompt.authenticate(info) }.onFailure {
            if (continuation.isActive) continuation.resume(false)
        }
        continuation.invokeOnCancellation { runCatching { prompt.cancelAuthentication() } }
    }
}
