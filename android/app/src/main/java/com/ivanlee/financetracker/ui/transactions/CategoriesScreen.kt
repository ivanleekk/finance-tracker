package com.ivanlee.financetracker.ui.transactions

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Category
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
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
import androidx.compose.ui.unit.dp
import com.ivanlee.financetracker.data.model.CategoryCreate
import com.ivanlee.financetracker.data.model.CategoryResponse
import com.ivanlee.financetracker.data.model.CategoryUpdate
import com.ivanlee.financetracker.data.model.TransactionType
import com.ivanlee.financetracker.data.net.Api
import com.ivanlee.financetracker.ui.components.ConfirmDialog
import com.ivanlee.financetracker.ui.components.DetailScaffold
import com.ivanlee.financetracker.ui.components.EmptyState
import com.ivanlee.financetracker.ui.components.FormField
import com.ivanlee.financetracker.ui.components.SectionCard
import com.ivanlee.financetracker.ui.components.SegmentedChoice
import com.ivanlee.financetracker.ui.components.SwipeActionRow
import kotlinx.coroutines.launch
import com.ivanlee.financetracker.ui.components.cardListItemColors

/** Category CRUD, grouped by direction. Reached from Activity ▸ Categories and from More. */
@Composable
fun CategoriesScreen(
    householdId: String,
    onBack: () -> Unit,
) {
    var categories by remember { mutableStateOf<List<CategoryResponse>>(emptyList()) }
    var editing by remember { mutableStateOf<CategoryResponse?>(null) }
    var creating by remember { mutableStateOf(false) }
    var pendingDelete by remember { mutableStateOf<CategoryResponse?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    suspend fun load() {
        categories = runCatching {
            Api.get<List<CategoryResponse>>("/cashflow/categories/household/$householdId")
        }.getOrDefault(emptyList())
    }

    LaunchedEffect(householdId) { load() }

    DetailScaffold(
        title = "Categories",
        onBack = onBack,
        error = error,
        onErrorShown = { error = null },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = { creating = true },
                icon = { Icon(Icons.Filled.Add, contentDescription = null) },
                text = { Text("Category") },
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
            if (categories.isEmpty()) {
                item {
                    EmptyState(
                        icon = Icons.Filled.Category,
                        title = "No categories yet",
                        message = "Categories decide whether an entry counts as income or spending.",
                    )
                }
            }
            listOf(TransactionType.EXPENSE, TransactionType.INCOME).forEach { type ->
                val group = categories.filter { it.type == type }.sortedBy { it.name }
                if (group.isEmpty()) return@forEach
                item(key = type.wire) {
                    SectionCard(title = if (type == TransactionType.INCOME) "Income" else "Expenses") {
                        group.forEachIndexed { index, category ->
                            if (index > 0) HorizontalDivider()
                            SwipeActionRow(onEndAction = { pendingDelete = category }) {
                                ListItem(
                                    colors = cardListItemColors(),
                                    headlineContent = { Text(category.name) },
                                    modifier = Modifier.clickable { editing = category },
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    if (creating) {
        CategoryEditDialog(
            existing = null,
            householdId = householdId,
            onDismiss = { creating = false },
            onSaved = { categories = categories + it },
        )
    }

    editing?.let { category ->
        CategoryEditDialog(
            existing = category,
            householdId = householdId,
            onDismiss = { editing = null },
            onSaved = { updated ->
                categories = categories.map { if (it.id == updated.id) updated else it }
            },
        )
    }

    pendingDelete?.let { category ->
        ConfirmDialog(
            title = "Delete “${category.name}”?",
            // The backend answers 409 (not 500) when a recurring rule still points at this
            // category — surfacing that message is more useful than a generic failure.
            message = "Transactions already filed under it keep their history. " +
                "If a recurring rule still uses it, the delete will be refused.",
            onConfirm = {
                scope.launch {
                    try {
                        Api.delete("/cashflow/categories/${category.id}")
                        categories = categories.filterNot { it.id == category.id }
                    } catch (e: Exception) {
                        error = e.message ?: "Couldn't delete that category."
                    }
                }
            },
            onDismiss = { pendingDelete = null },
        )
    }
}

/**
 * Create or rename a category.
 *
 * @param lockedType when set, the direction is fixed and the switch is hidden — used from
 *   Quick Add, where the mode already decided whether this is income or spending.
 */
@Composable
fun CategoryEditDialog(
    existing: CategoryResponse?,
    householdId: String,
    lockedType: TransactionType? = null,
    onDismiss: () -> Unit,
    onSaved: (CategoryResponse) -> Unit,
) {
    var name by remember { mutableStateOf(existing?.name.orEmpty()) }
    var type by remember { mutableStateOf(existing?.type ?: lockedType ?: TransactionType.EXPENSE) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (existing == null) "New category" else "Edit category") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                FormField("Name", name, { name = it })
                if (lockedType == null) {
                    SegmentedChoice(
                        options = listOf(TransactionType.EXPENSE, TransactionType.INCOME),
                        selected = type,
                        optionLabel = { if (it == TransactionType.INCOME) "Income" else "Expense" },
                        onSelect = { type = it },
                    )
                }
                error?.let {
                    Text(it, color = androidx.compose.material3.MaterialTheme.colorScheme.error)
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = name.isNotBlank() && !saving,
                onClick = {
                    saving = true
                    error = null
                    scope.launch {
                        try {
                            val saved = if (existing == null) {
                                Api.post<CategoryCreate, CategoryResponse>(
                                    "/cashflow/categories",
                                    CategoryCreate(householdId, name.trim(), type),
                                )
                            } else {
                                Api.put<CategoryUpdate, CategoryResponse>(
                                    "/cashflow/categories/${existing.id}",
                                    CategoryUpdate(name.trim(), type),
                                )
                            }
                            onSaved(saved)
                            onDismiss()
                        } catch (e: Exception) {
                            error = e.message ?: "Couldn't save that."
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
