package com.ivanlee.financetracker.ui.accounts

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.ivanlee.financetracker.data.model.LoanScheduleResponse
import com.ivanlee.financetracker.data.net.Api
import com.ivanlee.financetracker.logic.currency
import com.ivanlee.financetracker.logic.currencyWhole
import com.ivanlee.financetracker.logic.mediumDate
import com.ivanlee.financetracker.logic.monthYear
import com.ivanlee.financetracker.logic.percentOfHundred
import com.ivanlee.financetracker.ui.components.AdaptiveStatGrid
import com.ivanlee.financetracker.ui.components.DetailScaffold
import com.ivanlee.financetracker.ui.components.SectionCard
import com.ivanlee.financetracker.ui.components.StatTileData

/**
 * The full amortization table for a loan: every payment split into interest and principal,
 * with the payoff date. Loaded on demand — the schedule for a 30-year mortgage is 360 rows
 * and has no business being fetched with the accounts list.
 */
@Composable
fun LoanScheduleScreen(
    accountId: String,
    onBack: () -> Unit,
) {
    var schedule by remember { mutableStateOf<LoanScheduleResponse?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(accountId) {
        try {
            schedule = Api.get("/accounts/$accountId/loan-schedule")
        } catch (e: Exception) {
            error = e.message ?: "Couldn't load the payoff schedule."
        }
    }

    val data = schedule
    DetailScaffold(
        title = "Payoff schedule",
        subtitle = data?.accountName,
        onBack = onBack,
        error = error,
        onErrorShown = { error = null },
    ) { padding ->
        LazyColumn(
            Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (data != null) {
                item {
                    SectionCard {
                        AdaptiveStatGrid(
                            listOf(
                                StatTileData("Balance", data.currentBalance.currencyWhole(data.currency)),
                                StatTileData(
                                    "Payoff",
                                    // Null means the payment can't ever clear the balance — say
                                    // so rather than printing a date that will never arrive.
                                    data.payoffDate?.monthYear() ?: "Never at this payment",
                                ),
                                StatTileData("Monthly payment", data.monthlyPayment.currency(data.currency)),
                                StatTileData("Rate", data.interestRateAnnual.percentOfHundred(2)),
                                StatTileData("Interest paid", data.interestPaid.currencyWhole(data.currency)),
                                StatTileData("Interest to come", data.remainingInterest.currencyWhole(data.currency)),
                            )
                        )
                    }
                }

                item {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 8.dp),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        HeaderCell("Date", 1.4f)
                        HeaderCell("Interest", 1f)
                        HeaderCell("Principal", 1f)
                        HeaderCell("Balance", 1.2f)
                    }
                }

                items(data.schedule, key = { it.period }) { row ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 8.dp, vertical = 6.dp),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        BodyCell(row.date.mediumDate(), 1.4f, TextAlign.Start)
                        BodyCell(row.interest.currencyWhole(data.currency), 1f)
                        BodyCell(row.principal.currencyWhole(data.currency), 1f)
                        BodyCell(row.balance.currencyWhole(data.currency), 1.2f)
                    }
                    HorizontalDivider()
                }
            }
        }
    }
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.HeaderCell(text: String, weight: Float) {
    Text(
        text,
        modifier = Modifier.weight(weight),
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = if (weight > 1.3f) TextAlign.Start else TextAlign.End,
    )
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.BodyCell(
    text: String,
    weight: Float,
    align: TextAlign = TextAlign.End,
) {
    Text(
        text,
        modifier = Modifier.weight(weight),
        style = MaterialTheme.typography.bodySmall,
        textAlign = align,
        maxLines = 1,
    )
}
