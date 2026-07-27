package com.ivanlee.financetracker.ui.goals

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.ivanlee.financetracker.data.model.PortfolioTimeseriesPoint
import com.ivanlee.financetracker.data.model.SubPortfolioResponse
import com.ivanlee.financetracker.data.model.TradeResponse
import com.ivanlee.financetracker.data.net.Api
import com.ivanlee.financetracker.logic.currency
import com.ivanlee.financetracker.logic.currencyWhole
import com.ivanlee.financetracker.logic.dueMonthYear
import com.ivanlee.financetracker.logic.mediumDate
import com.ivanlee.financetracker.logic.projectGoal
import com.ivanlee.financetracker.logic.valueHistory
import com.ivanlee.financetracker.state.SessionViewModel
import com.ivanlee.financetracker.ui.components.AdaptiveStatGrid
import com.ivanlee.financetracker.ui.components.ConfirmDialog
import com.ivanlee.financetracker.ui.components.DetailScaffold
import com.ivanlee.financetracker.ui.components.LineChart
import com.ivanlee.financetracker.ui.components.ProgressRing
import com.ivanlee.financetracker.ui.components.SectionCard
import com.ivanlee.financetracker.ui.components.StatTileData
import com.ivanlee.financetracker.ui.components.chartAccent
import com.ivanlee.financetracker.ui.dashboard.trimQuantity
import com.ivanlee.financetracker.ui.theme.negativeColor
import com.ivanlee.financetracker.ui.theme.positiveColor
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlin.math.abs
import com.ivanlee.financetracker.ui.components.cardListItemColors

/**
 * A goal, in full: completion ring, projected-completion chart against the target line, pace
 * vs required pace, and the contributions that moved it.
 *
 * A "goal" is a sub-portfolio with a target — there is no separate goal entity — so everything
 * here is derived from that sub-portfolio's snapshot history by [projectGoal], the shared port
 * of the web's `lib/goals.ts`.
 */
@Composable
fun GoalDetailScreen(
    subPortfolioId: String,
    sessionVm: SessionViewModel,
    onBack: () -> Unit,
    onEdit: (String) -> Unit,
    onAddFunds: (String) -> Unit,
    onDeleted: () -> Unit,
) {
    var sub by remember { mutableStateOf<SubPortfolioResponse?>(null) }
    var timeseries by remember { mutableStateOf<List<PortfolioTimeseriesPoint>>(emptyList()) }
    var trades by remember { mutableStateOf<List<TradeResponse>>(emptyList()) }
    var menuOpen by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    val baseCurrency = sessionVm.activeHousehold?.baseCurrency ?: "USD"

    LaunchedEffect(subPortfolioId, sessionVm.activeHousehold?.id) {
        val h = sessionVm.activeHousehold ?: return@LaunchedEffect
        try {
            coroutineScope {
                val subsReq = async {
                    Api.get<List<SubPortfolioResponse>>("/portfolio/subportfolios/household/${h.id}")
                }
                val tsReq = async {
                    Api.get<List<PortfolioTimeseriesPoint>>("/portfolio/snapshots/household/${h.id}/timeseries")
                }
                val tradesReq = async {
                    runCatching { Api.get<List<TradeResponse>>("/portfolio/trades/household/${h.id}") }
                        .getOrDefault(emptyList())
                }
                sub = subsReq.await().firstOrNull { it.id == subPortfolioId }
                timeseries = tsReq.await()
                trades = tradesReq.await()
            }
        } catch (e: Exception) {
            error = e.message ?: "Couldn't load this goal."
        }
    }

    val history = remember(timeseries, subPortfolioId) { valueHistory(timeseries, subPortfolioId) }
    val projection = remember(history, sub) {
        projectGoal(history, sub?.targetAmount, sub?.targetDate)
    }
    val recentContributions = trades
        .filter { it.subPortfolioId == subPortfolioId }
        .sortedByDescending { it.date }
        .take(6)

    DetailScaffold(
        title = sub?.name ?: "Goal",
        subtitle = sub?.targetDate?.let { "Target ${it.dueMonthYear()}" },
        onBack = onBack,
        error = error,
        onErrorShown = { error = null },
        actions = {
            IconButton(onClick = { menuOpen = true }) {
                Icon(Icons.Filled.MoreVert, contentDescription = "More")
            }
            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                DropdownMenuItem(
                    text = { Text("Add funds") },
                    onClick = { menuOpen = false; onAddFunds(subPortfolioId) },
                )
                DropdownMenuItem(
                    text = { Text("Edit goal") },
                    leadingIcon = { Icon(Icons.Filled.Edit, contentDescription = null) },
                    onClick = { menuOpen = false; onEdit(subPortfolioId) },
                )
                DropdownMenuItem(
                    text = { Text("Delete goal") },
                    leadingIcon = { Icon(Icons.Filled.Delete, contentDescription = null) },
                    onClick = { menuOpen = false; confirmDelete = true },
                )
            }
        },
    ) { padding ->
        LazyColumn(
            Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                SectionCard {
                    Column(
                        Modifier.fillMaxWidth(),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        ProgressRing(fraction = (projection.percentComplete / 100).toFloat()) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(
                                    "${projection.percentComplete.toInt()}%",
                                    style = MaterialTheme.typography.headlineMedium,
                                    fontWeight = FontWeight.Bold,
                                )
                                Text(
                                    "complete",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                        Text(
                            projection.currentValue.currency(baseCurrency),
                            style = MaterialTheme.typography.headlineSmall,
                            fontWeight = FontWeight.SemiBold,
                        )
                        sub?.targetAmount?.let { target ->
                            Text(
                                "of ${target.currencyWhole(baseCurrency)} target",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        projection.onTrack?.let { onTrack ->
                            Text(
                                if (onTrack) "On track" else "Behind pace",
                                style = MaterialTheme.typography.labelLarge,
                                color = if (onTrack) positiveColor() else negativeColor(),
                                textAlign = TextAlign.Center,
                            )
                        }
                    }
                }
            }

            item {
                SectionCard(title = "Projection") {
                    LineChart(
                        points = history,
                        lineColor = chartAccent(),
                        referenceValue = sub?.targetAmount,
                    )
                    AdaptiveStatGrid(
                        listOfNotNull(
                            StatTileData("Remaining", projection.remaining.currencyWhole(baseCurrency)),
                            StatTileData("Your pace", "${projection.monthlyPace.currencyWhole(baseCurrency)}/mo"),
                            projection.requiredPace?.let {
                                StatTileData("Needed pace", "${it.currencyWhole(baseCurrency)}/mo")
                            },
                            // Null when there's no target or no positive pace — an ETA needs both.
                            projection.etaLabel?.let { StatTileData("Est. completion", it) },
                            projection.monthsToTarget?.let {
                                StatTileData("Months to target", it.toInt().toString())
                            },
                            projection.shortfallAtTarget?.takeIf { it > 0 }?.let {
                                StatTileData(
                                    "Shortfall at target",
                                    it.currencyWhole(baseCurrency),
                                    signal = -1.0,
                                )
                            },
                            projection.etaVsTargetMonths?.let { months ->
                                StatTileData(
                                    if (months > 0) "Behind by" else "Ahead by",
                                    "${abs(months)} mo",
                                    signal = if (months > 0) -1.0 else 1.0,
                                )
                            },
                        )
                    )
                }
            }

            if (recentContributions.isNotEmpty()) {
                item {
                    SectionCard(title = "Recent contributions") {
                        recentContributions.forEachIndexed { index, trade ->
                            if (index > 0) HorizontalDivider()
                            ListItem(
                                colors = cardListItemColors(),
                                headlineContent = {
                                    Text(
                                        trade.description?.takeIf { it.isNotBlank() }
                                            ?: "${trade.type.label} ${trimQuantity(trade.quantity)}",
                                    )
                                },
                                supportingContent = { Text(trade.date.mediumDate()) },
                                trailingContent = {
                                    Text(
                                        (trade.quantity * trade.price).currency(trade.currency ?: baseCurrency),
                                        style = MaterialTheme.typography.bodyMedium,
                                    )
                                },
                            )
                        }
                    }
                }
            }
        }
    }

    if (confirmDelete) {
        ConfirmDialog(
            title = "Delete this goal?",
            message = "The sub-portfolio and its holdings go with it. Trades filed against it " +
                "will be removed from your performance history.",
            onConfirm = {
                scope.launch {
                    try {
                        Api.delete("/portfolio/subportfolios/$subPortfolioId")
                        onDeleted()
                    } catch (e: Exception) {
                        error = e.message ?: "Couldn't delete this goal."
                    }
                }
            },
            onDismiss = { confirmDelete = false },
        )
    }
}
