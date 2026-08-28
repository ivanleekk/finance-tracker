package com.ivanlee.financetracker.ui.accounts

import kotlinx.coroutines.launch
import androidx.compose.runtime.rememberCoroutineScope
import com.ivanlee.financetracker.data.model.AccountArchiveUpdate
import androidx.compose.material.icons.filled.Archive
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Add
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ivanlee.financetracker.data.model.AccountResponse
import com.ivanlee.financetracker.data.model.BalanceResponse
import com.ivanlee.financetracker.data.net.Api
import com.ivanlee.financetracker.logic.GoalHistoryPoint
import com.ivanlee.financetracker.logic.currency
import com.ivanlee.financetracker.logic.mediumDate
import com.ivanlee.financetracker.state.SessionViewModel
import com.ivanlee.financetracker.ui.components.DetailScaffold
import com.ivanlee.financetracker.ui.components.LineChart
import com.ivanlee.financetracker.ui.components.SectionCard
import com.ivanlee.financetracker.ui.components.chartAccent
import com.ivanlee.financetracker.ui.components.cardListItemColors

/**
 * One account: balance history chart, the manual/reconciled balance list, and — for a loan
 * with full terms — a way through to the amortization schedule.
 */
@Composable
fun AccountDetailScreen(
    accountId: String,
    sessionVm: SessionViewModel,
    onBack: () -> Unit,
    onEdit: (String) -> Unit,
    onAddBalance: (String) -> Unit,
    onLoanSchedule: (String) -> Unit,
) {
    var account by remember { mutableStateOf<AccountResponse?>(null) }
    var balances by remember { mutableStateOf<List<BalanceResponse>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var menuOpen by remember { mutableStateOf(false) }
    var reloadKey by remember { mutableStateOf(0) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(accountId, sessionVm.activeHousehold?.id, reloadKey) {
        val h = sessionVm.activeHousehold ?: return@LaunchedEffect
        try {
            // The backend has no GET /accounts/{id} — accounts are only listed per household,
            // so pick ours out of that list rather than inventing a route.
            account = Api.get<List<AccountResponse>>("/accounts/household/${h.id}")
                .firstOrNull { it.id == accountId }
            balances = Api.get("/accounts/balances/account/$accountId")
        } catch (e: Exception) {
            error = e.message ?: "Couldn't load this account."
        }
    }

    val sorted = balances.sortedBy { it.date }
    val currencyCode = account?.currency ?: "USD"

    DetailScaffold(
        title = account?.name ?: "Account",
        subtitle = account?.liquidity?.label,
        onBack = onBack,
        error = error,
        onErrorShown = { error = null },
        actions = {
            IconButton(onClick = { menuOpen = true }) {
                Icon(Icons.Filled.MoreVert, contentDescription = "More")
            }
            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                DropdownMenuItem(
                    text = { Text("Add balance") },
                    leadingIcon = { Icon(Icons.Filled.Add, contentDescription = null) },
                    onClick = {
                        menuOpen = false
                        onAddBalance(accountId)
                    },
                )
                DropdownMenuItem(
                    text = { Text("Edit account") },
                    leadingIcon = { Icon(Icons.Filled.Edit, contentDescription = null) },
                    onClick = {
                        menuOpen = false
                        onEdit(accountId)
                    },
                )
                // Archiving is how a used account is closed. Deleting one is
                // refused by the API, because its journal entries are shared with
                // other accounts and categories.
                DropdownMenuItem(
                    text = { Text(if (account?.isArchived == true) "Reopen account" else "Archive account") },
                    leadingIcon = { Icon(Icons.Filled.Archive, contentDescription = null) },
                    onClick = {
                        menuOpen = false
                        val next = account?.isArchived != true
                        scope.launch {
                            try {
                                // Only this key: the API's update uses
                                // `exclude_unset`, so anything else in the body
                                // would overwrite fields nobody touched.
                                Api.put<AccountArchiveUpdate, AccountResponse>(
                                    "/accounts/$accountId",
                                    AccountArchiveUpdate(isArchived = next),
                                )
                                reloadKey++
                            } catch (e: Exception) {
                                error = e.message ?: "Couldn't update that account."
                            }
                        }
                    },
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
            if (account?.hasLoanTerms == true) {
                item {
                    SectionCard {
                        ListItem(
                            colors = cardListItemColors(),
                            headlineContent = { Text("Payoff schedule") },
                            supportingContent = {
                                Text("Every payment split into interest and principal, with your payoff date.")
                            },
                            trailingContent = {
                                Icon(Icons.AutoMirrored.Filled.ArrowForward, contentDescription = null)
                            },
                            modifier = Modifier.clickable { onLoanSchedule(accountId) },
                        )
                    }
                }
            }

            if (sorted.size > 1) {
                item {
                    SectionCard(title = "Balance history") {
                        LineChart(
                            points = sorted.map { GoalHistoryPoint(it.date, it.balance) },
                            lineColor = chartAccent(),
                        )
                    }
                }
            }

            item {
                SectionCard(title = "History") {
                    if (sorted.isEmpty()) {
                        Text(
                            "No balances yet. Use the ⋮ menu to record one.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    sorted.asReversed().forEachIndexed { index, balance ->
                        if (index > 0) HorizontalDivider()
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .padding(vertical = 8.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                        ) {
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text(balance.date.mediumDate(), style = MaterialTheme.typography.bodyMedium)
                                if (balance.isManual) {
                                    Icon(
                                        Icons.Filled.Edit,
                                        contentDescription = "Entered manually",
                                        modifier = Modifier.size(14.dp),
                                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                            Text(
                                balance.balance.currency(currencyCode),
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.Medium,
                            )
                        }
                    }
                }
            }
        }
    }
}