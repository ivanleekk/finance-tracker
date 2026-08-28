package com.ivanlee.financetracker.ui.accounts

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountBalance
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ivanlee.financetracker.logic.selectableAccounts
import com.ivanlee.financetracker.data.model.AccountResponse
import com.ivanlee.financetracker.data.model.BalanceResponse
import com.ivanlee.financetracker.data.model.LinkedEquityRow
import com.ivanlee.financetracker.data.model.LiquidityStatus
import com.ivanlee.financetracker.data.net.Api
import com.ivanlee.financetracker.logic.currency
import com.ivanlee.financetracker.state.QuickAddViewModel
import com.ivanlee.financetracker.state.SessionViewModel
import com.ivanlee.financetracker.state.ViewModeViewModel
import com.ivanlee.financetracker.ui.components.EmptyState
import com.ivanlee.financetracker.ui.components.MainScreenScaffold
import com.ivanlee.financetracker.ui.components.SectionCard
import com.ivanlee.financetracker.ui.dashboard.AccountRow
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import java.time.Instant

/**
 * The Accounts tab: property/loan equity band on top, then accounts grouped by liquidity.
 * Android port of `AccountsListView` in ios/FinanceTracker/Views/Accounts/AccountsView.swift.
 */
@Composable
fun AccountsScreen(
    sessionVm: SessionViewModel,
    viewModeVm: ViewModeViewModel,
    quickAddVm: QuickAddViewModel,
    onOpenAccount: (String) -> Unit,
    onNewAccount: () -> Unit,
) {
    var accounts by remember { mutableStateOf<List<AccountResponse>>(emptyList()) }
    var balances by remember { mutableStateOf<List<BalanceResponse>>(emptyList()) }
    var equity by remember { mutableStateOf<List<LinkedEquityRow>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var lastLoadedAt by remember { mutableStateOf<Instant?>(null) }

    val userId = sessionVm.user?.id
    val baseCurrency = sessionVm.activeHousehold?.baseCurrency ?: "USD"

    suspend fun load() {
        val h = sessionVm.activeHousehold ?: return
        isLoading = true
        try {
            coroutineScope {
                val a = async { Api.get<List<AccountResponse>>("/accounts/household/${h.id}") }
                val b = async { Api.get<List<BalanceResponse>>("/accounts/balances/household/${h.id}") }
                accounts = a.await()
                balances = b.await()
            }
            // Equity is a supplementary panel — a failure here shouldn't blank the accounts
            // list the user came for.
            equity = runCatching {
                Api.get<List<LinkedEquityRow>>("/accounts/household/${h.id}/equity")
            }.getOrDefault(emptyList())
            lastLoadedAt = Instant.now()
        } catch (e: Exception) {
            error = e.message ?: "Couldn't load accounts."
        } finally {
            isLoading = false
        }
    }

    val visibleAccounts = accounts.filter { viewModeVm.isVisible(it.ownerUserId, userId) }
    val visibleAccountIds = visibleAccounts.map { it.id }.toSet()
    val visibleEquity = equity.filter { it.assetAccountId in visibleAccountIds }
    // Asset accounts bucketed by liquidity. Liabilities are deliberately *not* in here: a loan
    // filed under "Liquid" sat next to real cash showing a positive balance, so a household with
    // a $440k mortgage read as having $440k on hand. Liquidity describes how quickly an asset
    // could be spent and says nothing useful about a debt, so they get their own section below —
    // the way the web Accounts page and the iOS `AccountsListView` both group them.
    // Archived accounts leave the liquidity and liability sections for one of their own at
    // the end. They keep their balances and still count towards the totals — archiving
    // closes an account, it does not pretend the money was never there.
    val openAccounts = selectableAccounts(visibleAccounts)
    val grouped = LiquidityStatus.entries.mapNotNull { liquidity ->
        val matching = openAccounts
            .filter { it.liquidity == liquidity && !it.isLiability }
            .sortedBy { it.name }
        if (matching.isEmpty()) null else liquidity to matching
    }
    val liabilities = openAccounts.filter { it.isLiability }.sortedBy { it.name }
    val archived = visibleAccounts.filter { it.isArchived == true }.sortedBy { it.name }

    val latestByAccount = remember(balances) {
        buildMap<String, BalanceResponse> {
            balances.forEach { balance ->
                val existing = get(balance.accountId)
                if (existing == null || existing.date.isBefore(balance.date)) put(balance.accountId, balance)
            }
        }
    }

    MainScreenScaffold(
        title = "Accounts",
        viewModeVm = viewModeVm,
        quickAddVm = quickAddVm,
        isLoading = isLoading,
        showSkeleton = isLoading && accounts.isEmpty(),
        error = error,
        onErrorShown = { error = null },
        onReload = {
            val last = lastLoadedAt
            if (last == null || Instant.now().epochSecond - last.epochSecond >= 30) load()
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = onNewAccount,
                icon = { Icon(Icons.Filled.Add, contentDescription = null) },
                text = { Text("Account") },
            )
        },
    ) {
        if (visibleEquity.isNotEmpty()) {
            item {
                SectionCard(title = "Property & equity") {
                    visibleEquity.forEachIndexed { index, row ->
                        if (index > 0) HorizontalDivider()
                        EquityRow(row, baseCurrency)
                    }
                }
            }
        }

        grouped.forEach { (liquidity, group) ->
            item(key = liquidity.wire) {
                SectionCard(title = liquidity.label) {
                    group.forEachIndexed { index, account ->
                        if (index > 0) HorizontalDivider()
                        AccountRow(
                            account = account,
                            latestBalance = latestByAccount[account.id],
                            onClick = { onOpenAccount(account.id) },
                            baseCurrency = baseCurrency,
                            // The section header above already names the bucket.
                            showsLiquidity = false,
                        )
                    }
                }
            }
        }

        if (liabilities.isNotEmpty()) {
            item(key = "liabilities") {
                SectionCard(title = "Loans & liabilities") {
                    liabilities.forEachIndexed { index, account ->
                        if (index > 0) HorizontalDivider()
                        AccountRow(
                            account = account,
                            latestBalance = latestByAccount[account.id],
                            onClick = { onOpenAccount(account.id) },
                            baseCurrency = baseCurrency,
                            showsLiquidity = false,
                        )
                    }
                }
            }
        }

        if (archived.isNotEmpty()) {
            item(key = "archived") {
                // No section total: these are closed, and a heading figure would
                // invite reading them as a live bucket.
                SectionCard(title = "Archived") {
                    archived.forEachIndexed { index, account ->
                        if (index > 0) HorizontalDivider()
                        AccountRow(
                            account = account,
                            latestBalance = latestByAccount[account.id],
                            onClick = { onOpenAccount(account.id) },
                            baseCurrency = baseCurrency,
                            showsLiquidity = false,
                        )
                    }
                }
            }
        }

        if (!isLoading && visibleAccounts.isEmpty()) {
            item {
                EmptyState(
                    icon = Icons.Filled.AccountBalance,
                    title = if (accounts.isEmpty()) "No accounts" else "Nothing to show",
                    message = if (accounts.isEmpty()) {
                        "Tap the button below to add your first account."
                    } else {
                        "No accounts match the current view mode."
                    },
                )
            }
        }
    }
}

/**
 * A property netted against the loan secured on it.
 *
 * The point of the row: a mortgage recorded as a bare liability makes net worth read like a
 * catastrophe, because the debt is there in full and the house it bought is not.
 */
@Composable
fun EquityRow(row: LinkedEquityRow, currencyCode: String) {
    androidx.compose.foundation.layout.Column(
        Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(row.assetAccountName, style = MaterialTheme.typography.bodyLarge)
            Text(
                row.equity.currency(currencyCode),
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.SemiBold,
            )
        }
        row.equityPercent?.takeIf { it.isFinite() }?.let { percent ->
            LinearProgressIndicator(
                progress = { (percent / 100).toFloat().coerceIn(0f, 1f) },
                modifier = Modifier.fillMaxWidth(),
            )
        }
        Text(
            buildString {
                append(row.assetValue.currency(currencyCode))
                append(" value")
                if (row.loanAccountName != null) {
                    append(" · ")
                    append(row.loanBalance.currency(currencyCode))
                    append(" owed on ")
                    append(row.loanAccountName)
                }
                row.equityPercent?.takeIf { it.isFinite() }?.let {
                    append(" · ")
                    append("${it.toInt()}% equity")
                }
            },
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
