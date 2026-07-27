package com.ivanlee.financetracker.ui.portfolio

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ivanlee.financetracker.data.model.AssetResponse
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
import com.ivanlee.financetracker.logic.periodChange
import com.ivanlee.financetracker.logic.signedPercent
import com.ivanlee.financetracker.state.SessionViewModel
import com.ivanlee.financetracker.ui.components.DetailScaffold
import com.ivanlee.financetracker.ui.components.DonutChart
import com.ivanlee.financetracker.ui.components.LineChart
import com.ivanlee.financetracker.ui.components.SectionCard
import com.ivanlee.financetracker.ui.components.SegmentedChoice
import com.ivanlee.financetracker.ui.components.chartAccent
import com.ivanlee.financetracker.ui.dashboard.trimQuantity
import com.ivanlee.financetracker.ui.theme.amountColor
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import com.ivanlee.financetracker.ui.components.cardListItemColors

private val TABS = listOf("Growth", "Holdings", "Dividends")

/**
 * One sub-portfolio, scoped to Growth / Holdings / Dividends.
 *
 * This is the native counterpart of the **web Portfolio tab bar**: the web re-scopes its whole
 * page to the selected sub-portfolio, which a phone-width strip can't do, so the scoping is a
 * drill-in here and the tabs inside it slice that one sub-portfolio instead.
 */
@Composable
fun SubPortfolioDetailScreen(
    subPortfolioId: String,
    sessionVm: SessionViewModel,
    onBack: () -> Unit,
    onOpenGoal: (String) -> Unit,
    onRecordTrade: (String) -> Unit,
) {
    var sub by remember { mutableStateOf<SubPortfolioResponse?>(null) }
    var snapshots by remember { mutableStateOf<List<PortfolioSnapshotResponse>>(emptyList()) }
    var timeseries by remember { mutableStateOf<List<PortfolioTimeseriesPoint>>(emptyList()) }
    var assets by remember { mutableStateOf<List<AssetResponse>>(emptyList()) }
    var metrics by remember { mutableStateOf<PortfolioMetricsResponse?>(null) }
    var range by remember { mutableStateOf(GrowthRange.SIX_MONTHS) }
    var tab by remember { mutableIntStateOf(0) }
    var error by remember { mutableStateOf<String?>(null) }

    val baseCurrency = sessionVm.activeHousehold?.baseCurrency ?: "USD"

    LaunchedEffect(subPortfolioId, sessionVm.activeHousehold?.id) {
        val h = sessionVm.activeHousehold ?: return@LaunchedEffect
        try {
            coroutineScope {
                val subsReq = async {
                    Api.get<List<SubPortfolioResponse>>("/portfolio/subportfolios/household/${h.id}")
                }
                val snapshotsReq = async {
                    Api.get<List<PortfolioSnapshotResponse>>("/portfolio/snapshots/household/${h.id}?latest_only=true")
                }
                val tsReq = async {
                    Api.get<List<PortfolioTimeseriesPoint>>("/portfolio/snapshots/household/${h.id}/timeseries")
                }
                val assetsReq = async { Api.get<List<AssetResponse>>("/portfolio/assets") }
                val metricsReq = async {
                    runCatching { Api.get<PortfolioMetricsResponse>("/portfolio/household/${h.id}/metrics") }.getOrNull()
                }
                sub = subsReq.await().firstOrNull { it.id == subPortfolioId }
                snapshots = snapshotsReq.await()
                timeseries = tsReq.await()
                assets = assetsReq.await()
                metrics = metricsReq.await()
            }
        } catch (e: Exception) {
            error = e.message ?: "Couldn't load this sub-portfolio."
        }
    }

    val assetsById = assets.associateBy { it.id }
    val latestDate = snapshots.filter { it.subPortfolioId == subPortfolioId }.maxOfOrNull { it.date }
    val holdings = snapshots
        .filter { it.subPortfolioId == subPortfolioId && it.date == latestDate && it.quantity > 0 }
        .sortedByDescending { it.currentValueHomeCurrency }
    val totalValue = holdings.sumOf { it.currentValueHomeCurrency }
    val costBasis = holdings.sumOf { it.averageCostBasisHomeCurrency * it.quantity }

    val curve = remember(timeseries, range, subPortfolioId) {
        equityCurve(timeseries, subPortfolioId = subPortfolioId, range = range)
    }
    val change = remember(curve) { periodChange(curve) }
    val slices = remember(holdings, assetsById) { allocationSlices(holdings, assetsById) }
    val scopedMetrics = metrics?.subPortfolioMetrics?.firstOrNull { it.subPortfolioId == subPortfolioId }?.metrics

    DetailScaffold(
        title = sub?.name ?: "Sub-portfolio",
        subtitle = totalValue.currency(baseCurrency),
        onBack = onBack,
        error = error,
        onErrorShown = { error = null },
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            PrimaryTabRow(selectedTabIndex = tab) {
                TABS.forEachIndexed { index, label ->
                    Tab(
                        selected = tab == index,
                        onClick = { tab = index },
                        text = { Text(label) },
                    )
                }
            }

            when (tab) {
                0 -> LazyColumn(
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    item {
                        SectionCard(title = "Growth") {
                            change?.let { delta ->
                                Text(
                                    buildString {
                                        append(delta.delta.compactCurrency(baseCurrency))
                                        delta.fraction?.let { append("  (${it.signedPercent()})") }
                                        append("  ${range.label}")
                                    },
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = amountColor(delta.delta),
                                )
                            }
                            LineChart(
                                points = curve,
                                lineColor = chartAccent(),
                                referenceValue = sub?.targetAmount,
                            )
                            SegmentedChoice(
                                options = GrowthRange.entries,
                                selected = range,
                                optionLabel = { it.label },
                                onSelect = { range = it },
                            )
                        }
                    }
                    item {
                        SectionCard(title = "Performance") {
                            PerformanceTileGrid(scopedMetrics, totalValue - costBasis, baseCurrency)
                        }
                    }
                    sub?.targetAmount?.takeIf { it.isFinite() && it > 0 }?.let { target ->
                        item {
                            SectionCard(title = "Goal") {
                                Column(
                                    Modifier
                                        .fillMaxWidth()
                                        .clickable { onOpenGoal(subPortfolioId) },
                                    verticalArrangement = Arrangement.spacedBy(6.dp),
                                ) {
                                    LinearProgressIndicator(
                                        progress = { (totalValue / target).toFloat().coerceIn(0f, 1f) },
                                        modifier = Modifier.fillMaxWidth(),
                                    )
                                    Text(
                                        buildString {
                                            append("${((totalValue / target) * 100).toInt()}% of ")
                                            append(target.currency(baseCurrency))
                                            sub?.targetDate?.let { append(" · by ${it.dueMonthYear()}") }
                                        },
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                    Text(
                                        "See full goal projection →",
                                        style = MaterialTheme.typography.labelLarge,
                                        color = MaterialTheme.colorScheme.primary,
                                    )
                                }
                            }
                        }
                    }
                }

                1 -> LazyColumn(
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    if (slices.isNotEmpty()) {
                        item {
                            SectionCard(title = "Allocation") {
                                DonutChart(
                                    slices = slices,
                                    centerLabel = totalValue.compactCurrency(baseCurrency),
                                    centerCaption = "total",
                                )
                            }
                        }
                    }
                    item {
                        SectionCard(title = "Holdings") {
                            if (holdings.isEmpty()) {
                                Text(
                                    "Nothing held here yet.",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            holdings.forEachIndexed { index, holding ->
                                if (index > 0) HorizontalDivider()
                                val asset = assetsById[holding.assetId]
                                val gain = holding.currentValueHomeCurrency -
                                    holding.averageCostBasisHomeCurrency * holding.quantity
                                ListItem(
                                    colors = cardListItemColors(),
                                    headlineContent = {
                                        Text(asset?.ticker ?: "—", fontWeight = FontWeight.Medium)
                                    },
                                    supportingContent = {
                                        Text(
                                            // Native currency for per-asset detail, home currency
                                            // for the aggregate — the same rule as web and iOS.
                                            "${trimQuantity(holding.quantity)} @ " +
                                                "${holding.averageCostBasis.currency(asset?.currency ?: baseCurrency)} avg · " +
                                                "now ${holding.price.currency(asset?.currency ?: baseCurrency)}",
                                            maxLines = 2,
                                        )
                                    },
                                    trailingContent = {
                                        Column(horizontalAlignment = androidx.compose.ui.Alignment.End) {
                                            Text(
                                                holding.currentValueHomeCurrency.currency(baseCurrency),
                                                style = MaterialTheme.typography.bodyMedium,
                                            )
                                            Text(
                                                gain.currency(baseCurrency),
                                                style = MaterialTheme.typography.labelSmall,
                                                color = amountColor(gain),
                                            )
                                        }
                                    },
                                    modifier = Modifier.clickable { onRecordTrade(subPortfolioId) },
                                )
                            }
                        }
                    }
                }

                // The dividends tab reuses the standalone screen's body, scoped to this
                // sub-portfolio — content only, so no second top app bar appears here.
                else -> DividendsContent(sessionVm, subPortfolioId, Modifier.fillMaxSize())
            }
        }
    }
}
