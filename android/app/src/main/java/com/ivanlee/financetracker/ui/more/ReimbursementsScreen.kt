package com.ivanlee.financetracker.ui.more

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ivanlee.financetracker.logic.selectableAccounts
import com.ivanlee.financetracker.data.model.AccountResponse
import com.ivanlee.financetracker.data.model.CategoryResponse
import com.ivanlee.financetracker.data.model.Counterparty
import com.ivanlee.financetracker.data.model.CounterpartyBalanceResponse
import com.ivanlee.financetracker.data.model.CounterpartyCreate
import com.ivanlee.financetracker.data.model.CounterpartyDirection
import com.ivanlee.financetracker.data.model.SettlementCreate
import com.ivanlee.financetracker.data.model.SpendOnYourBehalfCreate
import com.ivanlee.financetracker.data.model.TransactionResponse
import com.ivanlee.financetracker.data.model.TransactionType
import com.ivanlee.financetracker.data.net.Api
import com.ivanlee.financetracker.logic.Reimbursements
import com.ivanlee.financetracker.logic.currency
import com.ivanlee.financetracker.state.SessionViewModel
import com.ivanlee.financetracker.ui.components.DateField
import com.ivanlee.financetracker.ui.components.DetailScaffold
import com.ivanlee.financetracker.ui.components.DropdownField
import com.ivanlee.financetracker.ui.components.EmptyState
import com.ivanlee.financetracker.ui.components.FormField
import com.ivanlee.financetracker.ui.components.MoneyField
import com.ivanlee.financetracker.ui.components.SectionCard
import com.ivanlee.financetracker.ui.theme.negativeColor
import com.ivanlee.financetracker.ui.theme.positiveColor
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import java.time.Instant

/**
 * Who owes you, and who you owe. Port of iOS's `ReimbursementsView` and the web
 * /reimbursements page.
 *
 * The two directions are kept as two sections rather than netted into one figure: someone can
 * owe you for last night and be owed for last week, and collapsing that loses the fact that
 * there are two things to settle.
 */
@Composable
fun ReimbursementsScreen(
    sessionVm: SessionViewModel,
    onBack: () -> Unit,
) {
    var balances by remember { mutableStateOf<List<CounterpartyBalanceResponse>>(emptyList()) }
    var accounts by remember { mutableStateOf<List<AccountResponse>>(emptyList()) }
    var categories by remember { mutableStateOf<List<CategoryResponse>>(emptyList()) }
    var counterparties by remember { mutableStateOf<List<Counterparty>>(emptyList()) }
    var settling by remember { mutableStateOf<CounterpartyBalanceResponse?>(null) }
    var addingOnBehalf by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var reloadKey by remember { mutableStateOf(0) }
    val scope = rememberCoroutineScope()

    val household = sessionVm.activeHousehold
    val baseCurrency = household?.baseCurrency ?: "USD"

    LaunchedEffect(household?.id, reloadKey) {
        val h = household ?: return@LaunchedEffect
        try {
            coroutineScope {
                val b = async {
                    Api.get<List<CounterpartyBalanceResponse>>(
                        "/cashflow/reimbursements/household/${h.id}"
                    )
                }
                val a = async { Api.get<List<AccountResponse>>("/accounts/household/${h.id}") }
                val c = async {
                    Api.get<List<CategoryResponse>>("/cashflow/categories/household/${h.id}")
                }
                val p = async {
                    Api.get<List<Counterparty>>("/cashflow/counterparties/household/${h.id}")
                }
                balances = b.await()
                accounts = a.await()
                categories = c.await()
                counterparties = p.await()
            }
        } catch (e: Exception) {
            error = e.message ?: "Couldn't load shared spending."
        }
    }

    val owedToYou = balances.filter { it.direction == CounterpartyDirection.OWED_TO_YOU }
    val youOwe = balances.filter { it.direction == CounterpartyDirection.YOU_OWE }
    val expenseCategories = categories.filter { it.type == TransactionType.EXPENSE }

    DetailScaffold(
        title = "Shared spending",
        onBack = onBack,
        error = error,
        onErrorShown = { error = null },
        floatingActionButton = {
            if (expenseCategories.isNotEmpty()) {
                ExtendedFloatingActionButton(
                    onClick = { addingOnBehalf = true },
                    icon = { Icon(Icons.Filled.Add, contentDescription = null) },
                    text = { Text("Someone paid for me") },
                )
            }
        },
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (balances.isNotEmpty()) {
                val totals = Reimbursements.totals(balances)
                SectionCard {
                    TotalRow("Owed to you", totals.owedToYou, baseCurrency, positiveColor())
                    HorizontalDivider()
                    TotalRow("You owe", totals.youOwe, baseCurrency, negativeColor())
                }
            }

            SectionCard(title = "Owes you") {
                if (owedToYou.isEmpty()) {
                    EmptyState(
                        icon = Icons.Filled.Groups,
                        title = "Nobody owes you anything",
                        message = "When you pay for someone, turn on “Someone owes me for part " +
                            "of this” as you log the transaction.",
                    )
                } else {
                    owedToYou.forEachIndexed { index, row ->
                        if (index > 0) HorizontalDivider()
                        CounterpartyRow(row, baseCurrency) { settling = row }
                    }
                }
            }

            SectionCard(title = "You owe") {
                if (youOwe.isEmpty()) {
                    Text(
                        "You don't owe anyone.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    youOwe.forEachIndexed { index, row ->
                        if (index > 0) HorizontalDivider()
                        CounterpartyRow(row, baseCurrency) { settling = row }
                    }
                    Text(
                        "Already counted in your budgets — it was spending of yours, whoever paid.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }

    settling?.let { row ->
        SettlementDialog(
            balance = row,
            accounts = accounts,
            baseCurrency = baseCurrency,
            onDismiss = { settling = null },
            onConfirm = { accountId, amount, date ->
                scope.launch {
                    try {
                        Api.post<SettlementCreate, TransactionResponse>(
                            "/cashflow/reimbursements/settle",
                            SettlementCreate(
                                accountId = accountId,
                                counterpartyId = row.counterpartyId,
                                direction = row.direction,
                                amount = amount,
                                date = date,
                                ownerUserId = row.ownerUserId,
                            ),
                        )
                        settling = null
                        reloadKey++
                    } catch (e: Exception) {
                        error = e.message ?: "Couldn't record that."
                    }
                }
            },
        )
    }

    if (addingOnBehalf && household != null) {
        SpendOnYourBehalfDialog(
            categories = expenseCategories,
            counterparties = counterparties,
            baseCurrency = baseCurrency,
            onCreateCounterparty = { name ->
                val created = Api.post<CounterpartyCreate, Counterparty>(
                    "/cashflow/counterparties",
                    CounterpartyCreate(household.id, name),
                )
                counterparties = counterparties + created
                created
            },
            onDismiss = { addingOnBehalf = false },
            onConfirm = { counterpartyId, categoryId, amount, date, description ->
                scope.launch {
                    try {
                        Api.post<SpendOnYourBehalfCreate, CounterpartyBalanceResponse>(
                            "/cashflow/reimbursements/on-behalf",
                            SpendOnYourBehalfCreate(
                                householdId = household.id,
                                categoryId = categoryId,
                                counterpartyId = counterpartyId,
                                amount = amount,
                                date = date,
                                description = description,
                            ),
                        )
                        addingOnBehalf = false
                        reloadKey++
                    } catch (e: Exception) {
                        error = e.message ?: "Couldn't record that."
                    }
                }
            },
        )
    }
}

@Composable
private fun TotalRow(label: String, amount: Double, currency: String, tint: androidx.compose.ui.graphics.Color) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = MaterialTheme.typography.bodyMedium)
        Text(
            amount.currency(currency),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
            color = if (amount > 0) tint else MaterialTheme.colorScheme.onSurface,
        )
    }
}

@Composable
private fun CounterpartyRow(
    row: CounterpartyBalanceResponse,
    currency: String,
    onSettle: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onSettle)
            .padding(vertical = 12.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(row.counterpartyName, style = MaterialTheme.typography.bodyLarge)
        Text(
            row.amount.currency(currency),
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.SemiBold,
            color = if (row.direction == CounterpartyDirection.OWED_TO_YOU) {
                positiveColor()
            } else {
                negativeColor()
            },
        )
    }
}

/**
 * Recording money that actually changed hands to clear a debt.
 *
 * The amount is prefilled with the whole balance because settling in full is the common case,
 * but it stays editable — partial repayments are normal, and the ledger handles them by simply
 * leaving the rest outstanding.
 */
@Composable
private fun SettlementDialog(
    balance: CounterpartyBalanceResponse,
    accounts: List<AccountResponse>,
    baseCurrency: String,
    onDismiss: () -> Unit,
    onConfirm: (accountId: String, amount: Double, date: Instant) -> Unit,
) {
    val receiving = balance.direction == CounterpartyDirection.OWED_TO_YOU
    var accountId by remember { mutableStateOf(accounts.firstOrNull()?.id) }
    var amountText by remember { mutableStateOf(String.format("%.2f", balance.amount)) }
    var date by remember { mutableStateOf(Instant.now()) }

    val amount = Reimbursements.parseMoney(amountText)
    val canSave = (amount ?: 0.0) > 0 && accountId != null

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (receiving) "Record repayment" else "Pay back") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    "${if (receiving) "Owed by" else "Owed to"} ${balance.counterpartyName} · " +
                        "${balance.amount.currency(baseCurrency)} outstanding",
                    style = MaterialTheme.typography.bodyMedium,
                )
                DropdownField(
                    label = if (receiving) "Into account" else "From account",
                    selected = accounts.firstOrNull { it.id == accountId },
                    options = selectableAccounts(accounts),
                    optionLabel = { it.name },
                    onSelect = { accountId = it.id },
                )
                MoneyField("Amount", amountText, { amountText = it }, currencyCode = baseCurrency)
                DateField("Date", date) { date = it }
                Text(
                    "Moves the account balance but charges no category — the spending was " +
                        "already recorded when the bill was paid.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onConfirm(accountId!!, amount!!, date) },
                enabled = canSave,
            ) { Text("Record") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

/**
 * Somebody else paid for something of yours.
 *
 * There is no account to pick because no account of yours moved — which is exactly why this
 * could not be logged before the ledger. The cost still counts towards your budget, and you owe
 * them until you settle up.
 */
@Composable
private fun SpendOnYourBehalfDialog(
    categories: List<CategoryResponse>,
    counterparties: List<Counterparty>,
    baseCurrency: String,
    onCreateCounterparty: suspend (name: String) -> Counterparty,
    onDismiss: () -> Unit,
    onConfirm: (
        counterpartyId: String,
        categoryId: String,
        amount: Double,
        date: Instant,
        description: String?,
    ) -> Unit,
) {
    var counterpartyId by remember { mutableStateOf<String?>(null) }
    var categoryId by remember { mutableStateOf(categories.firstOrNull()?.id) }
    var amountText by remember { mutableStateOf("") }
    var date by remember { mutableStateOf(Instant.now()) }
    var description by remember { mutableStateOf("") }
    var showNewCounterparty by remember { mutableStateOf(false) }
    var newCounterpartyName by remember { mutableStateOf("") }
    var savingCounterparty by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    val amount = Reimbursements.parseMoney(amountText)
    val canSave = (amount ?: 0.0) > 0 && categoryId != null && counterpartyId != null

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Someone paid for me") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("Who paid", style = MaterialTheme.typography.labelLarge)
                    TextButton(onClick = { showNewCounterparty = !showNewCounterparty }) {
                        Text(if (showNewCounterparty) "Cancel" else "+ New person")
                    }
                }
                if (showNewCounterparty) {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.Bottom,
                    ) {
                        Box(Modifier.weight(1f)) {
                            FormField("e.g. Bob", newCounterpartyName, { newCounterpartyName = it })
                        }
                        TextButton(
                            enabled = newCounterpartyName.isNotBlank() && !savingCounterparty,
                            onClick = {
                                savingCounterparty = true
                                scope.launch {
                                    try {
                                        val created = onCreateCounterparty(newCounterpartyName.trim())
                                        counterpartyId = created.id
                                        newCounterpartyName = ""
                                        showNewCounterparty = false
                                    } catch (e: Exception) {
                                        error = e.message ?: "Couldn't add that person."
                                    } finally {
                                        savingCounterparty = false
                                    }
                                }
                            },
                        ) { Text(if (savingCounterparty) "Adding…" else "Add") }
                    }
                } else {
                    DropdownField(
                        label = "Person",
                        selected = counterparties.firstOrNull { it.id == counterpartyId },
                        options = counterparties,
                        optionLabel = { it.name },
                        placeholder = "Select person",
                        onSelect = { counterpartyId = it.id },
                    )
                }
                DropdownField(
                    label = "Category",
                    selected = categories.firstOrNull { it.id == categoryId },
                    options = categories,
                    optionLabel = { it.name },
                    onSelect = { categoryId = it.id },
                )
                MoneyField("Amount", amountText, { amountText = it }, currencyCode = baseCurrency)
                DateField("Date", date) { date = it }
                FormField("Description (optional)", description, { description = it })
                Text(
                    "No account of yours moved, so there's nothing to log against one. It still " +
                        "counts towards your budget, and you'll owe them until you settle up.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    onConfirm(
                        counterpartyId!!,
                        categoryId!!,
                        amount!!,
                        date,
                        description.ifBlank { null },
                    )
                },
                enabled = canSave,
            ) { Text("Record") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
