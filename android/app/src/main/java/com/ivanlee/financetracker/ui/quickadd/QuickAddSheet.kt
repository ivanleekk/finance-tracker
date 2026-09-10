package com.ivanlee.financetracker.ui.quickadd

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddCircleOutline
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
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
import com.ivanlee.financetracker.data.loadCardForAccount
import com.ivanlee.financetracker.logic.currencyWhole
import com.ivanlee.financetracker.logic.Cards
import com.ivanlee.financetracker.logic.CalculatorInput
import com.ivanlee.financetracker.data.model.CardLimitStatusRow
import com.ivanlee.financetracker.data.model.CardStatusResponse
import com.ivanlee.financetracker.data.model.CardResponse
import com.ivanlee.financetracker.logic.selectableAccounts
import com.ivanlee.financetracker.data.model.BalanceCreate
import com.ivanlee.financetracker.data.model.BalanceResponse
import com.ivanlee.financetracker.data.model.DividendCreate
import com.ivanlee.financetracker.data.model.DividendResponse
import com.ivanlee.financetracker.data.model.TradeCreate
import com.ivanlee.financetracker.data.model.TradeResponse
import com.ivanlee.financetracker.data.model.TradeType
import com.ivanlee.financetracker.data.model.TransactionCreate
import com.ivanlee.financetracker.data.model.TransactionResponse
import com.ivanlee.financetracker.data.model.TransactionType
import com.ivanlee.financetracker.data.model.TransferCreate
import com.ivanlee.financetracker.data.net.Api
import com.ivanlee.financetracker.data.net.apiDateOnly
import com.ivanlee.financetracker.logic.currency
import com.ivanlee.financetracker.state.ReferenceDataViewModel
import com.ivanlee.financetracker.state.SessionViewModel
import com.ivanlee.financetracker.ui.components.DateField
import com.ivanlee.financetracker.ui.components.DropdownField
import com.ivanlee.financetracker.ui.components.FormField
import com.ivanlee.financetracker.ui.components.MoneyField
import com.ivanlee.financetracker.ui.components.SegmentedChoice
import com.ivanlee.financetracker.ui.components.SwitchRow
import com.ivanlee.financetracker.ui.transactions.CategoryEditDialog
import com.ivanlee.financetracker.ui.portfolio.AssetCreateDialog
import kotlinx.coroutines.launch
import java.time.Instant

/**
 * The "command bar": an options-first quick add opened by pulling down any main screen.
 *
 * Pick a mode at the top, fill in the fields, log it — covering expenses, income, transfers,
 * trades, dividends and balance updates. Mirrors the web ⌘K command bar and iOS's
 * QuickAddView, but structured (pick-then-fill) rather than a parsed CLI.
 */
enum class QuickAddMode(val label: String) {
    EXPENSE("Expense"),
    INCOME("Income"),
    TRANSFER("Transfer"),
    TRADE("Trade"),
    DIVIDEND("Dividend"),
    BALANCE("Balance"),
}

@Composable
fun QuickAddSheet(
    sessionVm: SessionViewModel,
    referenceVm: ReferenceDataViewModel,
    onDone: () -> Unit,
) {
    val household = sessionVm.activeHousehold
    val baseCurrency = household?.baseCurrency ?: "USD"
    val scope = rememberCoroutineScope()

    // Reference data, loaded once per household at the app root rather than on every open —
    // see ReferenceDataViewModel and #272.
    val accounts = referenceVm.accounts
    val categories = referenceVm.categories
    val subPortfolios = referenceVm.subPortfolios
    val assets = referenceVm.assets

    var mode by remember { mutableStateOf(QuickAddMode.EXPENSE) }
    var amountText by remember { mutableStateOf("") }
    var date by remember { mutableStateOf(Instant.now()) }
    var description by remember { mutableStateOf("") }

    var accountId by remember { mutableStateOf<String?>(null) }
    var categoryId by remember { mutableStateOf<String?>(null) }
    // The card behind the selected account, if it is one. Fetched on demand —
    // most accounts are not cards, and Quick Add is meant to be fast.
    var card by remember { mutableStateOf<CardResponse?>(null) }
    var cardHeadroom by remember { mutableStateOf<Map<String, CardLimitStatusRow>>(emptyMap()) }
    var cardCategoryId by remember { mutableStateOf<String?>(null) }

    // Reloads whenever the account changes. A pick from the old card is
    // meaningless on a new one, so it is cleared here as well as server-side.
    LaunchedEffect(accountId, sessionVm.activeHousehold?.id) {
        val householdId = sessionVm.activeHousehold?.id
        val account = accountId
        cardCategoryId = null
        val loaded = if (householdId == null || account == null) null
                     else loadCardForAccount(householdId, account)
        card = loaded?.card
        cardHeadroom = loaded?.headroom ?: emptyMap()
    }
    var fromAccountId by remember { mutableStateOf<String?>(null) }
    var toAccountId by remember { mutableStateOf<String?>(null) }

    var subPortfolioId by remember { mutableStateOf<String?>(null) }
    var assetId by remember { mutableStateOf<String?>(null) }
    var tradeType by remember { mutableStateOf(TradeType.BUY) }
    var quantityText by remember { mutableStateOf("") }
    var priceText by remember { mutableStateOf("") }
    var settleFromCash by remember { mutableStateOf(false) }

    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var showNewCategory by remember { mutableStateOf(false) }
    var showNewAsset by remember { mutableStateOf(false) }

    val filteredCategories = categories.filter {
        it.type == if (mode == QuickAddMode.INCOME) TransactionType.INCOME else TransactionType.EXPENSE
    }
    val tradableAssets = assets.filter { !it.isCash }.sortedBy { it.ticker }
    val selectedAsset = assets.firstOrNull { it.id == assetId }
    val fundingCurrency = accounts.firstOrNull { it.id == accountId }?.currency ?: baseCurrency

    val amount = CalculatorInput.evaluateArithmeticExpression(amountText)
    val quantity = CalculatorInput.evaluateArithmeticExpression(quantityText)
    val price = CalculatorInput.evaluateArithmeticExpression(priceText)

    val canSave = !saving && household != null && when (mode) {
        QuickAddMode.EXPENSE, QuickAddMode.INCOME ->
            (amount ?: 0.0) > 0 && accountId != null && categoryId != null
        QuickAddMode.TRANSFER ->
            (amount ?: 0.0) > 0 && fromAccountId != null && toAccountId != null && fromAccountId != toAccountId
        QuickAddMode.TRADE ->
            (quantity ?: 0.0) > 0 && (price ?: 0.0) > 0 &&
                subPortfolioId != null && assetId != null && accountId != null
        QuickAddMode.DIVIDEND ->
            (amount ?: 0.0) > 0 && subPortfolioId != null && assetId != null && accountId != null
        QuickAddMode.BALANCE -> amount != null && accountId != null
    }

    // Normally a no-op: the app root loaded this when the household resolved. It still
    // matters on the two paths that leave it unloaded — a household that changed while the
    // sheet was closed, and a load that failed, which this retries on open.
    LaunchedEffect(household?.id) { referenceVm.load(household?.id) }

    // Defaults mirror the web/iOS quick-add routing: the household's configured funding
    // account and sub-portfolio, except expense/income, which start from the user's own
    // default expense account when one is set.
    //
    // Keyed on the store's status so the two stages each get a pass — the account defaults
    // land with `Essentials`, the sub-portfolio and asset ones with `Ready`. Every assignment
    // is guarded on the field still being null, so re-running is harmless and a pick the user
    // has already made is never overwritten.
    LaunchedEffect(referenceVm.status) {
        if (household == null || !referenceVm.hasEssentials) return@LaunchedEffect
        val loadedAccounts = referenceVm.accounts
        val funding = loadedAccounts.firstOrNull { it.id == household.defaultFundingAccountId }
            ?: loadedAccounts.firstOrNull()
        val expenseDefault =
            loadedAccounts.firstOrNull { it.id == sessionVm.user?.defaultAccountId } ?: funding
        if (accountId == null) {
            accountId = if (mode == QuickAddMode.EXPENSE || mode == QuickAddMode.INCOME) {
                expenseDefault?.id
            } else {
                funding?.id
            }
        }
        if (fromAccountId == null) fromAccountId = funding?.id
        if (toAccountId == null) toAccountId = loadedAccounts.firstOrNull { it.id != fromAccountId }?.id
        if (subPortfolioId == null) {
            subPortfolioId = (referenceVm.subPortfolios.firstOrNull { it.id == household.defaultSubPortfolioId }
                ?: referenceVm.subPortfolios.firstOrNull())?.id
        }
        if (assetId == null) {
            assetId = referenceVm.assets.filter { !it.isCash }.minByOrNull { it.ticker }?.id
        }
    }

    // Keyed on `categories` as well as `mode`: switching between income and expense changes
    // which categories are valid, and the list only exists after the load above finishes.
    LaunchedEffect(mode, categories) {
        error = null
        if (categoryId == null || filteredCategories.none { it.id == categoryId }) {
            categoryId = filteredCategories.firstOrNull()?.id
        }
    }

    fun save() {
        if (!canSave || household == null) return
        saving = true
        error = null
        scope.launch {
            try {
                when (mode) {
                    QuickAddMode.EXPENSE, QuickAddMode.INCOME -> Api.post<TransactionCreate, TransactionResponse>(
                        "/cashflow/transactions",
                        TransactionCreate(
                            date = date,
                            amount = amount!!,
                            description = description.ifBlank { null },
                            accountId = accountId!!,
                            categoryId = categoryId!!,
                            cardCategoryId = cardCategoryId,
                        ),
                    )

                    QuickAddMode.TRANSFER -> Api.post<TransferCreate, List<TransactionResponse>>(
                        "/cashflow/transfers",
                        TransferCreate(
                            fromAccountId = fromAccountId!!,
                            toAccountId = toAccountId!!,
                            amount = amount!!,
                            date = date,
                            description = description.ifBlank { null },
                        ),
                    )

                    QuickAddMode.TRADE -> Api.post<TradeCreate, TradeResponse>(
                        "/portfolio/trades",
                        TradeCreate(
                            type = tradeType,
                            date = date,
                            quantity = quantity!!,
                            price = price!!,
                            currency = selectedAsset?.currency,
                            exchangeRate = 1.0,
                            description = description.ifBlank { null },
                            householdId = household.id,
                            subPortfolioId = subPortfolioId!!,
                            assetId = assetId!!,
                            accountId = accountId!!,
                            settleFromCash = settleFromCash,
                        ),
                    )

                    QuickAddMode.DIVIDEND -> Api.post<DividendCreate, DividendResponse>(
                        "/portfolio/dividends",
                        DividendCreate(
                            householdId = household.id,
                            subPortfolioId = subPortfolioId!!,
                            assetId = assetId!!,
                            accountId = accountId!!,
                            date = date,
                            amount = amount!!,
                            exchangeRate = 1.0,
                        ),
                    )

                    QuickAddMode.BALANCE -> Api.post<BalanceCreate, BalanceResponse>(
                        "/accounts/balances",
                        BalanceCreate(
                            accountId = accountId!!,
                            date = date.apiDateOnly(),
                            balance = amount!!,
                            isManual = true,
                        ),
                    )
                }
                onDone()
            } catch (e: Exception) {
                error = e.message ?: "Couldn't save that."
            } finally {
                saving = false
            }
        }
    }

    Column(
        Modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp)
            .padding(bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("Quick Add", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)

        Row(
            Modifier.horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            QuickAddMode.entries.forEach { option ->
                FilterChip(
                    selected = option == mode,
                    onClick = { mode = option },
                    label = { Text(option.label) },
                )
            }
        }

        HorizontalDivider()

        // Says which of the three states the pickers are in — still loading, failed, or
        // genuinely empty — instead of leaving every picker on a bare "Select…", which reads
        // as "this household has no accounts" (#272).
        val referenceFailure = referenceVm.failureMessage
        when {
            referenceFailure != null -> Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    referenceFailure,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                )
                TextButton(onClick = { referenceVm.load(household?.id, force = true) }) {
                    Icon(Icons.Filled.Refresh, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Retry")
                }
            }

            !referenceVm.hasEssentials -> Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                Text(
                    "Loading your accounts…",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            selectableAccounts(accounts).isEmpty() -> Text(
                "No accounts yet — add one from the Accounts tab first.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        when (mode) {
            QuickAddMode.EXPENSE, QuickAddMode.INCOME -> {
                MoneyField("Amount", amountText, { amountText = it }, currencyCode = fundingCurrency)
                DateField("Date", date) { date = it }
                FormField("Description (optional)", description, { description = it })
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
                    Text("  New Category")
                }
                // Only when the account is a card. Quick Add is a deliberately
                // reduced surface — it leaves out the split and the merchant
                // code — but this one earns its row: it carries the headroom,
                // and logging card spend is exactly when that number can change
                // a decision.
                card?.let { activeCard ->
                    val currency = activeCard.currency ?: baseCurrency
                    DropdownField(
                        label = "Card category",
                        selected = activeCard.categories.firstOrNull { it.id == cardCategoryId },
                        options = activeCard.categories,
                        optionLabel = { Cards.categoryLabel(it, cardHeadroom) { v -> v.currencyWhole(currency) } },
                        onSelect = { cardCategoryId = it.id },
                    )
                }
            }

            QuickAddMode.TRANSFER -> {
                DropdownField(
                    label = "From",
                    selected = accounts.firstOrNull { it.id == fromAccountId },
                    options = selectableAccounts(accounts),
                    optionLabel = { it.name },
                    onSelect = { fromAccountId = it.id },
                )
                DropdownField(
                    label = "To",
                    selected = accounts.firstOrNull { it.id == toAccountId },
                    options = selectableAccounts(accounts),
                    optionLabel = { it.name },
                    onSelect = { toAccountId = it.id },
                )
                if (fromAccountId != null && fromAccountId == toAccountId) {
                    Text(
                        "Pick two different accounts.",
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                MoneyField(
                    "Amount", amountText, { amountText = it },
                    currencyCode = accounts.firstOrNull { it.id == fromAccountId }?.currency ?: baseCurrency,
                )
                DateField("Date", date) { date = it }
                FormField("Description (optional)", description, { description = it })
            }

            QuickAddMode.TRADE -> {
                SegmentedChoice(
                    options = TradeType.entries,
                    selected = tradeType,
                    optionLabel = { it.label },
                    onSelect = { tradeType = it },
                )
                DropdownField(
                    label = "Sub-Portfolio",
                    selected = subPortfolios.firstOrNull { it.id == subPortfolioId },
                    options = subPortfolios,
                    optionLabel = { it.name },
                    onSelect = { subPortfolioId = it.id },
                )
                DropdownField(
                    label = "Asset",
                    selected = tradableAssets.firstOrNull { it.id == assetId },
                    options = tradableAssets,
                    optionLabel = { it.ticker },
                    onSelect = { assetId = it.id },
                )
                TextButton(onClick = { showNewAsset = true }) {
                    Icon(Icons.Filled.AddCircleOutline, contentDescription = null)
                    Text("  New Asset")
                }
                MoneyField("Quantity", quantityText, { quantityText = it })
                MoneyField(
                    "Price", priceText, { priceText = it },
                    currencyCode = selectedAsset?.currency,
                )
                DateField("Date", date) { date = it }
                if (quantity != null && price != null && selectedAsset != null) {
                    Text(
                        "Estimated total: ${(quantity * price).currency(selectedAsset.currency)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                SwitchRow(
                    title = "Settle from sub-portfolio cash",
                    checked = settleFromCash,
                    onCheckedChange = { settleFromCash = it },
                )
                DropdownField(
                    label = "Funding Account",
                    selected = accounts.firstOrNull { it.id == accountId },
                    options = selectableAccounts(accounts),
                    optionLabel = { it.name },
                    onSelect = { accountId = it.id },
                )
                FormField("Description (optional)", description, { description = it })
            }

            QuickAddMode.DIVIDEND -> {
                DropdownField(
                    label = "Sub-Portfolio",
                    selected = subPortfolios.firstOrNull { it.id == subPortfolioId },
                    options = subPortfolios,
                    optionLabel = { it.name },
                    onSelect = { subPortfolioId = it.id },
                )
                DropdownField(
                    label = "Asset",
                    selected = tradableAssets.firstOrNull { it.id == assetId },
                    options = tradableAssets,
                    optionLabel = { it.ticker },
                    onSelect = { assetId = it.id },
                )
                TextButton(onClick = { showNewAsset = true }) {
                    Icon(Icons.Filled.AddCircleOutline, contentDescription = null)
                    Text("  New Asset")
                }
                MoneyField("Amount", amountText, { amountText = it }, currencyCode = baseCurrency)
                DropdownField(
                    label = "Credited Account",
                    selected = accounts.firstOrNull { it.id == accountId },
                    options = selectableAccounts(accounts),
                    optionLabel = { it.name },
                    onSelect = { accountId = it.id },
                )
                DateField("Date", date) { date = it }
                Text(
                    "Records a dividend payout for this holding.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            QuickAddMode.BALANCE -> {
                DropdownField(
                    label = "Account",
                    selected = accounts.firstOrNull { it.id == accountId },
                    options = selectableAccounts(accounts),
                    optionLabel = { it.name },
                    onSelect = { accountId = it.id },
                )
                MoneyField("Balance", amountText, { amountText = it }, currencyCode = fundingCurrency)
                DateField("Date", date) { date = it }
                Text(
                    "Sets the account's balance on this date; the difference is reconciled. " +
                        "Use a leading “-” for liabilities.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        error?.let {
            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }

        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(onClick = onDone, modifier = Modifier.weight(1f)) { Text("Cancel") }
            Button(onClick = ::save, enabled = canSave, modifier = Modifier.weight(1f)) {
                Text(if (saving) "Saving…" else "Log")
            }
        }
    }

    if (showNewCategory && household != null) {
        CategoryEditDialog(
            existing = null,
            householdId = household.id,
            lockedType = if (mode == QuickAddMode.INCOME) TransactionType.INCOME else TransactionType.EXPENSE,
            onDismiss = { showNewCategory = false },
            onSaved = { created ->
                referenceVm.add(created)
                categoryId = created.id
            },
        )
    }

    if (showNewAsset) {
        AssetCreateDialog(
            defaultCurrency = selectedAsset?.currency ?: accounts.firstOrNull()?.currency ?: baseCurrency,
            onDismiss = { showNewAsset = false },
            onCreated = { created ->
                referenceVm.add(created)
                assetId = created.id
            },
        )
    }
}
