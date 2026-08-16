package com.ivanlee.financetracker.ui.transactions

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
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.ivanlee.financetracker.data.model.AccountResponse
import com.ivanlee.financetracker.data.model.CategoryResponse
import com.ivanlee.financetracker.data.model.TransactionResponse
import com.ivanlee.financetracker.data.model.TransactionType
import com.ivanlee.financetracker.data.net.Api
import com.ivanlee.financetracker.logic.NetWorthSlice
import com.ivanlee.financetracker.logic.currency
import com.ivanlee.financetracker.logic.monthYear
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
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneOffset

/** Which slice of activity the list is showing. */
private enum class TxnFilter(val label: String) {
    ALL("All"),
    EXPENSE("Expenses"),
    INCOME("Income"),
    TRANSFERS("Transfers"),
}

private data class CategoryOption(val id: String, val name: String)

/**
 * The Activity tab: every transaction, newest first, grouped by month.
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

    // Grouped in UTC, matching how the backend means these dates — a local-time grouping
    // would push month-end transactions into the wrong month for anyone west of Greenwich.
    val byMonth = filtered.groupBy {
        it.date.atZone(ZoneOffset.UTC).toLocalDate().withDayOfMonth(1).atStartOfDay(ZoneOffset.UTC).toInstant()
    }.toList().sortedByDescending { it.first }

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

        byMonth.forEach { (month, items) ->
            item(key = "header-$month") {
                val net = items.sumOf {
                    when {
                        it.transferId != null -> 0.0
                        it.transactionType == TransactionType.INCOME -> it.amountHomeCurrency ?: it.amount
                        else -> -(it.amountHomeCurrency ?: it.amount)
                    }
                }
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(month.monthYear(), style = MaterialTheme.typography.titleSmall)
                    Text(
                        net.currency(baseCurrency),
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            item(key = "body-$month") {
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
