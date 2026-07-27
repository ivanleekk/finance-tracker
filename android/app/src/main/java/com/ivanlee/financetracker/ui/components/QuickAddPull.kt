package com.ivanlee.financetracker.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddCircle
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Replaces pull-to-refresh: pulling a list down past a threshold and *releasing* opens the
 * Quick Add command sheet, with a distinct "＋ pull / release" indicator (not the refresh
 * spinner) and a haptic. Android port of ios/FinanceTracker/Views/Components/QuickAddPull.swift.
 *
 * This is a deliberate divergence from the Android pattern library, which puts
 * pull-to-refresh in this gesture slot. Every screen here reloads on resume and after any
 * Quick Add write, so a manual refresh would be near-dead weight; a one-gesture path to
 * "log something" is worth far more, and it's the gesture users of the iOS app already know.
 *
 * Two signals drive it, and neither is sufficient alone:
 *  - [NestedScrollConnection.onPostScroll] gives the unconsumed downward drag once the list
 *    is already at the top — i.e. the overscroll distance — but knows nothing about the
 *    finger, so momentum alone would trip it.
 *  - [NestedScrollConnection.onPreFling] fires exactly when the finger lifts and carries the
 *    lift-off velocity, which is what separates a deliberate held pull from a fast flick back
 *    to the top of a long list.
 *
 * The bar opens only when the pull passes [TRIGGER] **and** the finger lifts below
 * [FLICK_VELOCITY]. Both halves matter — without the velocity check a fast flick from the
 * top still opens it, which is what "too sensitive" means in practice.
 */
private val TRIGGER = 180.dp

/** Below this the indicator stays hidden — swallows the small bounce of a normal scroll. */
private val DEAD_ZONE = 36.dp

/** Easing back up this far past the threshold disarms, without flapping at the boundary. */
private val HYSTERESIS = 24.dp

/** Pixels/second at lift-off above which the gesture reads as a flick, not a pull. */
private const val FLICK_VELOCITY = 1800f

/**
 * @param enabled set false while the sheet is already open, so a pull underneath it can't
 *   queue a second one.
 * @param onTrigger invoked once, on release, when the pull qualifies.
 */
@Composable
fun rememberQuickAddPull(
    enabled: Boolean,
    onTrigger: () -> Unit,
): QuickAddPullState {
    val density = LocalDensity.current
    val haptics = rememberHaptics()
    val state = remember(density) {
        QuickAddPullState(
            triggerPx = with(density) { TRIGGER.toPx() },
            deadZonePx = with(density) { DEAD_ZONE.toPx() },
            hysteresisPx = with(density) { HYSTERESIS.toPx() },
        )
    }
    state.enabled = enabled
    state.haptics = haptics
    state.onTrigger = onTrigger
    return state
}

class QuickAddPullState(
    private val triggerPx: Float,
    private val deadZonePx: Float,
    private val hysteresisPx: Float,
) {
    internal var enabled = true
    internal var haptics: Haptics? = null
    internal var onTrigger: () -> Unit = {}

    var pull by mutableFloatStateOf(0f)
        private set
    private var armed by mutableStateOf(false)

    /** 0..1 across the live part of the pull (past the dead zone, up to the trigger). */
    val progress: Float
        get() = ((pull - deadZonePx) / (triggerPx - deadZonePx)).coerceIn(0f, 1f)

    val isArmed: Boolean get() = armed
    val isVisible: Boolean get() = pull > deadZonePx

    val connection: NestedScrollConnection = object : NestedScrollConnection {

        /**
         * Scrolling back up while a pull is open: eat the delta to unwind our own offset
         * first, so the list doesn't start scrolling until the indicator has retracted.
         */
        override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
            if (pull <= 0f || available.y >= 0f) return Offset.Zero
            val consumed = -min(pull, -available.y)
            applyPull(pull + consumed)
            return Offset(0f, consumed)
        }

        /** Unconsumed downward drag = the list is at the top and the finger is still pulling. */
        override fun onPostScroll(
            consumed: Offset,
            available: Offset,
            source: NestedScrollSource,
        ): Offset {
            if (source != NestedScrollSource.UserInput || available.y <= 0f) return Offset.Zero
            applyPull(pull + available.y)
            return Offset(0f, available.y)
        }

        /**
         * The finger lifted. Open the sheet only if the pull was held past the threshold
         * *and* the hand had settled — a fast downward flick from the top of the list also
         * crosses the threshold, but it's a scroll gesture, not a deliberate pull.
         */
        override suspend fun onPreFling(available: Velocity): Velocity {
            val wasArmed = armed
            armed = false
            pull = 0f
            if (wasArmed && enabled && abs(available.y) < FLICK_VELOCITY) {
                haptics?.confirm()
                onTrigger()
                // Swallow the fling so the list doesn't also bounce as the sheet appears.
                return available
            }
            return Velocity.Zero
        }
    }

    private fun applyPull(next: Float) {
        pull = next.coerceAtLeast(0f)
        if (!enabled) {
            armed = false
            return
        }
        if (pull >= triggerPx && !armed) {
            armed = true
            haptics?.tick()
        } else if (armed && pull < triggerPx - hysteresisPx) {
            armed = false
        }
    }
}

/**
 * The pull indicator. Place inside a [Box] that also holds the scrollable, aligned to the top.
 *
 * Its travel is damped to ~45% of the finger's so the label tracks the gesture without
 * marching down over the content.
 */
@Composable
fun BoxScope.QuickAddPullIndicator(state: QuickAddPullState) {
    val density = LocalDensity.current
    val maxOffset = with(density) { 72.dp.toPx() }
    AnimatedVisibility(
        visible = state.isVisible,
        enter = fadeIn(),
        exit = fadeOut(),
        modifier = Modifier.align(Alignment.TopCenter),
    ) {
        val ready = state.isArmed
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .offset { IntOffset(0, min(state.pull * 0.45f, maxOffset).roundToInt()) }
                .alpha(min(1f, state.progress * 1.4f))
                .scale(0.85f + 0.15f * state.progress)
                .background(
                    color = MaterialTheme.colorScheme.primary,
                    shape = MaterialTheme.shapes.extraLarge,
                )
                .padding(horizontal = 16.dp, vertical = 10.dp),
        ) {
            Icon(
                Icons.Filled.AddCircle,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onPrimary,
                modifier = Modifier
                    .rotate(state.progress * 180f)
                    .scale(if (ready) 1.15f else 1f),
            )
            Text(
                text = if (ready) "Release for Quick Add" else "Keep pulling for Quick Add",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onPrimary,
            )
        }
    }
}

/** Convenience: attach the gesture to a scrollable. */
fun Modifier.quickAddPull(state: QuickAddPullState): Modifier =
    this.nestedScroll(state.connection)
