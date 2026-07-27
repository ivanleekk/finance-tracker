package com.ivanlee.financetracker.ui.transactions

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddCircleOutline
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
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
import androidx.compose.ui.unit.dp
import com.ivanlee.financetracker.data.model.AccountResponse
import com.ivanlee.financetracker.data.model.CategoryResponse
import com.ivanlee.financetracker.data.model.TransactionCreate
import com.ivanlee.financetracker.data.model.TransactionResponse
import com.ivanlee.financetracker.data.model.TransactionType
import com.ivanlee.financetracker.data.model.TransactionUpdate
import com.ivanlee.financetracker.data.net.Api
import com.ivanlee.financetracker.state.SessionViewModel
import com.ivanlee.financetracker.ui.components.DateField
import com.ivanlee.financetracker.ui.components.DetailScaffold
import com.ivanlee.financetracker.ui.components.DropdownField
import com.ivanlee.financetracker.ui.components.FormField
import com.ivanlee.financetracker.ui.components.MoneyField
import com.ivanlee.financetracker.ui.components.SectionCard
import com.ivanlee.financetracker.ui.components.SegmentedChoice
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import java.time.Instant

/**
 * Create or edit one transaction.
 *
 * There's no income/expense switch on the *amount*: direction comes entirely from the chosen
 * category's type, which is how the backend models it. The segmented control here just filters
 * the category list.
 */
@Composable
fun TransactionFormScreen(
    transactionId: String?,
    sessionVm: SessionViewModel,
    onBack: () -> Unit,
    onSaved: () -> Unit,
) {
    var accounts by remember { mutableStateOf<List<AccountResponse>>(emptyList()) }
    var categories by remember { mutableStateOf<List<CategoryResponse>>(emptyList()) }
    var existing by remember { mutableStateOf<TransactionResponse?>(null) }

    var type by remember { mutableStateOf(TransactionType.EXPENSE) }
    var amountText by remember { mutableStateOf("") }
    var date by remember { mutableStateOf(Instant.now()) }
    var description by remember { mutableStateOf("") }
    var accountId by remember { mutableStateOf<String?>(null) }
    var categoryId by remember { mutableStateOf<String?>(null) }
    var showNewCategory by remember { mutableStateOf(false) }

    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(transactionId, sessionVm.activeHousehold?.id) {
        val h = sessionVm.activeHousehold ?: return@LaunchedEffect
        try {
            coroutineScope {
                val a = async { Api.get<List<AccountResponse>>("/accounts/household/${h.id}") }
                val c = async { Api.get<List<CategoryResponse>>("/cashflow/categories/household/${h.id}") }
                accounts = a.await()
                categories = c.await()
            }
            if (transactionId != null) {
                // Transactions are only listed per household — no single-transaction GET.
                val txn = Api.get<List<TransactionResponse>>("/cashflow/transactions/household/${h.id}")
                    .firstOrNull { it.id == transactionId } ?: return@LaunchedEffect
                existing = txn
                type = txn.transactionType
                amountText = txn.amount.toString()
                date = txn.date
                description = txn.description.orEmpty()
                accountId = txn.accountId
                categoryId = txn.categoryId
            } else {
                accountId = accounts.firstOrNull { it.id == sessionVm.user?.defaultAccountId }?.id
                    ?: accounts.firstOrNull { it.id == h.defaultFundingAccountId }?.id
                    ?: accounts.firstOrNull()?.id
            }
        } catch (e: Exception) {
            error = e.message ?: "Couldn't load the form."
        }
    }

    val filteredCategories = categories.filter { it.type == type }
    LaunchedEffect(type, categories) {
        if (categoryId == null || filteredCategories.none { it.id == categoryId }) {
            categoryId = filteredCategories.firstOrNull()?.id
        }
    }

    val amount = amountText.replace(",", "").toDoubleOrNull()
    val canSave = (amount ?: 0.0) > 0 && accountId != null && categoryId != null && !saving
    val selectedCurrency = accounts.firstOrNull { it.id == accountId }?.currency
        ?: sessionVm.activeHousehold?.baseCurrency

    fun save() {
        if (!canSave) return
        saving = true
        error = null
        scope.launch {
            try {
                val current = existing
                if (current != null) {
                    Api.put<TransactionUpdate, TransactionResponse>(
                        "/cashflow/transactions/${current.id}",
                        TransactionUpdate(
                            date = date,
                            amount = amount!!,
                            // Always sent — an empty string is how you clear a description.
                            description = description,
                            accountId = accountId!!,
                            categoryId = categoryId!!,
                        ),
                    )
                } else {
                    Api.post<TransactionCreate, TransactionResponse>(
                        "/cashflow/transactions",
                        TransactionCreate(
                            date = date,
                            amount = amount!!,
                            description = description.ifBlank { null },
                            accountId = accountId!!,
                            categoryId = categoryId!!,
                        ),
                    )
                }
                onSaved()
            } catch (e: Exception) {
                error = e.message ?: "Couldn't save that."
            } finally {
                saving = false
            }
        }
    }

    DetailScaffold(
        title = if (existing == null) "New transaction" else "Edit transaction",
        onBack = onBack,
        error = error,
        onErrorShown = { error = null },
        actions = { TextButton(onClick = ::save, enabled = canSave) { Text("Save") } },
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            SectionCard {
                SegmentedChoice(
                    options = listOf(TransactionType.EXPENSE, TransactionType.INCOME),
                    selected = type,
                    optionLabel = { if (it == TransactionType.INCOME) "Income" else "Expense" },
                    onSelect = { type = it },
                )
                MoneyField("Amount", amountText, { amountText = it }, currencyCode = selectedCurrency)
                DateField("Date", date) { date = it }
                FormField("Description (optional)", description, { description = it })
            }

            SectionCard {
                DropdownField(
                    label = "Account",
                    selected = accounts.firstOrNull { it.id == accountId },
                    options = accounts,
                    optionLabel = { it.name },
                    onSelect = { accountId = it.id },
                )
                DropdownField(
                    label = "Category",
                    selected = filteredCategories.firstOrNull { it.id == categoryId },
                    options = filteredCategories,
                    optionLabel = { it.name },
                    onSelect = { categoryId = it.id },
                )
                TextButton(onClick = { showNewCategory = true }) {
                    Icon(Icons.Filled.AddCircleOutline, contentDescription = null)
                    Text("  New category")
                }
                Text(
                    "Whether this counts as income or spending follows the category.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Button(onClick = ::save, enabled = canSave) {
                Text(if (saving) "Saving…" else "Save transaction")
            }
        }
    }

    val household = sessionVm.activeHousehold
    if (showNewCategory && household != null) {
        CategoryEditDialog(
            existing = null,
            householdId = household.id,
            lockedType = type,
            onDismiss = { showNewCategory = false },
            onSaved = { created ->
                categories = categories + created
                categoryId = created.id
            },
        )
    }
}
