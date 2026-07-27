package com.ivanlee.financetracker.ui.components

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItemColors
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.ivanlee.financetracker.logic.currency
import com.ivanlee.financetracker.ui.theme.amountColor
import com.ivanlee.financetracker.ui.theme.negativeColor
import com.ivanlee.financetracker.ui.theme.positiveColor

/**
 * A titled surface for one block of content. Elevated cards are the M3 default for grouped
 * content on a scrolling surface, and using one shape everywhere is what keeps five very
 * different screens reading as one app.
 */
@Composable
fun SectionCard(
    title: String? = null,
    modifier: Modifier = Modifier,
    trailing: @Composable (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.elevatedCardColors(),
        elevation = CardDefaults.elevatedCardElevation(),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (title != null || trailing != null) {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (title != null) {
                        Text(
                            title,
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold,
                        )
                    } else {
                        Box {}
                    }
                    trailing?.invoke()
                }
            }
            content()
        }
    }
}

/**
 * One headline number with a caption — the building block of every stats grid on the
 * Dashboard, Portfolio and sub-portfolio screens.
 */
@Composable
fun StatTile(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    caption: String? = null,
    valueColor: androidx.compose.ui.graphics.Color = MaterialTheme.colorScheme.onSurface,
) {
    Card(
        modifier = modifier,
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceContainerHighest,
        ),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                label,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                value,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = valueColor,
            )
            if (caption != null) {
                Text(
                    caption,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

/**
 * One tile's worth of content for [AdaptiveStatGrid].
 *
 * @param signal drives the value colour: positive green, negative red, null neutral. Ratios
 *   like Sharpe pass null — a Sharpe of 0.4 is not "green".
 */
data class StatTileData(
    val label: String,
    val value: String,
    val caption: String? = null,
    val signal: Double? = null,
)

/**
 * A stat grid that reflows by available width: two columns on a phone, four on a tablet or
 * unfolded foldable — the adaptive-layout rule from the Android design guidance.
 *
 * Built from [BoxWithConstraints] + chunked rows rather than `LazyVerticalGrid` on purpose:
 * these grids live inside a `LazyColumn` item, and a lazy grid measured with unbounded height
 * throws. There are never more than a dozen tiles, so laziness buys nothing anyway.
 */
@Composable
fun AdaptiveStatGrid(
    tiles: List<StatTileData>,
    modifier: Modifier = Modifier,
    minTileWidth: androidx.compose.ui.unit.Dp = 150.dp,
) {
    if (tiles.isEmpty()) return
    BoxWithConstraints(modifier.fillMaxWidth()) {
        val spacing = 8.dp
        val columns = ((maxWidth + spacing) / (minTileWidth + spacing))
            .toInt().coerceIn(1, 4)
        Column(verticalArrangement = Arrangement.spacedBy(spacing)) {
            tiles.chunked(columns).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(spacing)) {
                    row.forEach { tile ->
                        StatTile(
                            label = tile.label,
                            value = tile.value,
                            caption = tile.caption,
                            valueColor = when {
                                tile.signal == null -> MaterialTheme.colorScheme.onSurface
                                tile.signal > 0 -> positiveColor()
                                tile.signal < 0 -> negativeColor()
                                else -> MaterialTheme.colorScheme.onSurface
                            },
                            modifier = Modifier.weight(1f),
                        )
                    }
                    // Keep the last row's tiles the same width as the rows above it.
                    repeat(columns - row.size) { Box(Modifier.weight(1f)) }
                }
            }
        }
    }
}

/**
 * Colours for a [ListItem] sitting inside a [SectionCard].
 *
 * `ListItem` paints its own `surface` container by default, which inside a card reads as a
 * lighter slab floating on the card rather than a row of it. Transparent lets the card's own
 * surface show through, so a card of rows looks like one grouped surface.
 */
@Composable
fun cardListItemColors(): ListItemColors =
    ListItemDefaults.colors(containerColor = Color.Transparent)

/** A money value, coloured green/red/neutral by sign. */
@Composable
fun MoneyText(
    amount: Double,
    currencyCode: String,
    modifier: Modifier = Modifier,
    style: androidx.compose.ui.text.TextStyle = MaterialTheme.typography.bodyLarge,
    signed: Boolean = false,
) {
    val text = amount.currency(currencyCode)
    Text(
        text = if (signed && amount > 0) "+$text" else text,
        style = style,
        fontWeight = FontWeight.Medium,
        color = amountColor(if (signed) amount else 0.0),
        modifier = modifier,
    )
}

/** The lock glyph that marks an item as private to the current user. */
@Composable
fun PrivateBadge(modifier: Modifier = Modifier) {
    Icon(
        Icons.Filled.Lock,
        contentDescription = "Private",
        modifier = modifier.size(14.dp),
        tint = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

/**
 * The "nothing here yet" state. Android's equivalent of iOS's `ContentUnavailableView`:
 * an icon, a sentence about why the screen is empty, and — critically — the action that
 * would fill it, so an empty screen is never a dead end.
 */
@Composable
fun EmptyState(
    icon: ImageVector,
    title: String,
    message: String? = null,
    modifier: Modifier = Modifier,
    action: @Composable (() -> Unit)? = null,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 32.dp, vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(
            icon,
            contentDescription = null,
            modifier = Modifier.size(48.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            title,
            style = MaterialTheme.typography.titleMedium,
            textAlign = TextAlign.Center,
        )
        if (message != null) {
            Text(
                message,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
        action?.invoke()
    }
}

/**
 * Shimmering placeholder bars, shown while a screen's data loads instead of a blank page or
 * a bare spinner — the layout that's coming is a better progress indicator than a circle.
 */
@Composable
fun LoadingSkeleton(
    modifier: Modifier = Modifier,
    rows: Int = 5,
) {
    val transition = rememberInfiniteTransition(label = "skeleton")
    val alpha by transition.animateFloat(
        initialValue = 0.35f,
        targetValue = 0.75f,
        animationSpec = infiniteRepeatable(tween(900), RepeatMode.Reverse),
        label = "skeletonAlpha",
    )
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        repeat(rows) { index ->
            Box(
                Modifier
                    .fillMaxWidth(if (index % 3 == 2) 0.6f else 1f)
                    .height(if (index == 0) 92.dp else 56.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .alpha(alpha)
                    .background(MaterialTheme.colorScheme.surfaceContainerHighest),
            )
        }
    }
}
