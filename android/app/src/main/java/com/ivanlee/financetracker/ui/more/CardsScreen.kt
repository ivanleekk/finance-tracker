package com.ivanlee.financetracker.ui.more

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ivanlee.financetracker.data.model.AccountResponse
import com.ivanlee.financetracker.data.model.CardLimitStatusRow
import com.ivanlee.financetracker.data.model.CardResponse
import com.ivanlee.financetracker.data.model.CardStatusResponse
import com.ivanlee.financetracker.data.model.LimitDirection
import com.ivanlee.financetracker.data.net.Api
import com.ivanlee.financetracker.logic.Cards
import com.ivanlee.financetracker.logic.currencyWhole
import com.ivanlee.financetracker.state.SessionViewModel
import com.ivanlee.financetracker.ui.components.DetailScaffold
import com.ivanlee.financetracker.ui.components.EmptyState
import com.ivanlee.financetracker.ui.components.SectionCard
import com.ivanlee.financetracker.ui.theme.negativeColor
import com.ivanlee.financetracker.ui.theme.warningColor
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope

/**
 * Per-card spend limits — the reviewing surface.
 *
 * The number that actually changes a decision lives in the transaction form's
 * card-category picker, not here: a meter you have to go and look at will not
 * stop anyone overspending. This screen is for setting the limits up and for
 * looking back over the cycle.
 */
@Composable
fun CardsScreen(
    sessionVm: SessionViewModel,
    onBack: () -> Unit,
) {
    var cards by remember { mutableStateOf<List<CardResponse>>(emptyList()) }
    var statuses by remember { mutableStateOf<Map<String, CardStatusResponse>>(emptyMap()) }
    var available by remember { mutableStateOf<List<AccountResponse>>(emptyList()) }
    var loaded by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var setUp by remember { mutableStateOf(false) }
    var managing by remember { mutableStateOf<CardResponse?>(null) }
    var reloadKey by remember { mutableStateOf(0) }

    val household = sessionVm.activeHousehold
    val baseCurrency = household?.baseCurrency ?: "USD"

    LaunchedEffect(household?.id, reloadKey) {
        val h = household ?: return@LaunchedEffect
        try {
            coroutineScope {
                val c = async { Api.get<List<CardResponse>>("/cards/household/${h.id}") }
                val a = async { Api.get<List<AccountResponse>>("/accounts/household/${h.id}") }
                val loadedCards = c.await()
                val accounts = a.await()

                cards = loadedCards
                val taken = loadedCards.map { it.financialAccountId }.toSet()
                available = accounts.filter { it.kind == "liability" && it.id !in taken }

                // One small aggregate per card, in parallel. A household has a
                // handful of cards rather than a list that grows.
                statuses = loadedCards
                    .map { card ->
                        async {
                            card.id to runCatching {
                                Api.get<CardStatusResponse>("/cards/${card.id}/status")
                            }.getOrNull()
                        }
                    }
                    .awaitAll()
                    .mapNotNull { (id, status) -> status?.let { id to it } }
                    .toMap()
            }
            error = null
        } catch (e: Exception) {
            error = e.message ?: "Couldn't load your cards."
        } finally {
            loaded = true
        }
    }

    DetailScaffold(
        title = "Cards",
        onBack = onBack,
        floatingActionButton = {
            if (available.isNotEmpty()) {
                ExtendedFloatingActionButton(
                    onClick = { setUp = true },
                    icon = { Icon(Icons.Filled.Add, contentDescription = null) },
                    text = { Text("Set up a card") },
                )
            }
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier.padding(padding).fillMaxWidth(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            error?.let {
                item {
                    Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }
            }

            if (loaded && cards.isEmpty()) {
                item {
                    EmptyState(
                        icon = Icons.Filled.CreditCard,
                        title = "No cards set up",
                        message = if (available.isEmpty()) {
                            "Add a liability account first — a card's balance is money owed."
                        } else {
                            "Set one up on a liability account to start metering its spending."
                        },
                    )
                }
            }

            items(cards, key = { it.id }) { card ->
                val status = statuses[card.id]
                val currency = card.currency ?: baseCurrency
                SectionCard {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(card.accountName, fontWeight = FontWeight.SemiBold)
                        if (status != null) {
                            Text(
                                Cards.cycleLabel(status.cycleStart, status.cycleEnd),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }

                    if (status == null || status.limits.isEmpty()) {
                        Text(
                            "No limits yet. Add a cap or a minimum spend, and this card's spending will be measured against it.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(top = 6.dp),
                        )
                    } else {
                        status.limits.forEach { row ->
                            CardLimitMeter(row, currency)
                        }
                    }

                    status?.categories?.takeIf { it.isNotEmpty() }?.let { spend ->
                        Column(modifier = Modifier.padding(top = 10.dp)) {
                            Text(
                                "THIS CYCLE",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            spend.forEach { entry ->
                                Row(
                                    modifier = Modifier.fillMaxWidth().padding(top = 2.dp),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                ) {
                                    Text(entry.name, style = MaterialTheme.typography.bodySmall)
                                    Text(
                                        entry.spent.currencyWhole(currency),
                                        style = MaterialTheme.typography.bodySmall,
                                    )
                                }
                            }
                        }
                    }

                    TextButton(onClick = { managing = card }) { Text("Manage") }
                }
            }
        }
    }

    if (setUp) {
        CardSetUpDialog(
            accounts = available,
            onDismiss = { setUp = false },
            onSaved = { setUp = false; reloadKey++ },
        )
    }

    managing?.let { card ->
        CardManageDialog(
            card = card,
            onDismiss = { managing = null },
            onChanged = { reloadKey++ },
        )
    }
}

/**
 * One limit and how the cycle is tracking against it.
 *
 * The bar and the pace marker are the budget row's fractions — a card limit row
 * is deliberately the same shape, which is why this reuses rather than reinvents.
 */
@Composable
fun CardLimitMeter(row: CardLimitStatusRow, currency: String) {
    val tone = Cards.tone(row)
    val toneColor = when (tone) {
        Cards.Tone.OVER -> negativeColor()
        Cards.Tone.AT_RISK -> warningColor()
        Cards.Tone.OK -> MaterialTheme.colorScheme.onSurface
    }

    Column(modifier = Modifier.padding(top = 10.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Column {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(row.name, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                    if (row.direction == LimitDirection.FLOOR) {
                        Text(
                            "Minimum",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                if (row.categoryNames.isNotEmpty()) {
                    Text(
                        row.categoryNames.joinToString(" · "),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(
                    Cards.headroomLabel(row) { it.currencyWhole(currency) },
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = toneColor,
                )
                Text(
                    "${row.spent.currencyWhole(currency)} of ${row.amount.currencyWhole(currency)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        Box(modifier = Modifier.fillMaxWidth().padding(top = 4.dp)) {
            LinearProgressIndicator(
                progress = { (row.percentUsed / 100.0).coerceIn(0.0, 1.0).toFloat() },
                modifier = Modifier.fillMaxWidth().height(6.dp),
                color = toneColor,
            )
        }

        if (tone == Cards.Tone.AT_RISK) {
            Text(
                if (row.direction == LimitDirection.FLOOR) {
                    "On pace for ${row.projectedSpend.currencyWhole(currency)} — short of the minimum."
                } else {
                    "On pace for ${row.projectedSpend.currencyWhole(currency)} by the end of the cycle."
                },
                style = MaterialTheme.typography.bodySmall,
                color = warningColor(),
                modifier = Modifier.padding(top = 2.dp),
            )
        }
    }
}
