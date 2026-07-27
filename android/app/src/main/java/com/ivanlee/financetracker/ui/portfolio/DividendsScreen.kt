package com.ivanlee.financetracker.ui.portfolio

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ivanlee.financetracker.data.model.AssetResponse
import com.ivanlee.financetracker.data.model.DividendResponse
import com.ivanlee.financetracker.data.net.Api
import com.ivanlee.financetracker.logic.currency
import com.ivanlee.financetracker.logic.mediumDate
import com.ivanlee.financetracker.state.SessionViewModel
import com.ivanlee.financetracker.ui.components.AdaptiveStatGrid
import com.ivanlee.financetracker.ui.components.DetailScaffold
import com.ivanlee.financetracker.ui.components.EmptyState
import com.ivanlee.financetracker.ui.components.SectionCard
import com.ivanlee.financetracker.ui.components.StatTileData
import com.ivanlee.financetracker.ui.dashboard.trimQuantity
import com.ivanlee.financetracker.ui.theme.positiveColor
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import java.time.Instant
import java.time.ZoneOffset
import com.ivanlee.financetracker.ui.components.cardListItemColors

/** Standalone Dividends screen (pushed from Portfolio ▸ Dividends). */
@Composable
fun DividendsScreen(
    sessionVm: SessionViewModel,
    onBack: () -> Unit,
) {
    DetailScaffold(title = "Dividends", onBack = onBack) { padding ->
        DividendsContent(
            sessionVm = sessionVm,
            subPortfolioId = null,
            modifier = Modifier.fillMaxSize().padding(padding),
        )
    }
}

/**
 * Dividend payouts, newest first, with all-time and trailing-12-month totals.
 *
 * Split out from [DividendsScreen] so the sub-portfolio detail screen can drop it straight
 * into a tab without nesting a second scaffold and top app bar inside the first.
 *
 * @param subPortfolioId when set, scopes everything to one sub-portfolio.
 */
@Composable
fun DividendsContent(
    sessionVm: SessionViewModel,
    subPortfolioId: String?,
    modifier: Modifier = Modifier,
) {
    var dividends by remember { mutableStateOf<List<DividendResponse>>(emptyList()) }
    var assets by remember { mutableStateOf<List<AssetResponse>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }

    val baseCurrency = sessionVm.activeHousehold?.baseCurrency ?: "USD"

    LaunchedEffect(sessionVm.activeHousehold?.id) {
        val h = sessionVm.activeHousehold ?: return@LaunchedEffect
        try {
            coroutineScope {
                val d = async { Api.get<List<DividendResponse>>("/portfolio/dividends/household/${h.id}") }
                val a = async { Api.get<List<AssetResponse>>("/portfolio/assets") }
                dividends = d.await()
                assets = a.await()
            }
        } catch (e: Exception) {
            error = e.message ?: "Couldn't load dividends."
        }
    }

    val assetsById = assets.associateBy { it.id }
    val scoped = dividends
        .filter { subPortfolioId == null || it.subPortfolioId == subPortfolioId }
        .sortedByDescending { it.date }

    val allTime = scoped.sumOf { it.amountHomeCurrency ?: it.amount }
    val yearAgo = Instant.now().atZone(ZoneOffset.UTC).minusYears(1).toInstant()
    val trailing = scoped.filter { !it.date.isBefore(yearAgo) }.sumOf { it.amountHomeCurrency ?: it.amount }

    LazyColumn(
        modifier,
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        error?.let { message ->
            item {
                Text(message, color = MaterialTheme.colorScheme.error)
            }
        }

        item {
            SectionCard {
                AdaptiveStatGrid(
                    listOf(
                        StatTileData("Total received", allTime.currency(baseCurrency), signal = allTime),
                        StatTileData("Last 12 months", trailing.currency(baseCurrency), signal = trailing),
                        StatTileData("Payouts", scoped.size.toString()),
                    )
                )
            }
        }

        if (scoped.isEmpty()) {
            item {
                EmptyState(
                    icon = Icons.Filled.Payments,
                    title = "No dividends yet",
                    message = "Auto-tracked payouts appear here as the nightly job syncs them, " +
                        "and you can record one by hand from Quick Add.",
                )
            }
        } else {
            item {
                SectionCard(title = "Payouts") {
                    scoped.forEachIndexed { index, dividend ->
                        if (index > 0) HorizontalDivider()
                        val asset = assetsById[dividend.assetId]
                        ListItem(
                            colors = cardListItemColors(),
                            headlineContent = {
                                Text(asset?.ticker ?: "—", fontWeight = FontWeight.Medium)
                            },
                            supportingContent = {
                                Text(
                                    listOfNotNull(
                                        dividend.date.mediumDate(),
                                        // Per-share detail is absent on hand-entered payouts
                                        // that only recorded a total.
                                        dividend.perShareAmount?.let { perShare ->
                                            "${perShare.currency(asset?.currency ?: baseCurrency)}/share"
                                        },
                                        dividend.quantity?.let { "${trimQuantity(it)} held" },
                                        if (dividend.isManual == true) "manual" else null,
                                    ).joinToString(" · "),
                                    maxLines = 2,
                                )
                            },
                            trailingContent = {
                                Text(
                                    (dividend.amountHomeCurrency ?: dividend.amount).currency(baseCurrency),
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = positiveColor(),
                                )
                            },
                        )
                    }
                }
            }
        }
    }
}
