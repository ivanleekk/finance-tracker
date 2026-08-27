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
import androidx.compose.material.icons.filled.Refresh
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
import androidx.compose.runtime.LaunchedEffect
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
import com.ivanlee.financetracker.logic.Reimbursements
import com.ivanlee.financetracker.logic.CategoryPeriod
import com.ivanlee.financetracker.logic.HistoryEntry
import com.ivanlee.financetracker.logic.HistoryGranularity
import com.ivanlee.financetracker.logic.HistoryGroupSummary
import com.ivanlee.financetracker.logic.NetWorthSlice
import com.ivanlee.financetracker.logic.TopCategoryFilterPrefs
import com.ivanlee.financetracker.logic.currency
import com.ivanlee.financetracker.logic.groupHistory
import com.ivanlee.financetracker.logic.historyGroupLabel
import com.ivanlee.financetracker.logic.homeValue
import com.ivanlee.financetracker.logic.range
import com.ivanlee.financetracker.state.QuickAddViewModel
import com.ivanlee.financetracker.state.SessionViewModel
import com.ivanlee.financetracker.state.TopCategoryFilterStore
import com.ivanlee.financetracker.state.ViewModeViewModel
import com.ivanlee.financetracker.ui.components.CategorySpendingChart
import com.ivanlee.financetracker.ui.components.ConfirmDialog
import com.ivanlee.financetracker.ui.components.DateField
import com.ivanlee.financetracker.ui.components.DropdownField
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
import java.time.Instant
import java.time.LocalDate
import java.time.Month
import java.time.ZoneOffset
import java.time.format.TextStyle
import java.util.Locale

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
 * Month + year dropdowns for the "Specific month" period.
 *
 * A DatePicker would imply the day matters (it doesn't — only year/month are read), so this
 * offers exactly the two fields that do. UTC throughout, matching the range maths.
 */
@Composable
private fun MonthYearPicker(anchor: Instant?, onChange: (Instant) -> Unit) {
    val current = (anchor ?: Instant.now()).atZone(ZoneOffset.UTC).toLocalDate()
    val thisYear = Instant.now().atZone(ZoneOffset.UTC).toLocalDate().year
    // A decade back plus the current year — older history is rare and an unbounded list is
    // unusable in a dropdown.
    val years = (thisYear downTo thisYear - 10).toList()

    fun emit(month: Int, year: Int) {
        onChange(LocalDate.of(year, month, 1).atStartOfDay(ZoneOffset.UTC).toInstant())
    }

    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        DropdownField(
            label = "Month",
            selected = current.monthValue,
            options = (1..12).toList(),
            optionLabel = { Month.of(it).getDisplayName(TextStyle.FULL, Locale.getDefault()) },
            onSelect = { emit(it, current.year) },
            modifier = Modifier.weight(1f),
        )
        DropdownField(
            label = "Year",
            selected = current.year,
            options = years,
            optionLabel = { it.toString() },
            onSelect = { emit(current.monthValue, it) },
            modifier = Modifier.weight(1f),
        )
    }
}

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
    var categoryPeriod by remember { mutableStateOf(CategoryPeriod.ALL) }
    var categoryPeriodStart by remember { mutableStateOf<Instant?>(null) }
    var categoryPeriodEnd by remember { mutableStateOf<Instant?>(null) }

    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val userId = sessionVm.user?.id
    val householdId = sessionVm.activeHousehold?.id
    val baseCurrency = sessionVm.activeHousehold?.baseCurrency ?: "USD"

    // Restore the saved Top-Categories filter/period whenever the active household changes, so the
    // user doesn't have to re-hide the same categories every time they come back to this tab.
    var prefsLoadedFor by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(householdId) {
        val saved = householdId?.let { TopCategoryFilterStore.load(context, it) } ?: TopCategoryFilterPrefs()
        hiddenCategoryIds = saved.hiddenCategoryIds
        categoryPeriod = saved.period
        categoryPeriodStart = saved.customStart
        categoryPeriodEnd = saved.customEnd
        prefsLoadedFor = householdId
    }

    // Guarded on `prefsLoadedFor`: right after a household switch this effect still holds the
    // previous household's selections, and writing those under the new household's key would
    // clobber what the load above is in the middle of restoring.
    LaunchedEffect(householdId, prefsLoadedFor, hiddenCategoryIds, categoryPeriod, categoryPeriodStart, categoryPeriodEnd) {
        if (householdId != null && prefsLoadedFor == householdId) {
            TopCategoryFilterStore.save(
                context,
                householdId,
                TopCategoryFilterPrefs(hiddenCategoryIds, categoryPeriod, categoryPeriodStart, categoryPeriodEnd),
            )
        }
    }

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

    // Whether the card is shown at all. Deliberately ignores the period: gating on the *scoped*
    // list would make the whole card vanish the moment a period had no spending, taking the period
    // picker with it and stranding the user with no way back.
    val hasAnyExpenses = transactions.any {
        it.transactionType == TransactionType.EXPENSE && it.accountId in visibleAccountIds
    }

    // Scoped to the selected period; the Activity list underneath is deliberately *not*, so the
    // card can answer "what did I spend last month" without hiding the history.
    val categoryRange = categoryPeriod.range(categoryPeriodStart, categoryPeriodEnd)
    val expenseTransactions = transactions.filter {
        it.transactionType == TransactionType.EXPENSE &&
            it.accountId in visibleAccountIds &&
            (categoryRange == null || it.date in categoryRange) &&
            // Transfers and settlements are cash leaving an account without being spending: you
            // still have the money, or the bill was already charged when it was paid.
            Reimbursements.countsAsSpending(
                categoriesById[it.categoryId]?.name,
                isTransfer = it.transferId != null,
            )
    }

    // Every expense category that's shown up in the selected period, used to populate the filter
    // chips (independent of `hiddenCategoryIds`, so a hidden chip stays visible to re-enable).
    val expenseCategoryOptions = expenseTransactions
        .distinctBy { it.categoryId }
        .map { CategoryOption(it.categoryId, categoriesById[it.categoryId]?.name ?: "Uncategorized") }
        .sortedBy { it.name }

    // Stable category -> color index, derived from the household's full id-sorted expense-category
    // list rather than the filtered render order, so a category keeps its color no matter which
    // chips are hidden or which period is selected. Buckets that aren't a real category (the
    // "Other" rollup slice, "Uncategorized") fall through to the neutral default in the chart.
    val categoryColorIndex = categories
        .filter { it.type == TransactionType.EXPENSE }
        .sortedBy { it.id }
        .withIndex()
        .associate { (index, category) -> category.id to index }

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

        if (hasAnyExpenses) {
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
                    DropdownField(
                        label = "Period",
                        selected = categoryPeriod,
                        options = CategoryPeriod.entries,
                        optionLabel = { it.label },
                        onSelect = { period ->
                            categoryPeriod = period
                            // Seed an anchor when switching to a case that needs one — without it
                            // the range is unbounded, so the card would silently show all time
                            // under a label that says otherwise.
                            if (period.usesCustomStart && categoryPeriodStart == null) {
                                categoryPeriodStart = Instant.now()
                            }
                        },
                    )

                    if (categoryPeriod == CategoryPeriod.SPECIFIC_MONTH) {
                        MonthYearPicker(categoryPeriodStart) { categoryPeriodStart = it }
                    }

                    if (categoryPeriod == CategoryPeriod.CUSTOM) {
                        DateField("From", categoryPeriodStart ?: Instant.now()) { categoryPeriodStart = it }
                        DateField("To", categoryPeriodEnd ?: Instant.now()) { categoryPeriodEnd = it }
                    }

                    if (showCategoryFilter) {
                        if (expenseCategoryOptions.isEmpty()) {
                            Text(
                                "No expense categories in this period.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        } else {
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
                                // Clears every hidden category at once — re-toggling a dozen chips
                                // by hand to get back to the full picture is the tedium this
                                // exists to remove.
                                if (hiddenCategoryIds.isNotEmpty()) {
                                    TextButton(onClick = { hiddenCategoryIds = emptySet() }) {
                                        Icon(
                                            Icons.Filled.Refresh,
                                            contentDescription = null,
                                            modifier = Modifier.size(16.dp),
                                        )
                                        Spacer(Modifier.size(4.dp))
                                        Text("Reset")
                                    }
                                }
                            }
                        }
                    }

                    if (categoryBreakdown.isEmpty()) {
                        Text(
                            if (hiddenCategoryIds.isEmpty()) {
                                "No expenses in this period."
                            } else {
                                "All categories are hidden."
                            },
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    } else {
                        CategorySpendingChart(
                            pieSlices = categoryPieSlices,
                            topRows = categoryTop,
                            total = categoryTotal,
                            currencyCode = baseCurrency,
                            colorIndexFor = { categoryColorIndex[it] },
                        )
                    }
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
