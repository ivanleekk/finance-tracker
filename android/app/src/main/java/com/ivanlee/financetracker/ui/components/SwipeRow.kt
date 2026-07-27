package com.ivanlee.financetracker.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp

/**
 * A list row with swipe actions, matching the iOS app's swipe-to-delete / swipe-to-pause rows.
 *
 * The swipe never *completes* the dismissal: `confirmValueChange` fires the action and then
 * returns false, so the row springs back and stays in the list. That's the right shape here
 * because every destructive action goes through a confirmation dialog — a row that had
 * already animated away while the dialog was still open would be lying about what happened.
 *
 * @param onEndAction swiping right-to-left (the destructive slot, by Material convention).
 * @param onStartAction swiping left-to-right (a non-destructive action such as pause/resume).
 */
@Composable
fun SwipeActionRow(
    modifier: Modifier = Modifier,
    onEndAction: (() -> Unit)? = null,
    endIcon: ImageVector = Icons.Filled.Delete,
    endLabel: String = "Delete",
    endColor: Color = MaterialTheme.colorScheme.errorContainer,
    endIconColor: Color = MaterialTheme.colorScheme.onErrorContainer,
    onStartAction: (() -> Unit)? = null,
    startIcon: ImageVector? = null,
    startLabel: String = "",
    startColor: Color = MaterialTheme.colorScheme.secondaryContainer,
    startIconColor: Color = MaterialTheme.colorScheme.onSecondaryContainer,
    content: @Composable () -> Unit,
) {
    val haptics = rememberHaptics()
    val state = rememberSwipeToDismissBoxState(
        confirmValueChange = { value ->
            when (value) {
                SwipeToDismissBoxValue.EndToStart -> onEndAction?.let { haptics.confirm(); it() }
                SwipeToDismissBoxValue.StartToEnd -> onStartAction?.let { haptics.confirm(); it() }
                SwipeToDismissBoxValue.Settled -> Unit
            }
            false // never actually dismiss; the row snaps back
        },
    )

    SwipeToDismissBox(
        state = state,
        modifier = modifier,
        enableDismissFromEndToStart = onEndAction != null,
        enableDismissFromStartToEnd = onStartAction != null,
        backgroundContent = {
            val direction = state.dismissDirection
            val (color, icon, iconTint, alignment, label) = when (direction) {
                SwipeToDismissBoxValue.EndToStart ->
                    Quint(endColor, endIcon, endIconColor, Alignment.CenterEnd, endLabel)
                SwipeToDismissBoxValue.StartToEnd ->
                    Quint(startColor, startIcon, startIconColor, Alignment.CenterStart, startLabel)
                SwipeToDismissBoxValue.Settled ->
                    Quint(Color.Transparent, null, Color.Transparent, Alignment.Center, "")
            }
            Box(
                Modifier
                    .fillMaxSize()
                    .background(color)
                    .padding(horizontal = 20.dp),
                contentAlignment = alignment,
            ) {
                if (icon != null) {
                    androidx.compose.foundation.layout.Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Icon(icon, contentDescription = label, tint = iconTint)
                    }
                }
            }
        },
        content = { content() },
    )
}

/** Small carrier so the background branch above stays one readable `when`. */
private data class Quint(
    val color: Color,
    val icon: ImageVector?,
    val iconTint: Color,
    val alignment: Alignment,
    val label: String,
)
