package com.ivanlee.financetracker.ui.portfolio

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
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
import com.ivanlee.financetracker.logic.selectableAccounts
import com.ivanlee.financetracker.data.model.AccountResponse
import com.ivanlee.financetracker.data.model.SubPortfolioCashCreate
import com.ivanlee.financetracker.data.model.SubPortfolioResponse
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

private enum class CashDirection(val wire: String, val label: String) {
    DEPOSIT("deposit", "Add funds"),
    WITHDRAW("withdraw", "Withdraw"),
}

/**
 * Move cash between a household account and a sub-portfolio's own cash.
 *
 * Sub-portfolio cash isn't a separate ledger — it's a `CASH.<CUR>` pseudo-asset held at a
 * price of 1, so deposits and withdrawals are ordinary buy/sell trades. That's what makes
 * uninvested cash show up in the equity curve and performance figures instead of vanishing
 * between the bank account and the market.
 */
@Composable
fun SubPortfolioCashScreen(
    subPortfolioId: String,
    sessionVm: SessionViewModel,
    onBack: () -> Unit,
    onSaved: () -> Unit,
) {
    var accounts by remember { mutableStateOf<List<AccountResponse>>(emptyList()) }
    var sub by remember { mutableStateOf<SubPortfolioResponse?>(null) }
    var direction by remember { mutableStateOf(CashDirection.DEPOSIT) }
    var amountText by remember { mutableStateOf("") }
    var date by remember { mutableStateOf(Instant.now()) }
    var description by remember { mutableStateOf("") }
    var accountId by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(subPortfolioId, sessionVm.activeHousehold?.id) {
        val h = sessionVm.activeHousehold ?: return@LaunchedEffect
        try {
            coroutineScope {
                val a = async { Api.get<List<AccountResponse>>("/accounts/household/${h.id}") }
                val s = async { Api.get<List<SubPortfolioResponse>>("/portfolio/subportfolios/household/${h.id}") }
                accounts = a.await()
                sub = s.await().firstOrNull { it.id == subPortfolioId }
            }
            if (accountId == null) {
                accountId = (accounts.firstOrNull { it.id == h.defaultFundingAccountId }
                    ?: accounts.firstOrNull())?.id
            }
        } catch (e: Exception) {
            error = e.message ?: "Couldn't load the form."
        }
    }

    val selectedAccount = accounts.firstOrNull { it.id == accountId }
    val amount = amountText.replace(",", "").toDoubleOrNull()
    val canSave = (amount ?: 0.0) > 0 && accountId != null && !saving

    fun save() {
        val h = sessionVm.activeHousehold ?: return
        if (!canSave) return
        saving = true
        error = null
        scope.launch {
            try {
                Api.postIgnoringResult(
                    "/portfolio/subportfolios/$subPortfolioId/cash",
                    SubPortfolioCashCreate(
                        householdId = h.id,
                        accountId = accountId!!,
                        direction = direction.wire,
                        amount = amount!!,
                        currency = selectedAccount?.currency ?: h.baseCurrency,
                        date = date,
                        exchangeRate = 1.0,
                        description = description.ifBlank { null },
                    ),
                )
                onSaved()
            } catch (e: Exception) {
                error = e.message ?: "Couldn't move that cash."
            } finally {
                saving = false
            }
        }
    }

    DetailScaffold(
        title = direction.label,
        subtitle = sub?.name,
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
                    options = CashDirection.entries,
                    selected = direction,
                    optionLabel = { it.label },
                    onSelect = { direction = it },
                )
                MoneyField(
                    "Amount", amountText, { amountText = it },
                    currencyCode = selectedAccount?.currency,
                )
                DropdownField(
                    label = if (direction == CashDirection.DEPOSIT) "From account" else "To account",
                    selected = selectedAccount,
                    options = selectableAccounts(accounts),
                    optionLabel = { it.name },
                    onSelect = { accountId = it.id },
                )
                DateField("Date", date) { date = it }
                FormField("Description (optional)", description, { description = it })
                Text(
                    "Cash held inside a sub-portfolio counts towards its value and performance, " +
                        "so money waiting to be invested doesn't disappear from your charts.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Button(onClick = ::save, enabled = canSave) {
                Text(if (saving) "Saving…" else direction.label)
            }
        }
    }
}
