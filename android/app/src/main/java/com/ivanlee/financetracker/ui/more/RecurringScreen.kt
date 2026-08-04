package com.ivanlee.financetracker.ui.more

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Autorenew
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import com.ivanlee.financetracker.data.model.AccountResponse
import com.ivanlee.financetracker.data.model.CategoryResponse
import com.ivanlee.financetracker.data.model.RecurrenceFrequency
import com.ivanlee.financetracker.data.model.RecurringRunResponse
import com.ivanlee.financetracker.data.model.RecurringTransactionCreate
import com.ivanlee.financetracker.data.model.RecurringTransactionResponse
import com.ivanlee.financetracker.data.model.RecurringTransactionUpdate
import com.ivanlee.financetracker.data.model.TransactionType
import com.ivanlee.financetracker.data.model.UpcomingOccurrence
import com.ivanlee.financetracker.data.net.Api
import com.ivanlee.financetracker.data.net.apiDateOnly
import com.ivanlee.financetracker.logic.BudgetPresentation
import com.ivanlee.financetracker.logic.currency
import com.ivanlee.financetracker.logic.currencyWhole
import com.ivanlee.financetracker.logic.mediumDate
import com.ivanlee.financetracker.state.SessionViewModel
import com.ivanlee.financetracker.ui.components.AdaptiveStatGrid
import com.ivanlee.financetracker.ui.components.ConfirmDialog
import com.ivanlee.financetracker.ui.components.DateField
import com.ivanlee.financetracker.ui.components.DetailScaffold
import com.ivanlee.financetracker.ui.components.DropdownField
import com.ivanlee.financetracker.ui.components.EmptyState
import com.ivanlee.financetracker.ui.components.FormField
import com.ivanlee.financetracker.ui.components.MoneyField
import com.ivanlee.financetracker.ui.components.SectionCard
import com.ivanlee.financetracker.ui.components.StatTileData
import com.ivanlee.financetracker.ui.components.SwipeActionRow
import com.ivanlee.financetracker.ui.theme.negativeColor
import com.ivanlee.financetracker.ui.theme.positiveColor
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import java.time.Instant
import com.ivanlee.financetracker.ui.components.cardListItemColors

/**
 * Recurring transaction rules, the normalized monthly commitment they add up to, and a
 * 90-day agenda of what they'll post.
 *
 * "Post due now" exists because the nightly job already does this — the button is for when
 * you don't want to wait until tomorrow to see a rent payment land, not because anything
 * would otherwise be missed.
 */
@Composable
fun RecurringScreen(
    sessionVm: SessionViewModel,
    onBack: () -> Unit,
) {
    var rules by remember { mutableStateOf<List<RecurringTransactionResponse>>(emptyList()) }
    var upcoming by remember { mutableStateOf<List<UpcomingOccurrence>>(emptyList()) }
    var categories by remember { mutableStateOf<List<CategoryResponse>>(emptyList()) }
    var accounts by remember { mutableStateOf<List<AccountResponse>>(emptyList()) }
    var editing by remember { mutableStateOf<RecurringTransactionResponse?>(null) }
    var creating by remember { mutableStateOf(false) }
    var pendingDelete by remember { mutableStateOf<RecurringTransactionResponse?>(null) }
    // ConfirmDialog dismisses itself the instant Delete is tapped, before the network call
    // even starts — this is what shows "in flight" on the row itself in the meantime, so a
    // slow delete doesn't look like nothing happened.
    var deletingId by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var reloadKey by remember { mutableStateOf(0) }
    val scope = rememberCoroutineScope()

    val household = sessionVm.activeHousehold
    val baseCurrency = household?.baseCurrency ?: "USD"

    LaunchedEffect(household?.id, reloadKey) {
        val h = household ?: return@LaunchedEffect
        try {
            coroutineScope {
                val r = async { Api.get<List<RecurringTransactionResponse>>("/cashflow/recurring/household/${h.id}") }
                val u = async {
                    Api.get<List<UpcomingOccurrence>>("/cashflow/recurring/household/${h.id}/upcoming?days=90")
                }
                val c = async { Api.get<List<CategoryResponse>>("/cashflow/categories/household/${h.id}") }
                val a = async { Api.get<List<AccountResponse>>("/accounts/household/${h.id}") }
                rules = r.await()
                upcoming = u.await()
                categories = c.await()
                accounts = a.await()
            }
        } catch (e: Exception) {
            error = e.message ?: "Couldn't load recurring rules."
        }
    }

    val categoryTypes = categories.associate { it.id to it.type }
    val commitment = BudgetPresentation.monthlyCommitment(rules, categoryTypes)
    val agenda = BudgetPresentation.groupedByMonth(upcoming)

    DetailScaffold(
        title = "Recurring",
        onBack = onBack,
        error = error,
        onErrorShown = { error = null },
        actions = {
            TextButton(onClick = {
                val id = household?.id ?: return@TextButton
                scope.launch {
                    try {
                        val result = Api.postEmpty<RecurringRunResponse>("/cashflow/recurring/household/$id/run")
                        notice = "Posted ${result.posted} transaction${if (result.posted == 1) "" else "s"}."
                        reloadKey++
                    } catch (e: Exception) {
                        error = e.message ?: "Couldn't post due transactions."
                    }
                }
            }) { Text("Post due") }
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = { creating = true },
                icon = { Icon(Icons.Filled.Add, contentDescription = null) },
                text = { Text("Rule") },
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
            item {
                SectionCard(title = "Monthly commitment") {
                    AdaptiveStatGrid(
                        listOf(
                            StatTileData("Income", commitment.income.currencyWhole(baseCurrency), signal = 1.0),
                            StatTileData("Expenses", commitment.expense.currencyWhole(baseCurrency), signal = -1.0),
                            StatTileData("Net", commitment.net.currencyWhole(baseCurrency), signal = commitment.net),
                        )
                    )
                    Text(
                        "Rules of every cadence normalized to a per-month figure, so weekly and " +
                            "yearly commitments are comparable.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    notice?.let { Text(it, color = MaterialTheme.colorScheme.primary) }
                }
            }

            if (rules.isEmpty()) {
                item {
                    EmptyState(
                        icon = Icons.Filled.Autorenew,
                        title = "No recurring rules",
                        message = "Add rent, salary or a subscription once and it posts itself.",
                    )
                }
            } else {
                item {
                    SectionCard(title = "Rules") {
                        rules.sortedBy { it.nextDueDate }.forEachIndexed { index, rule ->
                            if (index > 0) HorizontalDivider()
                            val isDeletingThisRule = deletingId == rule.id
                            val requestDelete: () -> Unit = { pendingDelete = rule }
                            val toggleActive: () -> Unit = {
                                scope.launch {
                                    try {
                                        Api.put<RecurringTransactionUpdate, RecurringTransactionResponse>(
                                            "/cashflow/recurring/${rule.id}",
                                            RecurringTransactionUpdate(isActive = !rule.isActive),
                                        )
                                        reloadKey++
                                    } catch (e: Exception) {
                                        error = e.message ?: "Couldn't update that rule."
                                    }
                                }
                            }
                            SwipeActionRow(
                                onEndAction = if (isDeletingThisRule) null else requestDelete,
                                onStartAction = if (isDeletingThisRule) null else toggleActive,
                                startIcon = if (rule.isActive) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                                startLabel = if (rule.isActive) "Pause" else "Resume",
                            ) {
                                val isIncome = categoryTypes[rule.categoryId] == TransactionType.INCOME
                                ListItem(
                                    colors = cardListItemColors(),
                                    headlineContent = {
                                        Text(
                                            rule.description?.takeIf { it.isNotBlank() }
                                                ?: categories.firstOrNull { it.id == rule.categoryId }?.name
                                                ?: "Recurring",
                                            fontWeight = FontWeight.Medium,
                                        )
                                    },
                                    supportingContent = {
                                        Text(
                                            listOfNotNull(
                                                rule.frequency.label,
                                                "next ${rule.nextDueDate.mediumDate()}",
                                                accounts.firstOrNull { it.id == rule.accountId }?.name,
                                                if (!rule.isActive) "paused" else null,
                                            ).joinToString(" · "),
                                            maxLines = 2,
                                        )
                                    },
                                    trailingContent = {
                                        if (isDeletingThisRule) {
                                            CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                                        } else {
                                            Text(
                                                (if (isIncome) "+" else "−") +
                                                    rule.amount.currency(rule.currency ?: baseCurrency),
                                                style = MaterialTheme.typography.bodyMedium,
                                                color = if (isIncome) positiveColor() else MaterialTheme.colorScheme.onSurface,
                                            )
                                        }
                                    },
                                    modifier = Modifier.clickable(enabled = !isDeletingThisRule) { editing = rule },
                                )
                            }
                        }
                    }
                }
            }

            agenda.forEach { bucket ->
                item(key = "agenda-${bucket.id}") {
                    SectionCard(title = bucket.label) {
                        bucket.items.forEachIndexed { index, item ->
                            if (index > 0) HorizontalDivider()
                            val isIncome = item.transactionType == TransactionType.INCOME
                            ListItem(
                                colors = cardListItemColors(),
                                headlineContent = {
                                    Text(item.description?.takeIf { it.isNotBlank() } ?: item.categoryName)
                                },
                                supportingContent = {
                                    Text("${item.date.mediumDate()} · ${item.accountName}")
                                },
                                trailingContent = {
                                    Text(
                                        (if (isIncome) "+" else "−") +
                                            item.amount.currency(item.currency ?: baseCurrency),
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = if (isIncome) positiveColor() else negativeColor(),
                                    )
                                },
                            )
                        }
                    }
                }
            }
        }
    }

    if (creating || editing != null) {
        RecurringFormDialog(
            existing = editing,
            householdId = household?.id.orEmpty(),
            accounts = accounts,
            categories = categories,
            currencyCode = baseCurrency,
            userId = sessionVm.user?.id,
            defaultPrivate = sessionVm.user?.defaultsNewItemsPrivate ?: false,
            onDismiss = { creating = false; editing = null },
            onSaved = { reloadKey++ },
        )
    }

    pendingDelete?.let { rule ->
        ConfirmDialog(
            title = "Delete this rule?",
            // Worth stating plainly: the FK is ON DELETE SET NULL, so history survives.
            message = "Transactions it already posted stay in your history — only future " +
                "occurrences stop.",
            onConfirm = {
                scope.launch {
                    deletingId = rule.id
                    try {
                        Api.delete("/cashflow/recurring/${rule.id}")
                        reloadKey++
                    } catch (e: Exception) {
                        error = e.message ?: "Couldn't delete that rule."
                    } finally {
                        deletingId = null
                    }
                }
            },
            onDismiss = { pendingDelete = null },
        )
    }
}

@Composable
private fun RecurringFormDialog(
    existing: RecurringTransactionResponse?,
    householdId: String,
    accounts: List<AccountResponse>,
    categories: List<CategoryResponse>,
    currencyCode: String,
    userId: String?,
    defaultPrivate: Boolean,
    onDismiss: () -> Unit,
    onSaved: () -> Unit,
) {
    var amountText by remember { mutableStateOf(existing?.amount?.toString().orEmpty()) }
    var description by remember { mutableStateOf(existing?.description.orEmpty()) }
    var frequency by remember { mutableStateOf(existing?.frequency ?: RecurrenceFrequency.MONTHLY) }
    var startDate by remember { mutableStateOf(existing?.startDate ?: Instant.now()) }
    var accountId by remember { mutableStateOf(existing?.accountId ?: accounts.firstOrNull()?.id) }
    var categoryId by remember { mutableStateOf(existing?.categoryId ?: categories.firstOrNull()?.id) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    val amount = amountText.replace(",", "").toDoubleOrNull()

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (existing == null) "New recurring rule" else "Edit rule") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                MoneyField("Amount", amountText, { amountText = it }, currencyCode = currencyCode)
                FormField("Description", description, { description = it })
                DropdownField(
                    label = "Frequency",
                    selected = frequency,
                    options = RecurrenceFrequency.entries,
                    optionLabel = { it.label },
                    onSelect = { frequency = it },
                )
                DateField("Starts", startDate) { startDate = it }
                if (existing == null) {
                    DropdownField(
                        label = "Account",
                        selected = accounts.firstOrNull { it.id == accountId },
                        options = accounts,
                        optionLabel = { it.name },
                        onSelect = { accountId = it.id },
                    )
                    DropdownField(
                        label = "Category",
                        selected = categories.firstOrNull { it.id == categoryId },
                        options = categories,
                        optionLabel = { "${it.name} (${if (it.type == TransactionType.INCOME) "income" else "expense"})" },
                        onSelect = { categoryId = it.id },
                    )
                }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            TextButton(
                enabled = (amount ?: 0.0) > 0 && accountId != null && categoryId != null && !saving,
                onClick = {
                    saving = true
                    scope.launch {
                        try {
                            if (existing == null) {
                                Api.post<RecurringTransactionCreate, RecurringTransactionResponse>(
                                    "/cashflow/recurring",
                                    RecurringTransactionCreate(
                                        householdId = householdId,
                                        accountId = accountId!!,
                                        categoryId = categoryId!!,
                                        amount = amount!!,
                                        description = description.ifBlank { null },
                                        frequency = frequency,
                                        startDate = startDate.apiDateOnly(),
                                        endDate = null,
                                        ownerUserId = if (defaultPrivate) userId else null,
                                    ),
                                )
                            } else {
                                Api.put<RecurringTransactionUpdate, RecurringTransactionResponse>(
                                    "/cashflow/recurring/${existing.id}",
                                    RecurringTransactionUpdate(
                                        amount = amount,
                                        description = description,
                                        frequency = frequency,
                                        startDate = startDate.apiDateOnly(),
                                    ),
                                )
                            }
                            onSaved()
                            onDismiss()
                        } catch (e: Exception) {
                            error = e.message ?: "Couldn't save that rule."
                        } finally {
                            saving = false
                        }
                    }
                },
            ) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
