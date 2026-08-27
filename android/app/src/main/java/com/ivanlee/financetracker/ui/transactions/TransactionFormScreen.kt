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
import com.ivanlee.financetracker.data.model.ReferenceMcc
import com.ivanlee.financetracker.data.model.TransactionCreate
import com.ivanlee.financetracker.data.model.TransactionResponse
import com.ivanlee.financetracker.data.model.TransactionType
import com.ivanlee.financetracker.data.model.SplitChange
import com.ivanlee.financetracker.data.model.TransactionUpdate
import com.ivanlee.financetracker.data.model.transactionUpdate
import com.ivanlee.financetracker.data.net.Api
import com.ivanlee.financetracker.state.SessionViewModel
import com.ivanlee.financetracker.ui.components.DateField
import com.ivanlee.financetracker.ui.components.DetailScaffold
import com.ivanlee.financetracker.ui.components.DropdownField
import com.ivanlee.financetracker.ui.components.FormField
import com.ivanlee.financetracker.ui.components.MoneyField
import com.ivanlee.financetracker.ui.components.SearchablePickerDialog
import com.ivanlee.financetracker.ui.components.SectionCard
import com.ivanlee.financetracker.ui.components.SegmentedChoice
import com.ivanlee.financetracker.ui.components.SwitchRow
import com.ivanlee.financetracker.logic.Reimbursements
import com.ivanlee.financetracker.logic.SplitAssessment
import com.ivanlee.financetracker.logic.currency
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
    // Empty means "not recorded", which is the normal case — most purchases have
    // no code the user happens to know.
    var mcc by remember { mutableStateOf("") }
    var mccs by remember { mutableStateOf<List<ReferenceMcc>>(emptyList()) }
    var showMccPicker by remember { mutableStateOf(false) }
    // Part of this bill is somebody else's. The amount above stays the full sum that leaves
    // the account — this only records whose it was.
    var splitting by remember { mutableStateOf(false) }
    var owedByText by remember { mutableStateOf("") }
    var owedAmountText by remember { mutableStateOf("") }

    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(transactionId, sessionVm.activeHousehold?.id) {
        val h = sessionVm.activeHousehold ?: return@LaunchedEffect
        try {
            coroutineScope {
                val a = async { Api.get<List<AccountResponse>>("/accounts/household/${h.id}") }
                val c = async { Api.get<List<CategoryResponse>>("/cashflow/categories/household/${h.id}") }
                // Joined to the same block rather than fetched after it: the picker is
                // reachable as soon as the form is, and a slow catalogue never delays
                // the fields that matter. Only worth asking for at all when the user
                // turned the field on. A failure leaves the picker empty rather than
                // taking the form down with it, so it carries its own catch.
                val m = async {
                    if (sessionVm.user?.recordsMerchantCodes == true) {
                        runCatching { Api.get<List<ReferenceMcc>>("/reference/mccs") }
                            .getOrDefault(emptyList())
                    } else emptyList()
                }
                accounts = a.await()
                categories = c.await()
                mccs = m.await()
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
                splitting = txn.owedBy != null && txn.owedAmount != null
                owedByText = txn.owedBy.orEmpty()
                owedAmountText = txn.owedAmount?.toString().orEmpty()
                mcc = txn.mcc.orEmpty()
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
    val selectedCurrency = accounts.firstOrNull { it.id == accountId }?.currency
        ?: sessionVm.activeHousehold?.baseCurrency

    val owedAmount = Reimbursements.parseMoney(owedAmountText)
    val splitAssessment = Reimbursements.assessSplit(amount, owedAmount)
    val trimmedOwedBy = owedByText.trim()
    // A split that is switched on but not yet complete blocks saving, rather than being silently
    // dropped — the user asked for it and would not notice it going missing.
    val splitIsUsable = !splitting ||
        (splitAssessment is SplitAssessment.Valid && trimmedOwedBy.isNotEmpty())

    val canSave =
        (amount ?: 0.0) > 0 && accountId != null && categoryId != null && !saving && splitIsUsable

    /**
     * What this edit should do to the split already recorded. Switching the toggle off means
     * *remove* it, which is a different request from leaving it alone — so a form that opened
     * with no split and still has none sends nothing rather than an explicit clear.
     */
    val splitChange: SplitChange = when {
        splitting && owedAmount != null && trimmedOwedBy.isNotEmpty() ->
            SplitChange.Set(owedBy = trimmedOwedBy, owedAmount = owedAmount)
        existing?.owedBy != null && existing?.owedAmount != null -> SplitChange.Clear
        else -> SplitChange.Unchanged
    }

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
                        transactionUpdate(
                            date = date,
                            amount = amount!!,
                            // Always sent — an empty string is how you clear a description.
                            description = description,
                            accountId = accountId!!,
                            categoryId = categoryId!!,
                            split = splitChange,
                            // Always sent, like description: "" clears a recorded code.
                            mcc = mcc,
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
                            owedBy = if (splitting) trimmedOwedBy else null,
                            owedAmount = if (splitting) owedAmount else null,
                            // Blank goes as-is; the API reads "" as "not given".
                            mcc = mcc,
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

            // Splitting a bill. The amount above is untouched: the whole sum really did leave
            // the account. This only records how much of it was somebody else's, so the budget
            // charges you for your share and the rest becomes a debt they owe you.
            if (type == TransactionType.EXPENSE) {
                SectionCard {
                    SwitchRow(
                        title = "Someone owes me for part of this",
                        checked = splitting,
                        onCheckedChange = { splitting = it },
                    )
                    if (splitting) {
                        FormField("Who (e.g. Alice)", owedByText, { owedByText = it })
                        MoneyField(
                            "They owe",
                            owedAmountText,
                            { owedAmountText = it },
                            currencyCode = selectedCurrency,
                        )
                        val hint = when (splitAssessment) {
                            is SplitAssessment.Incomplete ->
                                "The full amount still leaves your account — only your share counts towards budgets."
                            is SplitAssessment.Invalid -> splitAssessment.reason
                            is SplitAssessment.Valid -> {
                                val currency = sessionVm.activeHousehold?.baseCurrency ?: "USD"
                                "Your share: ${splitAssessment.yourShare.currency(currency)}. " +
                                    "They owe you ${splitAssessment.owed.currency(currency)}."
                            }
                        }
                        Text(
                            hint,
                            style = MaterialTheme.typography.bodySmall,
                            color = if (splitAssessment is SplitAssessment.Invalid) {
                                MaterialTheme.colorScheme.error
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            },
                        )
                    }
                }
            }

            // Only for users who asked for it in Settings — a four-digit code field on
            // every form would tax everyone for a minority feature.
            if (sessionVm.user?.recordsMerchantCodes == true) {
                SectionCard {
                    FormField(
                        "Merchant code (optional)",
                        mcc,
                        {},
                        placeholder = "Leave blank if you don't know it",
                        supportingText = "Recorded only — nothing is calculated from it.",
                        trailingIcon = {
                            TextButton(onClick = { showMccPicker = true }) {
                                Text(if (mcc.isBlank()) "Choose" else "Change")
                            }
                        },
                    )
                    if (mcc.isNotBlank()) {
                        TextButton(onClick = { mcc = "" }) { Text("Clear code") }
                    }
                }
            }

            Button(onClick = ::save, enabled = canSave) {
                Text(if (saving) "Saving…" else "Save transaction")
            }
        }
    }

    if (showMccPicker) {
        // No sort: the catalogue arrives general-codes-first with the ~400 airline
        // and hotel brands last. Search still reaches them.
        SearchablePickerDialog(
            title = "Merchant code",
            options = mccs,
            optionLabel = { "${it.code} — ${it.name}" },
            optionKey = { it.code },
            searchText = { "${it.code} ${it.name} ${it.group}" },
            onSelect = { mcc = it.code },
            onDismiss = { showMccPicker = false },
        )
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
