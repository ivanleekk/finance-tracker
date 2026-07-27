package com.ivanlee.financetracker.ui.portfolio

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.TrendingUp
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ivanlee.financetracker.data.model.AssetResponse
import com.ivanlee.financetracker.data.model.SubPortfolioResponse
import com.ivanlee.financetracker.data.model.TradeResponse
import com.ivanlee.financetracker.data.model.TradeType
import com.ivanlee.financetracker.data.net.Api
import com.ivanlee.financetracker.logic.currency
import com.ivanlee.financetracker.logic.mediumDate
import com.ivanlee.financetracker.state.SessionViewModel
import com.ivanlee.financetracker.ui.components.ConfirmDialog
import com.ivanlee.financetracker.ui.components.DetailScaffold
import com.ivanlee.financetracker.ui.components.EmptyState
import com.ivanlee.financetracker.ui.components.SectionCard
import com.ivanlee.financetracker.ui.components.SwipeActionRow
import com.ivanlee.financetracker.ui.dashboard.trimQuantity
import com.ivanlee.financetracker.ui.theme.negativeColor
import com.ivanlee.financetracker.ui.theme.positiveColor
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import com.ivanlee.financetracker.ui.components.cardListItemColors

/**
 * Every trade in the household, newest first. Tap to edit, swipe to delete.
 *
 * Cash pseudo-asset legs are filtered out: a cash-settled buy writes a companion trade of
 * `CASH.<CUR>` moving the other way, and showing both would make one purchase look like two.
 */
@Composable
fun TradesScreen(
    sessionVm: SessionViewModel,
    onBack: () -> Unit,
    onNewTrade: () -> Unit,
    onEditTrade: (String) -> Unit,
) {
    var trades by remember { mutableStateOf<List<TradeResponse>>(emptyList()) }
    var assets by remember { mutableStateOf<List<AssetResponse>>(emptyList()) }
    var subs by remember { mutableStateOf<List<SubPortfolioResponse>>(emptyList()) }
    var pendingDelete by remember { mutableStateOf<TradeResponse?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    suspend fun load() {
        val h = sessionVm.activeHousehold ?: return
        try {
            coroutineScope {
                val t = async { Api.get<List<TradeResponse>>("/portfolio/trades/household/${h.id}") }
                val a = async { Api.get<List<AssetResponse>>("/portfolio/assets") }
                val s = async { Api.get<List<SubPortfolioResponse>>("/portfolio/subportfolios/household/${h.id}") }
                trades = t.await()
                assets = a.await()
                subs = s.await()
            }
        } catch (e: Exception) {
            error = e.message ?: "Couldn't load trades."
        }
    }

    LaunchedEffect(sessionVm.activeHousehold?.id) { load() }

    val assetsById = assets.associateBy { it.id }
    val subsById = subs.associateBy { it.id }
    val visible = trades
        .filter { assetsById[it.assetId]?.isCash != true }
        .sortedByDescending { it.date }

    DetailScaffold(
        title = "Trades",
        onBack = onBack,
        error = error,
        onErrorShown = { error = null },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = onNewTrade,
                icon = { Icon(Icons.Filled.Add, contentDescription = null) },
                text = { Text("Trade") },
            )
        },
    ) { padding ->
        LazyColumn(
            Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (visible.isEmpty()) {
                item {
                    EmptyState(
                        icon = Icons.AutoMirrored.Filled.TrendingUp,
                        title = "No trades yet",
                        message = "Record a buy or sell to start tracking performance.",
                    )
                }
            }
            item {
                SectionCard {
                    visible.forEachIndexed { index, trade ->
                        if (index > 0) HorizontalDivider()
                        SwipeActionRow(onEndAction = { pendingDelete = trade }) {
                            val asset = assetsById[trade.assetId]
                            val isBuy = trade.type == TradeType.BUY
                            ListItem(
                                colors = cardListItemColors(),
                                headlineContent = {
                                    Text(
                                        "${if (isBuy) "Buy" else "Sell"} ${asset?.ticker ?: "—"}",
                                        fontWeight = FontWeight.Medium,
                                    )
                                },
                                supportingContent = {
                                    Text(
                                        listOfNotNull(
                                            "${trimQuantity(trade.quantity)} @ " +
                                                trade.price.currency(trade.currency ?: asset?.currency ?: "USD"),
                                            subsById[trade.subPortfolioId]?.name,
                                            trade.date.mediumDate(),
                                            if (trade.settlementTradeId != null) "from cash" else null,
                                        ).joinToString(" · "),
                                        maxLines = 2,
                                    )
                                },
                                trailingContent = {
                                    Text(
                                        (trade.quantity * trade.price)
                                            .currency(trade.currency ?: asset?.currency ?: "USD"),
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = if (isBuy) negativeColor() else positiveColor(),
                                    )
                                },
                                modifier = Modifier.clickable { onEditTrade(trade.id) },
                            )
                        }
                    }
                }
            }
        }
    }

    pendingDelete?.let { trade ->
        ConfirmDialog(
            title = "Delete trade?",
            message = "Holdings, snapshots and the funding transaction are all rolled back. " +
                "A cash-settled trade's companion cash leg goes with it.",
            onConfirm = {
                scope.launch {
                    try {
                        Api.delete("/portfolio/trades/${trade.id}")
                        trades = trades.filterNot { it.id == trade.id }
                    } catch (e: Exception) {
                        error = e.message ?: "Couldn't delete that trade."
                    }
                }
            },
            onDismiss = { pendingDelete = null },
        )
    }
}
