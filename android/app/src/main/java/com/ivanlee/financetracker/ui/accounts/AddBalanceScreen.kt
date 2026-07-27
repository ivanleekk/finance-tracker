package com.ivanlee.financetracker.ui.accounts

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
import com.ivanlee.financetracker.data.model.AccountResponse
import com.ivanlee.financetracker.data.model.BalanceCreate
import com.ivanlee.financetracker.data.model.BalanceResponse
import com.ivanlee.financetracker.data.net.Api
import com.ivanlee.financetracker.data.net.apiDateOnly
import com.ivanlee.financetracker.state.SessionViewModel
import com.ivanlee.financetracker.ui.components.DateField
import com.ivanlee.financetracker.ui.components.DetailScaffold
import com.ivanlee.financetracker.ui.components.MoneyField
import com.ivanlee.financetracker.ui.components.SectionCard
import kotlinx.coroutines.launch
import java.time.Instant

/** Record a manual balance for an account on a given date. */
@Composable
fun AddBalanceScreen(
    accountId: String,
    sessionVm: SessionViewModel,
    onBack: () -> Unit,
    onSaved: () -> Unit,
) {
    var account by remember { mutableStateOf<AccountResponse?>(null) }
    var date by remember { mutableStateOf(Instant.now()) }
    var amountText by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(accountId, sessionVm.activeHousehold?.id) {
        // No GET /accounts/{id} on the backend — accounts come from the household listing.
        val h = sessionVm.activeHousehold ?: return@LaunchedEffect
        account = runCatching {
            Api.get<List<AccountResponse>>("/accounts/household/${h.id}").firstOrNull { it.id == accountId }
        }.getOrNull()
    }

    // Balances may be negative — liabilities and overdrawn accounts are the normal case here,
    // which is why this isn't validated as "positive money".
    val amount = amountText.replace(",", "").toDoubleOrNull()
    val canSave = amount != null && !saving

    fun save() {
        val value = amount ?: return
        saving = true
        error = null
        scope.launch {
            try {
                Api.post<BalanceCreate, BalanceResponse>(
                    "/accounts/balances",
                    BalanceCreate(accountId, date.apiDateOnly(), value, isManual = true),
                )
                onSaved()
            } catch (e: Exception) {
                error = e.message ?: "Couldn't record that balance."
            } finally {
                saving = false
            }
        }
    }

    DetailScaffold(
        title = "Add balance",
        subtitle = account?.name,
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
                MoneyField(
                    "Balance",
                    amountText,
                    { amountText = it },
                    currencyCode = account?.currency,
                )
                DateField("Date", date) { date = it }
                Text(
                    "Recording a balance creates a reconciliation entry for the difference from the " +
                        "previous balance. Use a leading “-” for liabilities.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Button(onClick = ::save, enabled = canSave) {
                Text(if (saving) "Saving…" else "Save balance")
            }
        }
    }
}
