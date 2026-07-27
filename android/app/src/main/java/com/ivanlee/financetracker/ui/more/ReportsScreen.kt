package com.ivanlee.financetracker.ui.more

import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Share
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import com.ivanlee.financetracker.data.model.HouseholdReportResponse
import com.ivanlee.financetracker.data.model.TransactionType
import com.ivanlee.financetracker.data.net.Api
import com.ivanlee.financetracker.logic.currency
import com.ivanlee.financetracker.logic.currencyWhole
import com.ivanlee.financetracker.logic.mediumDate
import com.ivanlee.financetracker.state.SessionViewModel
import com.ivanlee.financetracker.ui.components.AdaptiveStatGrid
import com.ivanlee.financetracker.ui.components.DetailScaffold
import com.ivanlee.financetracker.ui.components.SectionCard
import com.ivanlee.financetracker.ui.components.StatTileData
import com.ivanlee.financetracker.ui.theme.negativeColor
import com.ivanlee.financetracker.ui.theme.positiveColor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import com.ivanlee.financetracker.ui.components.cardListItemColors

/**
 * The household report, plus CSV export.
 *
 * Export writes the ZIP into the app's cache and hands it to the system share sheet through a
 * [FileProvider] — Android will not let another app read a raw `file://` path, and a
 * download that can't be opened is not an export.
 */
@Composable
fun ReportsScreen(
    sessionVm: SessionViewModel,
    onBack: () -> Unit,
) {
    var report by remember { mutableStateOf<HouseholdReportResponse?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    val household = sessionVm.activeHousehold
    val baseCurrency = report?.baseCurrency ?: household?.baseCurrency ?: "USD"

    LaunchedEffect(household?.id) {
        val h = household ?: return@LaunchedEffect
        try {
            report = Api.get("/exports/household/${h.id}/report")
        } catch (e: Exception) {
            error = e.message ?: "Couldn't load the report."
        }
    }

    fun exportCsv() {
        val h = household ?: return
        busy = true
        scope.launch {
            try {
                val bytes = Api.getBytes("/exports/household/${h.id}/csv")
                val file = withContext(Dispatchers.IO) {
                    val dir = File(context.cacheDir, "exports").apply { mkdirs() }
                    File(dir, "waypoint-export.zip").apply { writeBytes(bytes) }
                }
                val uri = FileProvider.getUriForFile(
                    context,
                    "${context.packageName}.fileprovider",
                    file,
                )
                val share = Intent(Intent.ACTION_SEND).apply {
                    type = "application/zip"
                    putExtra(Intent.EXTRA_STREAM, uri)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                context.startActivity(Intent.createChooser(share, "Export data"))
            } catch (e: Exception) {
                error = e.message ?: "Couldn't export your data."
            } finally {
                busy = false
            }
        }
    }

    DetailScaffold(
        title = "Reports",
        subtitle = report?.let { "${it.periodStart.mediumDate()} – ${it.periodEnd.mediumDate()}" },
        onBack = onBack,
        error = error,
        onErrorShown = { error = null },
        actions = {
            IconButton(onClick = ::exportCsv, enabled = !busy) {
                Icon(Icons.Filled.Share, contentDescription = "Export CSV")
            }
        },
    ) { padding ->
        val data = report
        LazyColumn(
            Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (data == null) return@LazyColumn

            item {
                SectionCard(title = "Net worth") {
                    AdaptiveStatGrid(
                        listOf(
                            StatTileData("Assets", data.totalAssets.currencyWhole(baseCurrency), signal = 1.0),
                            StatTileData("Liabilities", data.totalLiabilities.currencyWhole(baseCurrency), signal = -1.0),
                            StatTileData("Net worth", data.netWorth.currencyWhole(baseCurrency), signal = data.netWorth),
                        )
                    )
                }
            }

            item {
                SectionCard(title = "Portfolio") {
                    AdaptiveStatGrid(
                        listOf(
                            StatTileData("Value", data.portfolioValue.currencyWhole(baseCurrency)),
                            StatTileData("Cost basis", data.portfolioCostBasis.currencyWhole(baseCurrency)),
                            StatTileData(
                                "Unrealized",
                                data.portfolioUnrealizedGain.currencyWhole(baseCurrency),
                                signal = data.portfolioUnrealizedGain,
                            ),
                        )
                    )
                }
            }

            item {
                SectionCard(title = "Cash flow") {
                    AdaptiveStatGrid(
                        listOf(
                            StatTileData("Income", data.incomeTotal.currencyWhole(baseCurrency), signal = 1.0),
                            StatTileData("Expenses", data.expenseTotal.currencyWhole(baseCurrency), signal = -1.0),
                            StatTileData("Net", data.netCashflow.currencyWhole(baseCurrency), signal = data.netCashflow),
                        )
                    )
                    data.cashflowByCategory
                        .sortedByDescending { it.totalHomeCurrency }
                        .forEach { flow ->
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text(
                                    "${flow.category} (${flow.transactionCount})",
                                    style = MaterialTheme.typography.bodyMedium,
                                )
                                Text(
                                    flow.totalHomeCurrency.currency(baseCurrency),
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = if (flow.type == TransactionType.INCOME) positiveColor()
                                    else negativeColor(),
                                )
                            }
                        }
                    Text(
                        "Transfers between your own accounts are excluded — counting them would " +
                            "double every figure here.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            item {
                SectionCard(title = "Dividends") {
                    AdaptiveStatGrid(
                        listOf(
                            StatTileData("This period", data.dividendsPeriodTotal.currencyWhole(baseCurrency), signal = 1.0),
                            StatTileData("All time", data.dividendsAllTimeTotal.currencyWhole(baseCurrency), signal = 1.0),
                        )
                    )
                }
            }

            if (data.goals.isNotEmpty()) {
                item {
                    SectionCard(title = "Goals") {
                        data.goals.forEachIndexed { index, goal ->
                            if (index > 0) HorizontalDivider()
                            ListItem(
                                colors = cardListItemColors(),
                                headlineContent = { Text(goal.name, fontWeight = FontWeight.Medium) },
                                supportingContent = {
                                    Text(
                                        listOfNotNull(
                                            goal.targetAmount?.let { "target ${it.currencyWhole(baseCurrency)}" },
                                            goal.targetDate?.let { "by ${it.mediumDate()}" },
                                            goal.progressPercent?.let { "${it.toInt()}%" },
                                        ).joinToString(" · "),
                                    )
                                },
                                trailingContent = {
                                    Text(goal.currentValueHomeCurrency.currencyWhole(baseCurrency))
                                },
                            )
                        }
                    }
                }
            }

            if (data.holdings.isNotEmpty()) {
                item {
                    SectionCard(title = "Holdings") {
                        data.holdings.forEachIndexed { index, holding ->
                            if (index > 0) HorizontalDivider()
                            ListItem(
                                colors = cardListItemColors(),
                                headlineContent = { Text(holding.ticker, fontWeight = FontWeight.Medium) },
                                supportingContent = {
                                    Text("${holding.subPortfolio} · ${holding.assetName.orEmpty()}", maxLines = 1)
                                },
                                trailingContent = {
                                    Text((holding.valueHomeCurrency ?: 0.0).currencyWhole(baseCurrency))
                                },
                            )
                        }
                    }
                }
            }
        }
    }
}
