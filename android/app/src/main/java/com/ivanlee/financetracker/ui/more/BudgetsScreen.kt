package com.ivanlee.financetracker.ui.more

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Savings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ivanlee.financetracker.data.model.BudgetCreate
import com.ivanlee.financetracker.data.model.BudgetPeriod
import com.ivanlee.financetracker.data.model.BudgetResponse
import com.ivanlee.financetracker.data.model.BudgetStatusResponse
import com.ivanlee.financetracker.data.model.BudgetStatusRow
import com.ivanlee.financetracker.data.model.BudgetUpdate
import com.ivanlee.financetracker.data.model.CategoryResponse
import com.ivanlee.financetracker.data.model.EmergencyFundResponse
import com.ivanlee.financetracker.data.model.TransactionType
import com.ivanlee.financetracker.data.net.Api
import com.ivanlee.financetracker.logic.BudgetPresentation
import com.ivanlee.financetracker.logic.BudgetTone
import com.ivanlee.financetracker.logic.RunwayTone
import com.ivanlee.financetracker.logic.currency
import com.ivanlee.financetracker.logic.currencyWhole
import com.ivanlee.financetracker.state.SessionViewModel
import com.ivanlee.financetracker.ui.components.ConfirmDialog
import com.ivanlee.financetracker.ui.components.DetailScaffold
import com.ivanlee.financetracker.ui.components.EmptyState
import com.ivanlee.financetracker.ui.components.FormField
import com.ivanlee.financetracker.ui.components.MoneyField
import com.ivanlee.financetracker.ui.components.PrivateBadge
import com.ivanlee.financetracker.ui.components.SectionCard
import com.ivanlee.financetracker.ui.components.SegmentedChoice
import com.ivanlee.financetracker.ui.components.SwipeActionRow
import com.ivanlee.financetracker.ui.theme.negativeColor
import com.ivanlee.financetracker.ui.theme.positiveColor
import com.ivanlee.financetracker.ui.theme.warningColor
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

/**
 * Budgets and the emergency fund.
 *
 * Both readouts come from the backend, and both deliberately exclude things that would
 * otherwise lie: budgets and the runway skip transfers (moving your own money between your
 * own accounts is not spending), and the burn rate additionally skips the app's own system
 * categories — a stock purchase filed under "Investment" would otherwise roughly double the
 * emergency fund you're told to hold.
 */
@Composable
fun BudgetsScreen(
    sessionVm: SessionViewModel,
    onBack: () -> Unit,
) {
    var status by remember { mutableStateOf<BudgetStatusResponse?>(null) }
    var fund by remember { mutableStateOf<EmergencyFundResponse?>(null) }
    var budgets by remember { mutableStateOf<List<BudgetResponse>>(emptyList()) }
    var categories by remember { mutableStateOf<List<CategoryResponse>>(emptyList()) }
    var editing by remember { mutableStateOf<BudgetResponse?>(null) }
    var creating by remember { mutableStateOf(false) }
    var pendingDelete by remember { mutableStateOf<BudgetStatusRow?>(null) }
    var editingTarget by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var reloadKey by remember { mutableStateOf(0) }
    val scope = rememberCoroutineScope()

    val household = sessionVm.activeHousehold
    val baseCurrency = household?.baseCurrency ?: "USD"

    LaunchedEffect(household?.id, reloadKey) {
        val h = household ?: return@LaunchedEffect
        try {
            coroutineScope {
                val s = async { Api.get<BudgetStatusResponse>("/cashflow/budgets/household/${h.id}/status") }
                val f = async { Api.get<EmergencyFundResponse>("/cashflow/household/${h.id}/emergency-fund") }
                val b = async { Api.get<List<BudgetResponse>>("/cashflow/budgets/household/${h.id}") }
                val c = async { Api.get<List<CategoryResponse>>("/cashflow/categories/household/${h.id}") }
                status = s.await()
                fund = f.await()
                budgets = b.await()
                categories = c.await()
            }
        } catch (e: Exception) {
            error = e.message ?: "Couldn't load budgets."
        }
    }

    DetailScaffold(
        title = "Budgets",
        onBack = onBack,
        error = error,
        onErrorShown = { error = null },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = { creating = true },
                icon = { Icon(Icons.Filled.Add, contentDescription = null) },
                text = { Text("Budget") },
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
            fund?.let { f ->
                item {
                    SectionCard(
                        title = "Emergency fund",
                        trailing = { TextButton(onClick = { editingTarget = true }) { Text("Target") } },
                    ) {
                        val tone = BudgetPresentation.runwayTone(f)
                        Text(
                            BudgetPresentation.runwayLabel(f),
                            style = MaterialTheme.typography.headlineMedium,
                            fontWeight = FontWeight.Bold,
                            color = when (tone) {
                                RunwayTone.CRITICAL -> negativeColor()
                                RunwayTone.LOW -> warningColor()
                                RunwayTone.OK -> positiveColor()
                                RunwayTone.UNKNOWN -> MaterialTheme.colorScheme.onSurfaceVariant
                            },
                        )
                        LinearProgressIndicator(
                            progress = { BudgetPresentation.runwayFraction(f) },
                            modifier = Modifier.fillMaxWidth(),
                        )
                        Text(
                            "${f.liquidTotal.currencyWhole(baseCurrency)} liquid · target " +
                                "${f.targetMonths.toInt()} months (${f.targetAmount.currencyWhole(baseCurrency)})",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        if (f.shortfall > 0) {
                            Text(
                                "${f.shortfall.currencyWhole(baseCurrency)} short",
                                style = MaterialTheme.typography.bodySmall,
                                color = warningColor(),
                            )
                        }
                        Text(
                            "Counts only liquid asset accounts — investments, retirement and property " +
                                "are deliberately excluded.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }

            val rows = status?.budgets.orEmpty()
            if (rows.isEmpty()) {
                item {
                    EmptyState(
                        icon = Icons.Filled.Savings,
                        title = "No budgets yet",
                        message = "Set a monthly cap on a category and we'll warn you when your pace " +
                            "would blow it — not after you already have.",
                    )
                }
            } else {
                item {
                    SectionCard(title = "Budgets") {
                        rows.forEachIndexed { index, row ->
                            if (index > 0) HorizontalDivider()
                            SwipeActionRow(onEndAction = { pendingDelete = row }) {
                                BudgetRow(
                                    row = row,
                                    currencyCode = baseCurrency,
                                    onClick = { editing = budgets.firstOrNull { it.id == row.budgetId } },
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    if (creating || editing != null) {
        val takenCategoryIds = remember(status) {
            status?.budgets.orEmpty().flatMap { it.categoryIds }.toSet()
        }
        BudgetFormDialog(
            existing = editing,
            householdId = household?.id.orEmpty(),
            allCategories = categories,
            takenCategoryIds = takenCategoryIds,
            currencyCode = baseCurrency,
            defaultPrivate = sessionVm.user?.defaultsNewItemsPrivate ?: false,
            userId = sessionVm.user?.id,
            onDismiss = { creating = false; editing = null },
            onSaved = { reloadKey++ },
        )
    }

    if (editingTarget && fund != null) {
        var months by remember { mutableStateOf(fund!!.targetMonths.toInt().toString()) }
        AlertDialog(
            onDismissRequest = { editingTarget = false },
            title = { Text("Emergency fund target") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    FormField(
                        "Months of expenses", months, { months = it.filter(Char::isDigit) },
                        keyboardType = androidx.compose.ui.text.input.KeyboardType.Number,
                    )
                    Text(
                        "How many months of spending you want held in liquid cash.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    val value = months.toDoubleOrNull()
                    val id = household?.id
                    editingTarget = false
                    if (value != null && id != null) {
                        scope.launch {
                            try {
                                sessionVm.updateHousehold(id, emergencyFundTargetMonths = value)
                                reloadKey++
                            } catch (e: Exception) {
                                error = e.message ?: "Couldn't save that target."
                            }
                        }
                    }
                }) { Text("Save") }
            },
            dismissButton = { TextButton(onClick = { editingTarget = false }) { Text("Cancel") } },
        )
    }

    pendingDelete?.let { row ->
        ConfirmDialog(
            title = "Delete the ${row.categoryNames.joinToString(", ")} budget?",
            message = "Your transactions are untouched — only the cap goes away.",
            onConfirm = {
                scope.launch {
                    try {
                        Api.delete("/cashflow/budgets/${row.budgetId}")
                        reloadKey++
                    } catch (e: Exception) {
                        error = e.message ?: "Couldn't delete that budget."
                    }
                }
            },
            onDismiss = { pendingDelete = null },
        )
    }
}

/**
 * One budget: spend against limit, plus a pace marker showing how far through the period we
 * are. The marker is the point — a bar at 60% on the 10th means something very different from
 * the same bar on the 28th.
 */
@Composable
private fun BudgetRow(
    row: BudgetStatusRow,
    currencyCode: String,
    onClick: () -> Unit,
) {
    val tone = BudgetPresentation.tone(row)
    val barColor = when (tone) {
        BudgetTone.OVER -> negativeColor()
        BudgetTone.AT_RISK -> warningColor()
        BudgetTone.OK -> positiveColor()
    }
    Column(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(row.categoryNames.joinToString(", "), style = MaterialTheme.typography.bodyLarge)
                if (row.isPrivate) PrivateBadge()
            }
            Text(
                "${row.spent.currency(currencyCode)} / ${row.limit.currencyWhole(currencyCode)}",
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
            )
        }

        Box(Modifier.fillMaxWidth().height(10.dp)) {
            LinearProgressIndicator(
                progress = { BudgetPresentation.barFraction(row) },
                modifier = Modifier.fillMaxSize(),
                color = barColor,
            )
            val elapsed = BudgetPresentation.elapsedFraction(row)
            val markerColor = MaterialTheme.colorScheme.onSurface
            Canvas(Modifier.fillMaxSize()) {
                val x = size.width * elapsed
                drawLine(markerColor, Offset(x, 0f), Offset(x, size.height), strokeWidth = 2.dp.toPx())
            }
        }

        Text(
            buildString {
                append(tone.label)
                append(" · ")
                append("${row.daysElapsed}/${row.daysTotal} days")
                if (tone != BudgetTone.OVER) {
                    append(" · projected ${row.projectedSpend.currencyWhole(currencyCode)}")
                }
                append(" · ${row.period.label}")
            },
            style = MaterialTheme.typography.bodySmall,
            color = when (tone) {
                BudgetTone.OVER -> negativeColor()
                BudgetTone.AT_RISK -> warningColor()
                BudgetTone.OK -> MaterialTheme.colorScheme.onSurfaceVariant
            },
        )
    }
}

@Composable
private fun BudgetFormDialog(
    existing: BudgetResponse?,
    householdId: String,
    allCategories: List<CategoryResponse>,
    takenCategoryIds: Set<String>,
    currencyCode: String,
    defaultPrivate: Boolean,
    userId: String?,
    onDismiss: () -> Unit,
    onSaved: () -> Unit,
) {
    // A category can only belong to one budget, so the picker excludes categories already
    // taken by another budget — but never hides the ones this budget itself already owns.
    val ownCategoryIds = existing?.categoryIds.orEmpty().toSet()
    val selectableCategories = remember(allCategories, takenCategoryIds, ownCategoryIds) {
        allCategories.filter {
            it.type == TransactionType.EXPENSE && (it.id !in takenCategoryIds || it.id in ownCategoryIds)
        }
    }
    val categoryNamesById = remember(allCategories) { allCategories.associateBy({ it.id }, { it.name }) }

    var categoryIds by remember { mutableStateOf(ownCategoryIds) }
    var amountText by remember { mutableStateOf(existing?.amount?.toString().orEmpty()) }
    var period by remember { mutableStateOf(existing?.period ?: BudgetPeriod.MONTHLY) }
    var isPrivate by remember { mutableStateOf(existing?.ownerUserId != null || (existing == null && defaultPrivate)) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    val amount = amountText.replace(",", "").toDoubleOrNull()

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (existing == null) "New budget" else "Edit budget") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Categories", style = MaterialTheme.typography.labelLarge)
                if (existing == null) {
                    if (selectableCategories.isEmpty()) {
                        Text(
                            "No expense categories left to budget.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    } else {
                        Column(
                            Modifier
                                .fillMaxWidth()
                                .heightIn(max = 220.dp)
                                .verticalScroll(rememberScrollState()),
                        ) {
                            selectableCategories.forEach { category ->
                                val checked = categoryIds.contains(category.id)
                                Row(
                                    Modifier
                                        .fillMaxWidth()
                                        .clickable {
                                            categoryIds = if (checked) categoryIds - category.id else categoryIds + category.id
                                        }
                                        .padding(vertical = 4.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    Checkbox(checked = checked, onCheckedChange = null)
                                    Text(category.name)
                                }
                            }
                        }
                    }
                } else {
                    Text(
                        categoryIds.mapNotNull { categoryNamesById[it] }.joinToString(", "),
                        style = MaterialTheme.typography.bodyLarge,
                    )
                }
                MoneyField("Limit", amountText, { amountText = it }, currencyCode = currencyCode)
                SegmentedChoice(
                    options = BudgetPeriod.entries,
                    selected = period,
                    optionLabel = { it.label },
                    onSelect = { period = it },
                )
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            TextButton(
                enabled = (amount ?: 0.0) > 0 && categoryIds.isNotEmpty() && !saving,
                onClick = {
                    saving = true
                    scope.launch {
                        try {
                            if (existing == null) {
                                Api.post<BudgetCreate, BudgetResponse>(
                                    "/cashflow/budgets",
                                    BudgetCreate(
                                        householdId = householdId,
                                        categoryIds = categoryIds.toList(),
                                        amount = amount!!,
                                        period = period,
                                        ownerUserId = if (isPrivate) userId else null,
                                    ),
                                )
                            } else {
                                Api.put<BudgetUpdate, BudgetResponse>(
                                    "/cashflow/budgets/${existing.id}",
                                    BudgetUpdate(amount = amount, period = period),
                                )
                            }
                            onSaved()
                            onDismiss()
                        } catch (e: Exception) {
                            error = e.message ?: "Couldn't save that budget."
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
