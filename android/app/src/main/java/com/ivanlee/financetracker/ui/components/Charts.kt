package com.ivanlee.financetracker.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import com.ivanlee.financetracker.logic.AllocationSlice
import com.ivanlee.financetracker.logic.GoalHistoryPoint
import com.ivanlee.financetracker.ui.theme.LocalAppTheme
import com.ivanlee.financetracker.ui.theme.luminanceIsDark

// Charts are drawn straight onto a Compose Canvas rather than pulled in from a charting
// library — same rule as iOS, which uses Apple's own Charts and no third-party packages.
// These are three fixed chart types over small, already-aggregated series; a dependency
// would cost more in size and API churn than it saves.

/**
 * Palette for allocation wedges, matched to the web's ALLOCATION_COLORS so the same portfolio
 * is the same colours on every client.
 */
val AllocationColors = listOf(
    Color(0xFF0EA5E9), // sky-500
    Color(0xFFD946EF), // fuchsia-500
    Color(0xFF10B981), // emerald-500
    Color(0xFFF59E0B), // amber-500
    Color(0xFF6366F1), // indigo-500
    Color(0xFFF43F5E), // rose-500
    Color(0xFF14B8A6), // teal-500
    Color(0xFF8B5CF6), // violet-500
)

/**
 * An equity / value curve.
 *
 * The y-axis is deliberately *not* zero-based: a net-worth line that spends its life between
 * 480k and 520k is a flat line against a zero axis, and the whole point of the chart is the
 * shape of the movement. A little headroom is padded in so the line never touches the edges.
 */
@Composable
fun LineChart(
    points: List<GoalHistoryPoint>,
    modifier: Modifier = Modifier,
    height: androidx.compose.ui.unit.Dp = 200.dp,
    lineColor: Color = MaterialTheme.colorScheme.primary,
    /** Draws a dashed horizontal rule, e.g. a goal's target amount. */
    referenceValue: Double? = null,
) {
    val gridColor = MaterialTheme.colorScheme.outlineVariant
    val referenceColor = MaterialTheme.colorScheme.tertiary
    if (points.size < 2) {
        Box(modifier.fillMaxWidth().height(height), contentAlignment = Alignment.Center) {
            Text(
                "Not enough history yet",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        return
    }

    Canvas(modifier.fillMaxWidth().height(height)) {
        val values = points.map { it.value }
        var minValue = values.min()
        var maxValue = values.max()
        referenceValue?.let {
            if (it.isFinite()) {
                minValue = minOf(minValue, it)
                maxValue = maxOf(maxValue, it)
            }
        }
        // A dead-flat series would divide by zero; give it a nominal band instead.
        if (maxValue - minValue < 1e-9) {
            maxValue += 1.0
            minValue -= 1.0
        }
        val pad = (maxValue - minValue) * 0.08
        minValue -= pad
        maxValue += pad
        val span = maxValue - minValue

        fun xFor(index: Int): Float = size.width * index / (points.size - 1).toFloat()
        fun yFor(value: Double): Float =
            (size.height * (1 - (value - minValue) / span)).toFloat()

        // Horizontal guides at quarter intervals — enough to read level, not enough to fight
        // the line for attention.
        repeat(3) { i ->
            val y = size.height * (i + 1) / 4f
            drawLine(gridColor, Offset(0f, y), Offset(size.width, y), strokeWidth = 1f)
        }

        val line = Path().apply {
            moveTo(xFor(0), yFor(values[0]))
            for (i in 1 until points.size) lineTo(xFor(i), yFor(values[i]))
        }
        val fill = Path().apply {
            addPath(line)
            lineTo(size.width, size.height)
            lineTo(0f, size.height)
            close()
        }
        drawPath(
            fill,
            Brush.verticalGradient(
                listOf(lineColor.copy(alpha = 0.28f), lineColor.copy(alpha = 0f)),
            ),
        )
        drawPath(line, lineColor, style = Stroke(width = 2.5.dp.toPx()))

        referenceValue?.takeIf { it.isFinite() }?.let { target ->
            val y = yFor(target)
            drawLine(
                referenceColor,
                Offset(0f, y),
                Offset(size.width, y),
                strokeWidth = 1.5.dp.toPx(),
                pathEffect = PathEffect.dashPathEffect(floatArrayOf(12f, 10f)),
            )
        }
    }
}

/**
 * Two-band stacked area chart — the Dashboard's net worth split into cash and investments.
 *
 * Stacked rather than overlaid because the two bands are components of one total: the outer
 * edge of the stack *is* net worth, which is the number the screen is about. The baseline is
 * the zero line (unlike [LineChart], which floats its axis) precisely because the areas have
 * to add up to something meaningful.
 *
 * **Negative bands stack downward.** A household with a mortgage has deeply negative cash and
 * positive investments; naively stacking `low` then `low + high` would draw the investment
 * band starting from far below zero, which reads as a wild swing that never happened. So each
 * band grows from the zero line in its own direction, and positives and negatives accumulate
 * separately — the standard treatment for a stacked chart with mixed signs.
 *
 * @param series (date, cash, investments) — already sorted ascending.
 */
@Composable
fun StackedAreaChart(
    series: List<Triple<java.time.Instant, Double, Double>>,
    lowerColor: Color,
    upperColor: Color,
    modifier: Modifier = Modifier,
    height: androidx.compose.ui.unit.Dp = 190.dp,
) {
    if (series.size < 2) return
    val zeroLineColor = MaterialTheme.colorScheme.outlineVariant
    Canvas(modifier.fillMaxWidth().height(height)) {
        // Per-date band extents, each measured from zero in its own direction.
        data class Bands(val cashTop: Double, val invBase: Double, val invTop: Double)

        val bands = series.map { (_, cash, investments) ->
            // Investments start where the same-signed part of the stack already reached.
            val base = if ((investments >= 0) == (cash >= 0)) cash else 0.0
            Bands(cashTop = cash, invBase = base, invTop = base + investments)
        }

        val extremes = bands.flatMap { listOf(it.cashTop, it.invBase, it.invTop, 0.0) }
        var minValue = extremes.min()
        var maxValue = extremes.max()
        if (maxValue - minValue < 1e-9) {
            maxValue += 1.0
            minValue -= 1.0
        }
        val pad = (maxValue - minValue) * 0.06
        minValue -= pad
        maxValue += pad
        val span = maxValue - minValue

        fun xFor(index: Int) = size.width * index / (series.size - 1).toFloat()
        fun yFor(value: Double) = (size.height * (1 - (value - minValue) / span)).toFloat()

        fun band(base: (Int) -> Double, top: (Int) -> Double) = Path().apply {
            moveTo(xFor(0), yFor(base(0)))
            series.indices.forEach { i -> lineTo(xFor(i), yFor(top(i))) }
            for (i in series.indices.reversed()) lineTo(xFor(i), yFor(base(i)))
            close()
        }

        drawPath(band({ 0.0 }, { bands[it].cashTop }), lowerColor.copy(alpha = 0.75f))
        drawPath(band({ bands[it].invBase }, { bands[it].invTop }), upperColor.copy(alpha = 0.75f))

        // The zero line matters when a band is negative — without it the chart gives no clue
        // which side of solvency the household is on.
        val zeroY = yFor(0.0)
        drawLine(zeroLineColor, Offset(0f, zeroY), Offset(size.width, zeroY), strokeWidth = 1.5f)
    }
}

/** A simple signed bar chart (income/expense by month, cash-flow by category). */
@Composable
fun BarChart(
    values: List<Pair<String, Double>>,
    modifier: Modifier = Modifier,
    height: androidx.compose.ui.unit.Dp = 160.dp,
    positiveColor: Color = MaterialTheme.colorScheme.primary,
    negativeColor: Color = MaterialTheme.colorScheme.error,
) {
    if (values.isEmpty()) return
    val axisColor = MaterialTheme.colorScheme.outlineVariant
    Column(modifier.fillMaxWidth()) {
        Canvas(Modifier.fillMaxWidth().height(height)) {
            val maxMagnitude = values.maxOf { kotlin.math.abs(it.second) }.takeIf { it > 0 } ?: 1.0
            val slot = size.width / values.size
            val barWidth = slot * 0.6f
            val zeroY = size.height / 2f
            drawLine(axisColor, Offset(0f, zeroY), Offset(size.width, zeroY), strokeWidth = 1f)
            values.forEachIndexed { index, (_, value) ->
                val magnitude = (kotlin.math.abs(value) / maxMagnitude).toFloat() * (size.height / 2f)
                val left = slot * index + (slot - barWidth) / 2f
                val top = if (value >= 0) zeroY - magnitude else zeroY
                drawRect(
                    color = if (value >= 0) positiveColor else negativeColor,
                    topLeft = Offset(left, top),
                    size = Size(barWidth, magnitude.coerceAtLeast(1f)),
                )
            }
        }
        Row(Modifier.fillMaxWidth().padding(top = 4.dp)) {
            values.forEach { (label, _) ->
                Text(
                    label,
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                    maxLines = 1,
                )
            }
        }
    }
}

/** Allocation donut with the total in the hole, plus a legend. */
@Composable
fun DonutChart(
    slices: List<AllocationSlice>,
    centerLabel: String,
    centerCaption: String,
    modifier: Modifier = Modifier,
    diameter: androidx.compose.ui.unit.Dp = 180.dp,
) {
    if (slices.isEmpty()) return
    Row(
        modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(diameter), contentAlignment = Alignment.Center) {
            Canvas(Modifier.fillMaxSize()) { drawDonut(slices) }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(centerLabel, style = MaterialTheme.typography.titleMedium)
                Text(
                    centerCaption,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Column(
            Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            slices.take(6).forEachIndexed { index, slice ->
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Box(
                        Modifier
                            .size(10.dp)
                            .clip(CircleShape)
                            .background(AllocationColors[index % AllocationColors.size]),
                    )
                    Text(
                        slice.label,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.weight(1f),
                        maxLines = 1,
                    )
                    Text(
                        "${slice.pct.toInt()}%",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

private fun DrawScope.drawDonut(slices: List<AllocationSlice>) {
    val total = slices.sumOf { it.pct }.takeIf { it > 0 } ?: return
    val strokeWidth = size.minDimension * 0.22f
    val inset = strokeWidth / 2
    var startAngle = -90f
    slices.forEachIndexed { index, slice ->
        val sweep = (slice.pct / total * 360.0).toFloat()
        drawArc(
            color = AllocationColors[index % AllocationColors.size],
            startAngle = startAngle,
            sweepAngle = sweep,
            useCenter = false,
            topLeft = Offset(inset, inset),
            size = Size(size.width - strokeWidth, size.height - strokeWidth),
            style = Stroke(width = strokeWidth),
        )
        startAngle += sweep
    }
}

/**
 * A progress ring, used for goal completion. Kept separate from the donut because it wants
 * a track behind it — an empty goal should read as "0% of a ring", not as nothing drawn.
 */
@Composable
fun ProgressRing(
    fraction: Float,
    modifier: Modifier = Modifier,
    diameter: androidx.compose.ui.unit.Dp = 132.dp,
    content: @Composable () -> Unit,
) {
    val track = MaterialTheme.colorScheme.surfaceContainerHighest
    val progress = MaterialTheme.colorScheme.primary
    Box(modifier.size(diameter), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val strokeWidth = size.minDimension * 0.12f
            val inset = strokeWidth / 2
            val arcSize = Size(size.width - strokeWidth, size.height - strokeWidth)
            drawArc(
                color = track,
                startAngle = -90f,
                sweepAngle = 360f,
                useCenter = false,
                topLeft = Offset(inset, inset),
                size = arcSize,
                style = Stroke(width = strokeWidth),
            )
            drawArc(
                color = progress,
                startAngle = -90f,
                sweepAngle = 360f * fraction.coerceIn(0f, 1f),
                useCenter = false,
                topLeft = Offset(inset, inset),
                size = arcSize,
                style = Stroke(width = strokeWidth, cap = androidx.compose.ui.graphics.StrokeCap.Round),
            )
        }
        content()
    }
}

/**
 * The accent colour for a chart drawn against the current theme — shade 600 in light,
 * 400 in dark, same rule as everywhere else.
 */
@Composable
fun chartAccent(): Color {
    val theme = LocalAppTheme.current
    return theme.primary.accent(MaterialTheme.colorScheme.background.luminanceIsDark())
}
