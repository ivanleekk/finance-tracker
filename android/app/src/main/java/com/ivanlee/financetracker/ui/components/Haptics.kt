package com.ivanlee.financetracker.ui.components

import android.os.Build
import android.view.HapticFeedbackConstants
import android.view.View
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalView

/**
 * Thin wrapper over [View.performHapticFeedback] rather than Compose's `LocalHapticFeedback`,
 * which only exposes LongPress and TextHandleMove — not enough vocabulary for a gesture that
 * needs a distinct "armed" tick and "committed" thump.
 *
 * The richer constants landed in API 30, so pre-30 devices fall back to the closest
 * long-standing constant instead of going silent.
 */
@Immutable
class Haptics(private val view: View) {

    /** A light tick: a threshold was crossed and the gesture is now armed. */
    fun tick() {
        val constant = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            HapticFeedbackConstants.GESTURE_START
        } else {
            HapticFeedbackConstants.KEYBOARD_TAP
        }
        view.performHapticFeedback(constant)
    }

    /** A firmer thump: the action actually fired. */
    fun confirm() {
        val constant = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            HapticFeedbackConstants.CONFIRM
        } else {
            HapticFeedbackConstants.LONG_PRESS
        }
        view.performHapticFeedback(constant)
    }

    /** A rejection buzz: the action was refused (e.g. a swipe that can't complete). */
    fun reject() {
        val constant = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            HapticFeedbackConstants.REJECT
        } else {
            HapticFeedbackConstants.LONG_PRESS
        }
        view.performHapticFeedback(constant)
    }
}

@Composable
fun rememberHaptics(): Haptics {
    val view = LocalView.current
    return remember(view) { Haptics(view) }
}
