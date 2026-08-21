package com.ivanlee.financetracker.ui.portfolio

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.PieChart
import androidx.compose.material3.AssistChip
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ivanlee.financetracker.data.model.AssetResponse
import com.ivanlee.financetracker.data.model.PerformanceMetrics
import com.ivanlee.financetracker.data.model.PortfolioMetricsResponse
import com.ivanlee.financetracker.data.model.PortfolioSnapshotResponse
import com.ivanlee.financetracker.data.model.PortfolioTimeseriesPoint
import com.ivanlee.financetracker.data.model.SubPortfolioResponse
import com.ivanlee.financetracker.data.net.Api
import com.ivanlee.financetracker.logic.GrowthRange
import com.ivanlee.financetracker.logic.allocationSlices
import com.ivanlee.financetracker.logic.compactCurrency
import com.ivanlee.financetracker.logic.currency
import com.ivanlee.financetracker.logic.dueMonthYear
import com.ivanlee.financetracker.logic.equityCurve
import com.ivanlee.financetracker.logic.fxExposure
import com.ivanlee.financetracker.logic.periodChange
import com.ivanlee.financetracker.logic.signedPercent
import com.ivanlee.financetracker.state.QuickAddViewModel
import com.ivanlee.financetracker.state.SessionViewModel
import com.ivanlee.financetracker.state.ViewModeViewModel
import com.ivanlee.financetracker.ui.components.AdaptiveStatGrid
import com.ivanlee.financetracker.ui.components.DonutChart
import com.ivanlee.financetracker.ui.components.EmptyState
import com.ivanlee.financetracker.ui.components.LineChart
import com.ivanlee.financetracker.ui.components.MainScreenScaffold
import com.ivanlee.financetracker.ui.components.PrivateBadge
import com.ivanlee.financetracker.ui.components.SectionCard
import com.ivanlee.financetracker.ui.components.SegmentedChoice
import com.ivanlee.financetracker.ui.components.StatTileData
import com.ivanlee.financetracker.ui.components.chartAccent
import com.ivanlee.financetracker.ui.dashboard.HoldingRow
import com.ivanlee.financetracker.ui.dashboard.percentString
import com.ivanlee.financetracker.ui.dashboard.ratioString
import com.ivanlee.financetracker.ui.theme.amountColor
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import com.ivanlee.financetracker.ui.components.cardListItemColors

/**
 * The Portfolio tab — the household-wide view: growth curve, allocation, the full performance
 * grid, holdings, and one row per sub-portfolio (with goal progress where a target is set).
 *
 * There is no "Overall" segment anywhere: this screen *is* the overall view, and scoping to
 * one sub-portfolio is a drill-in ([SubPortfolioDetailScreen]) rather than a tab strip. The
 * web re-scopes its whole page from a tab bar, which a phone-width strip can't do.
 */
@Composable
fun PortfolioScreen(
    sessionVm: SessionViewModel,
    viewModeVm: ViewModeViewModel,
    quickAddVm: QuickAddViewModel,
    onOpenSubPortfolio: (String) -> Unit,
    onOpenGoal: (String) -> Unit,
    onNewGoal: () -> Unit,
    onOpenTrades: () -> Unit,
    onOpenDividends: () -> Unit,
    onNewTrade: () -> Unit,
) {
    var snapshots by remember { mutableStateOf<List<PortfolioSnapshotResponse>>(emptyList()) }
    var timeseries by remember { mutableStateOf<List<PortfolioTimeseriesPoint>>(emptyList()) }
    var subPortfolios by remember { mutableStateOf<List<SubPortfolioResponse>>(emptyList()) }
    var assets by remember { mutableStateOf<List<AssetResponse>>(emptyList()) }
    var metrics by remember { mutableStateOf<PortfolioMetricsResponse?>(null) }
    var range by remember { mutableStateOf(GrowthRange.SIX_MONTHS) }
    var isLoading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var addMenuOpen by remember { mutableStateOf(false) }
    // Fixing an asset created with the wrong ticker or currency. Reloads on save
    // because the server replays this asset's snapshots.
    var editingAsset by remember { mutableStateOf<AssetResponse?>(null) }
    val scope = rememberCoroutineScope()

    val userId = sessionVm.user?.id
    val baseCurrency = sessionVm.activeHousehold?.baseCurrency ?: "USD"

    suspend fun load() {
        val h = sessionVm.activeHousehold ?: return
        isLoading = true
        try {
            coroutineScope {
                val snapshotsReq = async {
                    Api.get<List<PortfolioSnapshotResponse>>("/portfolio/snapshots/household/${h.id}?latest_only=true")
                }
                val tsReq = async {
                    Api.get<List<PortfolioTimeseriesPoint>>("/portfolio/snapshots/household/${h.id}/timeseries")
                }
                val subsReq = async { Api.get<List<SubPortfolioResponse>>("/portfolio/subportfolios/household/${h.id}") }
                val assetsReq = async { Api.get<List<AssetResponse>>("/portfolio/assets") }
                val metricsReq = async {
                    runCatching { Api.get<PortfolioMetricsResponse>("/portfolio/household/${h.id}/metrics") }.getOrNull()
                }
                snapshots = snapshotsReq.await()
                timeseries = tsReq.await()
                subPortfolios = subsReq.await()
                assets = assetsReq.await()
                metrics = metricsReq.await()
            }
        } catch (e: Exception) {
            error = e.message ?: "Couldn't load your portfolio."
        } finally {
            isLoading = false
        }
    }

    val visibleSubs = subPortfolios.filter { viewModeVm.isVisible(it.ownerUserId, userId) }
    val visibleSubIds = visibleSubs.map { it.id }.toSet()
    val visibleSnapshots = snapshots.filter { it.subPortfolioId in visibleSubIds }
    val visibleTimeseries = timeseries.filter { it.subPortfolioId in visibleSubIds }
    val assetsById = assets.associateBy { it.id }

    val latestDate = visibleSnapshots.maxOfOrNull { it.date }
    val holdings = visibleSnapshots
        .filter { it.date == latestDate && it.quantity > 0 }
        .sortedByDescending { it.currentValueHomeCurrency }
    val totalValue = holdings.sumOf { it.currentValueHomeCurrency }
    val costBasis = holdings.sumOf { it.averageCostBasisHomeCurrency * it.quantity }

    val curve = remember(visibleTimeseries, range) { equityCurve(visibleTimeseries, range = range) }
    val change = remember(curve) { periodChange(curve) }
    val slices = remember(holdings, assetsById) { allocationSlices(holdings, assetsById) }
    val fx = remember(holdings, assetsById) { fxExposure(holdings, assetsById, baseCurrency) }

    // Sub-portfolio totals from the same latest snapshot, so a row and the header agree.
    val valueBySub = holdings.groupBy { it.subPortfolioId }
        .mapValues { entry -> entry.value.sumOf { it.currentValueHomeCurrency } }

    MainScreenScaffold(
        title = "Portfolio",
        viewModeVm = viewModeVm,
        quickAddVm = quickAddVm,
        isLoading = isLoading,
        showSkeleton = isLoading && snapshots.isEmpty(),
        error = error,
        onErrorShown = { error = null },
        onReload = { load() },
        floatingActionButton = {
            Column(horizontalAlignment = androidx.compose.ui.Alignment.End) {
                DropdownMenu(expanded = addMenuOpen, onDismissRequest = { addMenuOpen = false }) {
                    DropdownMenuItem(
                        text = { Text("Record a trade") },
                        onClick = { addMenuOpen = false; onNewTrade() },
                    )
                    DropdownMenuItem(
                        text = { Text("New goal / sub-portfolio") },
                        onClick = { addMenuOpen = false; onNewGoal() },
                    )
                }
                ExtendedFloatingActionButton(
                    onClick = { addMenuOpen = true },
                    icon = { Icon(Icons.Filled.Add, contentDescription = null) },
                    text = { Text("Add") },
                )
            }
        },
    ) {
        item {
            SectionCard(title = "Growth") {
                Text(
                    totalValue.currency(baseCurrency),
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                )
                change?.let { delta ->
                    Text(
                        buildString {
                            append(delta.delta.compactCurrency(baseCurrency))
                            // A percentage is withheld when the window opened on a near-zero
                            // base: going from $42 to $13,104 is funding, not a +31,100% return.
                            delta.fraction?.let { append("  (${it.signedPercent()})") }
                            append("  ${range.label}")
                        },
                        style = MaterialTheme.typography.bodyMedium,
                        color = amountColor(delta.delta),
                    )
                }
                LineChart(points = curve, lineColor = chartAccent())
                SegmentedChoice(
                    options = GrowthRange.entries,
                    selected = range,
                    optionLabel = { it.label },
                    onSelect = { range = it },
                )
            }
        }

        if (slices.isNotEmpty()) {
            item {
                SectionCard(title = "Allocation") {
                    DonutChart(
                        slices = slices,
                        centerLabel = totalValue.compactCurrency(baseCurrency),
                        centerCaption = "total",
                    )
                    if (fx.size > 1) {
                        Row(
                            Modifier.horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            fx.forEach { slice ->
                                AssistChip(
                                    onClick = {},
                                    label = { Text("${slice.currency} ${slice.pct.toInt()}%") },
                                )
                            }
                        }
                    }
                }
            }
        }

        if (holdings.isNotEmpty()) {
            item {
                SectionCard(title = "Performance") {
                    PerformanceTileGrid(metrics?.overallMetrics, totalValue - costBasis, baseCurrency)
                }
            }
        }

        item {
            SectionCard(
                title = "Sub-portfolios",
                trailing = { TextButton(onClick = onOpenTrades) { Text("Trades") } },
            ) {
                if (visibleSubs.isEmpty() && !isLoading) {
                    EmptyState(
                        icon = Icons.Filled.PieChart,
                        title = "No sub-portfolios yet",
                        message = "A goal is just a sub-portfolio with a target. Add one to get started.",
                    )
                }
                visibleSubs.forEachIndexed { index, sub ->
                    if (index > 0) HorizontalDivider()
                    SubPortfolioRow(
                        sub = sub,
                        value = valueBySub[sub.id] ?: 0.0,
                        currencyCode = baseCurrency,
                        onClick = { onOpenSubPortfolio(sub.id) },
                        onOpenGoal = { onOpenGoal(sub.id) },
                    )
                }
            }
        }

        if (holdings.isNotEmpty()) {
            item {
                SectionCard(
                    title = "Holdings",
                    trailing = { TextButton(onClick = onOpenDividends) { Text("Dividends") } },
                ) {
                    holdings.forEach { holding ->
                        val asset = assetsById[holding.assetId]
                        HoldingRow(
                            ticker = asset?.ticker ?: "—",
                            name = asset?.name,
                            quantity = holding.quantity,
                            value = holding.currentValueHomeCurrency,
                            currencyCode = baseCurrency,
                            // Cash and earmarked-account rows are derived from what they
                            // stand for, so they get no edit affordance.
                            onEdit = asset?.takeIf { !it.isPseudoAsset }?.let { { editingAsset = it } },
                        )
                    }
                }
            }
        }
    }

    editingAsset?.let { asset ->
        AssetEditDialog(
            asset = asset,
            onDismiss = { editingAsset = null },
            onSaved = { scope.launch { load() } },
        )
    }
}

/**
 * The full performance grid, shared with the sub-portfolio detail screen so both read the
 * same tiles off whichever [PerformanceMetrics] they were handed.
 *
 * Treynor, alpha and beta are null when there's no benchmark data — they render as "—"
 * rather than 0, because "no benchmark" and "zero alpha" are very different claims.
 */
@Composable
fun PerformanceTileGrid(
    metrics: PerformanceMetrics?,
    unrealizedGain: Double,
    currencyCode: String,
) {
    AdaptiveStatGrid(
        listOf(
            StatTileData("Unrealized P&L", unrealizedGain.currency(currencyCode), signal = unrealizedGain),
            StatTileData("Div Yield", percentString(metrics?.dividendYield)),
            StatTileData("Overall Return", percentString(metrics?.simpleReturn), signal = metrics?.simpleReturn),
            StatTileData("TWR (Ann.)", percentString(metrics?.timeWeightedReturn), signal = metrics?.timeWeightedReturn),
            StatTileData("IRR / MWR", percentString(metrics?.moneyWeightedReturn), signal = metrics?.moneyWeightedReturn),
            StatTileData("Sharpe", ratioString(metrics?.sharpeRatio)),
            StatTileData("Sortino", ratioString(metrics?.sortinoRatio)),
            StatTileData(
                "Treynor",
                ratioString(metrics?.treynorRatio),
                caption = metrics?.beta?.let { "β ${ratioString(it)}" },
            ),
            StatTileData("Jensen's α", percentString(metrics?.alpha), caption = "vs SPY", signal = metrics?.alpha),
            StatTileData("Volatility", percentString(metrics?.volatility)),
        )
    )
}

@Composable
private fun SubPortfolioRow(
    sub: SubPortfolioResponse,
    value: Double,
    currencyCode: String,
    onClick: () -> Unit,
    onOpenGoal: () -> Unit,
) {
    val target = sub.targetAmount?.takeIf { it.isFinite() && it > 0 }
    Column(Modifier.fillMaxWidth().clickable(onClick = onClick)) {
        ListItem(
            colors = cardListItemColors(),
            headlineContent = {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                ) {
                    Text(sub.name)
                    if (sub.ownerUserId != null) PrivateBadge()
                }
            },
            supportingContent = sub.riskProfile?.let { { Text(it.replaceFirstChar(Char::titlecase)) } },
            trailingContent = {
                Text(
                    value.currency(currencyCode),
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium,
                )
            },
        )
        if (target != null) {
            // A sub-portfolio with a target *is* a goal — show its progress inline and give a
            // way through to the full goal screen, rather than making goals a separate tab.
            Column(
                Modifier
                    .fillMaxWidth()
                    .clickable(onClick = onOpenGoal)
                    .padding(start = 16.dp, end = 16.dp, bottom = 12.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                LinearProgressIndicator(
                    progress = { (value / target).toFloat().coerceIn(0f, 1f) },
                    modifier = Modifier.fillMaxWidth(),
                )
                Text(
                    buildString {
                        append("${((value / target) * 100).toInt()}% of ${target.currency(currencyCode)}")
                        sub.targetDate?.let { append(" · by ${it.dueMonthYear()}") }
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
