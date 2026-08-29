package com.ivanlee.financetracker.ui.transactions

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.ivanlee.financetracker.data.loadCardForAccount
import com.ivanlee.financetracker.logic.selectableAccounts
import com.ivanlee.financetracker.data.model.AccountResponse
import com.ivanlee.financetracker.data.model.CategoryResponse
import com.ivanlee.financetracker.data.model.CardLimitStatusRow
import com.ivanlee.financetracker.data.model.CardResponse
import com.ivanlee.financetracker.data.model.CardStatusResponse
import com.ivanlee.financetracker.data.model.Counterparty
import com.ivanlee.financetracker.data.model.CounterpartyCreate
import com.ivanlee.financetracker.data.model.ReferenceMcc
import com.ivanlee.financetracker.logic.Cards
import com.ivanlee.financetracker.data.model.TransactionCreate
import com.ivanlee.financetracker.data.model.TransactionResponse
import com.ivanlee.financetracker.data.model.TransactionSplitInput
import com.ivanlee.financetracker.data.model.TransactionType
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
import com.ivanlee.financetracker.logic.SplitEntry
import com.ivanlee.financetracker.logic.currency
import com.ivanlee.financetracker.logic.currencyWhole
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import java.time.Instant
import java.util.Locale

/** One row of the split editor: a picked person and their (still-typed) share. */
private data class SplitFormRow(val counterpartyId: String, val amountText: String)

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
    // The card behind the selected account, if it is one. Fetched on demand,
    // because most accounts are not cards and most households have none.
    var card by remember { mutableStateOf<CardResponse?>(null) }
    var cardHeadroom by remember { mutableStateOf<Map<String, CardLimitStatusRow>>(emptyMap()) }
    var cardCategoryId by remember { mutableStateOf<String?>(null) }
    var showCardCategoryPicker by remember { mutableStateOf(false) }
    var mccs by remember { mutableStateOf<List<ReferenceMcc>>(emptyList()) }
    var showMccPicker by remember { mutableStateOf(false) }
    // Part of this bill is one or more other people's. The amount above stays the full sum
    // that leaves the account — this only records whose the rest was.
    var counterparties by remember { mutableStateOf<List<Counterparty>>(emptyList()) }
    var splitting by remember { mutableStateOf(false) }
    var splitRows by remember { mutableStateOf<List<SplitFormRow>>(emptyList()) }
    var showNewCounterparty by remember { mutableStateOf(false) }
    var newCounterpartyName by remember { mutableStateOf("") }
    var savingCounterparty by remember { mutableStateOf(false) }

    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(transactionId, sessionVm.activeHousehold?.id) {
        val h = sessionVm.activeHousehold ?: return@LaunchedEffect
        try {
            coroutineScope {
                val a = async { Api.get<List<AccountResponse>>("/accounts/household/${h.id}") }
                val c = async { Api.get<List<CategoryResponse>>("/cashflow/categories/household/${h.id}") }
                val p = async {
                    Api.get<List<Counterparty>>("/cashflow/counterparties/household/${h.id}")
                }
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
                counterparties = p.await()
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
                splitting = txn.splits.isNotEmpty()
                splitRows = txn.splits.map { SplitFormRow(it.counterpartyId, it.amount.toString()) }
                mcc = txn.mcc.orEmpty()
                cardCategoryId = txn.cardCategoryId
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

    // Only rows with a person picked count as an entry — a still-blank "+ Add person" row
    // must not itself make the split invalid.
    val splitEntries = splitRows
        .filter { it.counterpartyId.isNotBlank() }
        .map { SplitEntry(it.counterpartyId, Reimbursements.parseMoney(it.amountText)) }
    val splitAssessment = Reimbursements.assessSplit(amount, splitEntries)
    // A split that is switched on but not yet complete blocks saving, rather than being silently
    // dropped — the user asked for it and would not notice it going missing.
    val splitIsUsable = !splitting || splitAssessment is SplitAssessment.Valid

    val canSave =
        (amount ?: 0.0) > 0 && accountId != null && categoryId != null && !saving && splitIsUsable

    val validSplitInputs: List<TransactionSplitInput> =
        if (splitAssessment is SplitAssessment.Valid) {
            splitEntries.map { TransactionSplitInput(it.counterpartyId, it.amount!!) }
        } else {
            emptyList()
        }

    /**
     * What this edit should do to the split already recorded. Switching the toggle off means
     * *remove* it, which is a different request from leaving it alone — so a form that opened
     * with no split and still has none sends nothing (null, which the wire omits) rather than
     * an explicit clear.
     */
    val splitsForUpdate: List<TransactionSplitInput>? = when {
        splitting && splitAssessment is SplitAssessment.Valid -> validSplitInputs
        !splitting && existing?.splits?.isNotEmpty() == true -> emptyList()
        else -> null
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
                            splits = splitsForUpdate,
                            // Always sent, like description: "" clears a recorded code.
                            mcc = mcc,
                            // Null clears the tag; the factory sends JsonNull for it.
                            cardCategoryId = cardCategoryId,
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
                            splits = if (splitting && validSplitInputs.isNotEmpty()) {
                                validSplitInputs
                            } else {
                                null
                            },
                            // Blank goes as-is; the API reads "" as "not given".
                            mcc = mcc,
                            cardCategoryId = cardCategoryId,
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
                    options = selectableAccounts(accounts),
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
                        splitRows.forEachIndexed { index, row ->
                            val pickedElsewhere = splitRows
                                .filterIndexed { j, _ -> j != index }
                                .map { it.counterpartyId }
                                .toSet()
                            Row(
                                Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalAlignment = Alignment.Bottom,
                            ) {
                                Box(Modifier.weight(1f)) {
                                    DropdownField(
                                        label = "Who",
                                        selected = counterparties.firstOrNull { it.id == row.counterpartyId },
                                        options = counterparties.filter { it.id !in pickedElsewhere },
                                        optionLabel = { it.name },
                                        placeholder = "Select person",
                                        onSelect = { picked ->
                                            splitRows = splitRows.mapIndexed { j, r ->
                                                if (j == index) r.copy(counterpartyId = picked.id) else r
                                            }
                                        },
                                    )
                                }
                                Box(Modifier.width(120.dp)) {
                                    MoneyField(
                                        "Owes",
                                        row.amountText,
                                        { text ->
                                            splitRows = splitRows.mapIndexed { j, r ->
                                                if (j == index) r.copy(amountText = text) else r
                                            }
                                        },
                                        currencyCode = selectedCurrency,
                                    )
                                }
                                TextButton(onClick = {
                                    splitRows = splitRows.filterIndexed { j, _ -> j != index }
                                }) { Text("Remove") }
                            }
                        }

                        Row(
                            horizontalArrangement = Arrangement.spacedBy(16.dp),
                        ) {
                            TextButton(onClick = { splitRows = splitRows + SplitFormRow("", "") }) {
                                Text("+ Add person")
                            }
                            TextButton(onClick = { showNewCounterparty = !showNewCounterparty }) {
                                Text(if (showNewCounterparty) "Cancel" else "+ New person")
                            }
                            if (splitRows.size > 1) {
                                TextButton(onClick = {
                                    val blanks = splitRows.filter { it.amountText.isBlank() }
                                    if (blanks.isNotEmpty()) {
                                        val specified = splitRows
                                            .filter { it.amountText.isNotBlank() }
                                            .mapNotNull { Reimbursements.parseMoney(it.amountText) }
                                        val share = Reimbursements.evenSplitRemainder(
                                            amount ?: 0.0,
                                            specified,
                                            blanks.size,
                                        )
                                        if (share != null) {
                                            splitRows = splitRows.map { r ->
                                                if (r.amountText.isBlank()) {
                                                    r.copy(
                                                        amountText = String.format(
                                                            Locale.US,
                                                            "%.2f",
                                                            share,
                                                        ),
                                                    )
                                                } else {
                                                    r
                                                }
                                            }
                                        }
                                    }
                                }) { Text("Split remainder evenly") }
                            }
                        }

                        if (showNewCounterparty) {
                            Row(
                                Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalAlignment = Alignment.Bottom,
                            ) {
                                Box(Modifier.weight(1f)) {
                                    FormField(
                                        "e.g. Alice",
                                        newCounterpartyName,
                                        { newCounterpartyName = it },
                                    )
                                }
                                Button(
                                    enabled = newCounterpartyName.isNotBlank() && !savingCounterparty,
                                    onClick = {
                                        val h = sessionVm.activeHousehold ?: return@Button
                                        savingCounterparty = true
                                        scope.launch {
                                            try {
                                                val created = Api.post<CounterpartyCreate, Counterparty>(
                                                    "/cashflow/counterparties",
                                                    CounterpartyCreate(h.id, newCounterpartyName.trim()),
                                                )
                                                counterparties = counterparties + created
                                                splitRows = splitRows + SplitFormRow(created.id, "")
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
                        }

                        val hint = when (splitAssessment) {
                            is SplitAssessment.Incomplete ->
                                "The full amount still leaves your account — only your share counts towards budgets."
                            is SplitAssessment.Invalid -> splitAssessment.reason
                            is SplitAssessment.Valid -> {
                                val currency = sessionVm.activeHousehold?.baseCurrency ?: "USD"
                                val who = if (splitEntries.size > 1) "They owe you (combined)" else "They owe you"
                                "Your share: ${splitAssessment.yourShare.currency(currency)}. " +
                                    "$who ${splitAssessment.owed.currency(currency)}."
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

            // Only when the selected account is actually a card. The headroom sits in
            // the row because this is the one moment the number can still change the
            // decision — a meter you have to go and look at will not stop anyone
            // overspending.
            card?.let { activeCard ->
                val picked = activeCard.categories.firstOrNull { it.id == cardCategoryId }
                SectionCard {
                    FormField(
                        "Card category",
                        picked?.name ?: "Card's default",
                        {},
                        supportingText = "Which of this card's own categories the spend counts towards.",
                        trailingIcon = {
                            TextButton(onClick = { showCardCategoryPicker = true }) {
                                Text(if (picked == null) "Choose" else "Change")
                            }
                        },
                    )
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

    // Reloads whenever the account changes, including the first time one is
    // picked. A pick from the old card is meaningless on a new one, so it is
    // cleared here as well as server-side.
    LaunchedEffect(accountId, sessionVm.activeHousehold?.id) {
        val householdId = sessionVm.activeHousehold?.id
        val account = accountId
        val loaded = if (householdId == null || account == null) null
                     else loadCardForAccount(householdId, account)
        if (loaded?.card?.id != card?.id) {
            cardCategoryId = existing?.cardCategoryId.takeIf { existing?.accountId == account }
        }
        card = loaded?.card
        cardHeadroom = loaded?.headroom ?: emptyMap()
    }

    if (showCardCategoryPicker) {
        val activeCard = card
        if (activeCard != null) {
            val currency = activeCard.currency ?: sessionVm.activeHousehold?.baseCurrency ?: "USD"
            SearchablePickerDialog(
                title = "Card category",
                options = activeCard.categories,
                optionLabel = { Cards.categoryLabel(it, cardHeadroom) { v -> v.currencyWhole(currency) } },
                optionKey = { it.id },
                searchText = { it.name },
                onSelect = { cardCategoryId = it.id },
                onDismiss = { showCardCategoryPicker = false },
            )
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
