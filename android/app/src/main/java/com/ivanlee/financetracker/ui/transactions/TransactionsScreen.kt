package com.ivanlee.financetracker.ui.transactions

import android.content.Context
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ListAlt
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Category
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.ivanlee.financetracker.data.model.AccountResponse
import com.ivanlee.financetracker.data.model.CategoryResponse
import com.ivanlee.financetracker.data.model.TransactionResponse
import com.ivanlee.financetracker.data.model.TransactionType
import com.ivanlee.financetracker.data.net.Api
import com.ivanlee.financetracker.logic.HistoryEntry
import com.ivanlee.financetracker.logic.HistoryGranularity
import com.ivanlee.financetracker.logic.HistoryGroupSummary
import com.ivanlee.financetracker.logic.NetWorthSlice
import com.ivanlee.financetracker.logic.currency
import com.ivanlee.financetracker.logic.groupHistory
import com.ivanlee.financetracker.logic.historyGroupLabel
import com.ivanlee.financetracker.logic.homeValue
import com.ivanlee.financetracker.state.QuickAddViewModel
import com.ivanlee.financetracker.state.SessionViewModel
import com.ivanlee.financetracker.state.ViewModeViewModel
import com.ivanlee.financetracker.ui.components.CategorySpendingChart
import com.ivanlee.financetracker.ui.components.ConfirmDialog
import com.ivanlee.financetracker.ui.components.EmptyState
import com.ivanlee.financetracker.ui.components.MainScreenScaffold
import com.ivanlee.financetracker.ui.components.SectionCard
import com.ivanlee.financetracker.ui.components.SwipeActionRow
import com.ivanlee.financetracker.ui.dashboard.TransactionRow
import com.ivanlee.financetracker.ui.theme.negativeColor
import com.ivanlee.financetracker.ui.theme.positiveColor
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlin.math.abs

/** Which slice of activity the list is showing. */
private enum class TxnFilter(val label: String) {
    ALL("All"),
    EXPENSE("Expenses"),
    INCOME("Income"),
    TRANSFERS("Transfers"),
}

private data class CategoryOption(val id: String, val name: String)

private const val GRANULARITY_KEY = "activityGranularity"

/**
 * The Activity tab: every transaction, newest first, grouped by day, month or year — each
 * section header carrying the income and spending that landed inside it.
 *
 * Rows are tap-to-edit and swipe-to-delete, except transfers — a transfer is a linked pair of
 * transactions, so editing one half in isolation would silently break the other. Same rule as
 * iOS and web.
 */
@Composable
fun TransactionsScreen(
    sessionVm: SessionViewModel,
    viewModeVm: ViewModeViewModel,
    quickAddVm: QuickAddViewModel,
    onNewTransaction: () -> Unit,
    onEditTransaction: (String) -> Unit,
    onOpenCategories: () -> Unit,
) {
    var transactions by remember { mutableStateOf<List<TransactionResponse>>(emptyList()) }
    var categories by remember { mutableStateOf<List<CategoryResponse>>(emptyList()) }
    var accounts by remember { mutableStateOf<List<AccountResponse>>(emptyList()) }
    var filter by remember { mutableStateOf(TxnFilter.ALL) }
    var isLoading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var pendingDelete by remember { mutableStateOf<TransactionResponse?>(null) }
    var reloadKey by remember { mutableStateOf(0) }
    var hiddenCategoryIds by remember { mutableStateOf(setOf<String>()) }
    var showCategoryFilter by remember { mutableStateOf(false) }
    // Remembered across launches, the same way the web page remembers it per household.
    val prefs = LocalContext.current.getSharedPreferences("waypoint_prefs", Context.MODE_PRIVATE)
    var granularity by remember {
        mutableStateOf(
            runCatching { HistoryGranularity.valueOf(prefs.getString(GRANULARITY_KEY, "") ?: "") }
                .getOrDefault(HistoryGranularity.MONTH),
        )
    }

    val scope = rememberCoroutineScope()
    val userId = sessionVm.user?.id
    val baseCurrency = sessionVm.activeHousehold?.baseCurrency ?: "USD"

    suspend fun load() {
        val h = sessionVm.activeHousehold ?: return
        isLoading = true
        try {
            coroutineScope {
                val t = async { Api.get<List<TransactionResponse>>("/cashflow/transactions/household/${h.id}") }
                val c = async { Api.get<List<CategoryResponse>>("/cashflow/categories/household/${h.id}") }
                val a = async { Api.get<List<AccountResponse>>("/accounts/household/${h.id}") }
                transactions = t.await()
                categories = c.await()
                accounts = a.await()
            }
        } catch (e: Exception) {
            error = e.message ?: "Couldn't load your activity."
        } finally {
            isLoading = false
        }
    }

    val categoriesById = categories.associateBy { it.id }
    val accountsById = accounts.associateBy { it.id }
    val visibleAccountIds = accounts
        .filter { viewModeVm.isVisible(it.ownerUserId, userId) }
        .map { it.id }.toSet()

    val expenseTransactions = transactions.filter {
        it.transactionType == TransactionType.EXPENSE && it.accountId in visibleAccountIds
    }

    // Every expense category that's actually shown up, used to populate the filter chips
    // (independent of `hiddenCategoryIds`, so a hidden chip stays visible to re-enable).
    val expenseCategoryOptions = expenseTransactions
        .distinctBy { it.categoryId }
        .map { CategoryOption(it.categoryId, categoriesById[it.categoryId]?.name ?: "Uncategorized") }
        .sortedBy { it.name }

    val categoryTotals = expenseTransactions
        .filter { it.categoryId !in hiddenCategoryIds }
        .groupBy { it.categoryId }
        .mapValues { (_, txns) -> txns.sumOf { kotlin.math.abs(it.amountHomeCurrency ?: it.amount) } }
    val categoryBreakdown = categoryTotals.entries
        .map { (id, amount) -> NetWorthSlice(id, categoriesById[id]?.name ?: "Uncategorized", amount) }
        .sortedByDescending { it.value }
    val categoryTotal = categoryBreakdown.sumOf { it.value }
    val categoryTop = categoryBreakdown.take(4)
    // Caps the pie chart at 6 slices + "Other" so it stays legible once a household has a long
    // tail of categories.
    val categoryPieSlices = if (categoryBreakdown.size <= 6) {
        categoryBreakdown
    } else {
        categoryBreakdown.take(6) + NetWorthSlice("other", "Other", categoryBreakdown.drop(6).sumOf { it.value })
    }

    val filtered = transactions
        .filter { it.accountId in visibleAccountIds }
        .filter { txn ->
            when (filter) {
                TxnFilter.ALL -> true
                TxnFilter.TRANSFERS -> txn.transferId != null
                TxnFilter.EXPENSE -> txn.transferId == null && txn.transactionType == TransactionType.EXPENSE
                TxnFilter.INCOME -> txn.transferId == null && txn.transactionType == TransactionType.INCOME
            }
        }
        .sortedByDescending { it.date }

    // Bucketed by day/month/year with each header carrying what moved inside it; `filtered` is
    // already newest-first, so the sections come out in that order too. The grouping and the
    // totals live in logic/HistoryGroups.kt, shared with the web and iOS ports.
    val groups = groupHistory(filtered, granularity) { txn ->
        HistoryEntry(
            date = txn.date,
            isTransfer = txn.transferId != null,
            isInflow = txn.transactionType == TransactionType.INCOME,
            homeAmount = homeValue(
                stored = txn.amountHomeCurrency,
                nativeAmount = txn.amount,
                nativeCurrency = txn.currency ?: accountsById[txn.accountId]?.currency,
                baseCurrency = baseCurrency,
            ),
        )
    }

    MainScreenScaffold(
        title = "Activity",
        viewModeVm = viewModeVm,
        quickAddVm = quickAddVm,
        isLoading = isLoading,
        showSkeleton = isLoading && transactions.isEmpty(),
        error = error,
        onErrorShown = { error = null },
        onReload = { load() },
        actions = {
            IconButton(onClick = onOpenCategories) {
                Icon(Icons.Filled.Category, contentDescription = "Categories")
            }
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = onNewTransaction,
                icon = { Icon(Icons.Filled.Add, contentDescription = null) },
                text = { Text("Transaction") },
            )
        },
    ) {
        item {
            Row(
                Modifier.horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                TxnFilter.entries.forEach { option ->
                    FilterChip(
                        selected = filter == option,
                        onClick = { filter = option },
                        label = { Text(option.label) },
                    )
                }
            }
        }

        item {
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                HistoryGranularity.entries.forEachIndexed { index, option ->
                    SegmentedButton(
                        selected = granularity == option,
                        onClick = {
                            granularity = option
                            prefs.edit().putString(GRANULARITY_KEY, option.name).apply()
                        },
                        shape = SegmentedButtonDefaults.itemShape(index, HistoryGranularity.entries.size),
                        label = { Text(option.label) },
                    )
                }
            }
        }

        if (expenseTransactions.isNotEmpty()) {
            item {
                SectionCard(
                    title = "Top Categories",
                    trailing = {
                        TextButton(onClick = { showCategoryFilter = !showCategoryFilter }) {
                            Icon(Icons.Filled.FilterList, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.size(4.dp))
                            Text(
                                if (hiddenCategoryIds.isEmpty()) "Filter" else "Filter (${hiddenCategoryIds.size} hidden)",
                            )
                        }
                    },
                ) {
                    if (showCategoryFilter) {
                        Row(
                            Modifier.horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            expenseCategoryOptions.forEach { option ->
                                val hidden = option.id in hiddenCategoryIds
                                FilterChip(
                                    selected = !hidden,
                                    onClick = {
                                        hiddenCategoryIds = if (hidden) {
                                            hiddenCategoryIds - option.id
                                        } else {
                                            hiddenCategoryIds + option.id
                                        }
                                    },
                                    label = { Text(option.name) },
                                )
                            }
                        }
                    }

                    if (categoryBreakdown.isEmpty()) {
                        Text(
                            if (hiddenCategoryIds.isEmpty()) "No expenses yet." else "All categories are hidden.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    } else {
                        CategorySpendingChart(
                            pieSlices = categoryPieSlices,
                            topRows = categoryTop,
                            total = categoryTotal,
                            currencyCode = baseCurrency,
                        )
                    }
                }
            }
        }

        if (!isLoading && filtered.isEmpty()) {
            item {
                EmptyState(
                    icon = Icons.AutoMirrored.Filled.ListAlt,
                    title = "Nothing here yet",
                    message = "Pull down to open Quick Add, or use the button below.",
                )
            }
        }

        groups.forEach { group ->
            val items = group.items
            item(key = "header-${group.start}") {
                HistorySectionHeader(
                    label = historyGroupLabel(group.start, granularity),
                    summary = group.summary,
                    baseCurrency = baseCurrency,
                )
            }
            item(key = "body-${group.start}") {
                SectionCard {
                    items.forEachIndexed { index, txn ->
                        if (index > 0) HorizontalDivider()
                        val isTransfer = txn.transferId != null
                        SwipeActionRow(
                            onEndAction = if (isTransfer) null else ({ pendingDelete = txn }),
                        ) {
                            TransactionRow(
                                transaction = txn,
                                categoryName = categoriesById[txn.categoryId]?.name,
                                accountName = accountsById[txn.accountId]?.name,
                                baseCurrency = baseCurrency,
                                onClick = if (isTransfer) null else ({ onEditTransaction(txn.id) }),
                            )
                        }
                    }
                }
            }
        }
    }

    pendingDelete?.let { txn ->
        ConfirmDialog(
            title = "Delete transaction?",
            message = "This removes the entry and rolls back its effect on the account balance.",
            onConfirm = {
                scope.launch {
                    try {
                        Api.delete("/cashflow/transactions/${txn.id}")
                        transactions = transactions.filterNot { it.id == txn.id }
                        reloadKey++
                    } catch (e: Exception) {
                        error = e.message ?: "Couldn't delete that."
                    }
                }
            },
            onDismiss = { pendingDelete = null },
        )
    }
}

/**
 * Section header for one day/month/year bucket: its label, plus the money that moved inside it.
 * Mirrors the web Transactions group header and iOS's `HistorySectionHeader`.
 */
@Composable
private fun HistorySectionHeader(
    label: String,
    summary: HistoryGroupSummary,
    baseCurrency: String,
) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = MaterialTheme.typography.titleSmall)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (summary.inflow > 0) {
                Text(
                    "+" + summary.inflow.currency(baseCurrency),
                    style = MaterialTheme.typography.labelLarge,
                    color = positiveColor(),
                )
            }
            if (summary.outflow > 0) {
                Text(
                    "\u2212" + summary.outflow.currency(baseCurrency),
                    style = MaterialTheme.typography.labelLarge,
                    color = negativeColor(),
                )
            }
            if (summary.showsNet) {
                Text(
                    "net " + (if (summary.net < 0) "\u2212" else "+") + abs(summary.net).currency(baseCurrency),
                    style = MaterialTheme.typography.labelLarge,
                    color = if (summary.net < 0) negativeColor() else positiveColor(),
                )
            }
            if (summary.unconverted > 0) {
                // Say so rather than quietly reporting a total that's missing rows.
                Text(
                    "partial",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
