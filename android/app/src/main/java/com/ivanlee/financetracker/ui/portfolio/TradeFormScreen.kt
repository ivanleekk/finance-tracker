package com.ivanlee.financetracker.ui.portfolio

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
import com.ivanlee.financetracker.logic.selectableAccounts
import com.ivanlee.financetracker.data.model.AccountResponse
import com.ivanlee.financetracker.data.model.AssetResponse
import com.ivanlee.financetracker.data.model.SubPortfolioResponse
import com.ivanlee.financetracker.data.model.TradeCreate
import com.ivanlee.financetracker.data.model.TradeResponse
import com.ivanlee.financetracker.data.model.TradeType
import com.ivanlee.financetracker.data.model.TradeUpdate
import com.ivanlee.financetracker.data.net.Api
import com.ivanlee.financetracker.logic.CalculatorInput
import com.ivanlee.financetracker.logic.currency
import com.ivanlee.financetracker.state.SessionViewModel
import com.ivanlee.financetracker.ui.components.DateField
import com.ivanlee.financetracker.ui.components.DetailScaffold
import com.ivanlee.financetracker.ui.components.DropdownField
import com.ivanlee.financetracker.ui.components.FormField
import com.ivanlee.financetracker.ui.components.MoneyField
import com.ivanlee.financetracker.ui.components.SectionCard
import com.ivanlee.financetracker.ui.components.SegmentedChoice
import com.ivanlee.financetracker.ui.components.SwitchRow
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import java.time.Instant

/**
 * Record or edit a buy/sell.
 *
 * "Settle from sub-portfolio cash" is only offered on **create**: it writes a companion cash
 * trade linked through `settlement_trade_id`, and flipping that on an existing trade is a
 * different backend operation than an edit. Matches iOS.
 */
@Composable
fun TradeFormScreen(
    tradeId: String?,
    presetSubPortfolioId: String?,
    sessionVm: SessionViewModel,
    onBack: () -> Unit,
    onSaved: () -> Unit,
) {
    var accounts by remember { mutableStateOf<List<AccountResponse>>(emptyList()) }
    var assets by remember { mutableStateOf<List<AssetResponse>>(emptyList()) }
    var subs by remember { mutableStateOf<List<SubPortfolioResponse>>(emptyList()) }
    var existing by remember { mutableStateOf<TradeResponse?>(null) }

    var type by remember { mutableStateOf(TradeType.BUY) }
    var date by remember { mutableStateOf(Instant.now()) }
    var quantityText by remember { mutableStateOf("") }
    var priceText by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var subPortfolioId by remember { mutableStateOf(presetSubPortfolioId) }
    var assetId by remember { mutableStateOf<String?>(null) }
    var accountId by remember { mutableStateOf<String?>(null) }
    var settleFromCash by remember { mutableStateOf(false) }
    var showNewAsset by remember { mutableStateOf(false) }

    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(tradeId, sessionVm.activeHousehold?.id) {
        val h = sessionVm.activeHousehold ?: return@LaunchedEffect
        try {
            coroutineScope {
                val a = async { Api.get<List<AccountResponse>>("/accounts/household/${h.id}") }
                val t = async { Api.get<List<AssetResponse>>("/portfolio/assets") }
                val s = async { Api.get<List<SubPortfolioResponse>>("/portfolio/subportfolios/household/${h.id}") }
                accounts = a.await()
                assets = t.await()
                subs = s.await()
            }
            if (tradeId != null) {
                // Trades are only listed per household — there's no single-trade GET route.
                val trade = Api.get<List<TradeResponse>>("/portfolio/trades/household/${h.id}")
                    .firstOrNull { it.id == tradeId } ?: return@LaunchedEffect
                existing = trade
                type = trade.type
                date = trade.date
                quantityText = trade.quantity.toString()
                priceText = trade.price.toString()
                description = trade.description.orEmpty()
                subPortfolioId = trade.subPortfolioId
                assetId = trade.assetId
                accountId = trade.accountId
            } else {
                if (subPortfolioId == null) {
                    subPortfolioId = (subs.firstOrNull { it.id == h.defaultSubPortfolioId } ?: subs.firstOrNull())?.id
                }
                if (accountId == null) {
                    accountId = (accounts.firstOrNull { it.id == h.defaultFundingAccountId }
                        ?: accounts.firstOrNull())?.id
                }
            }
        } catch (e: Exception) {
            error = e.message ?: "Couldn't load the form."
        }
    }

    val tradableAssets = assets.filter { !it.isCash }.sortedBy { it.ticker }
    val selectedAsset = assets.firstOrNull { it.id == assetId }
    val quantity = CalculatorInput.evaluateArithmeticExpression(quantityText)
    val price = CalculatorInput.evaluateArithmeticExpression(priceText)
    val canSave = (quantity ?: 0.0) > 0 && (price ?: 0.0) > 0 &&
        subPortfolioId != null && assetId != null && accountId != null && !saving

    fun save() {
        val h = sessionVm.activeHousehold ?: return
        if (!canSave) return
        saving = true
        error = null
        scope.launch {
            try {
                val current = existing
                if (current != null) {
                    Api.put<TradeUpdate, TradeResponse>(
                        "/portfolio/trades/${current.id}",
                        TradeUpdate(
                            type = type,
                            date = date,
                            quantity = quantity,
                            price = price,
                            currency = selectedAsset?.currency,
                            exchangeRate = current.exchangeRate,
                            description = description.ifBlank { null },
                            subPortfolioId = subPortfolioId,
                            assetId = assetId,
                            accountId = accountId,
                        ),
                    )
                } else {
                    Api.post<TradeCreate, TradeResponse>(
                        "/portfolio/trades",
                        TradeCreate(
                            type = type,
                            date = date,
                            quantity = quantity!!,
                            price = price!!,
                            currency = selectedAsset?.currency,
                            exchangeRate = 1.0,
                            description = description.ifBlank { null },
                            householdId = h.id,
                            subPortfolioId = subPortfolioId!!,
                            assetId = assetId!!,
                            accountId = accountId!!,
                            settleFromCash = settleFromCash,
                        ),
                    )
                }
                onSaved()
            } catch (e: Exception) {
                error = e.message ?: "Couldn't save that trade."
            } finally {
                saving = false
            }
        }
    }

    DetailScaffold(
        title = if (existing == null) "Record trade" else "Edit trade",
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
                    options = TradeType.entries,
                    selected = type,
                    optionLabel = { it.label },
                    onSelect = { type = it },
                )
                DropdownField(
                    label = "Sub-portfolio",
                    selected = subs.firstOrNull { it.id == subPortfolioId },
                    options = subs,
                    optionLabel = { it.name },
                    onSelect = { subPortfolioId = it.id },
                )
                DropdownField(
                    label = "Asset",
                    selected = tradableAssets.firstOrNull { it.id == assetId },
                    options = tradableAssets,
                    optionLabel = { "${it.ticker} — ${it.name}" },
                    onSelect = { assetId = it.id },
                )
                TextButton(onClick = { showNewAsset = true }) {
                    Icon(Icons.Filled.AddCircleOutline, contentDescription = null)
                    Text("  New asset")
                }
            }

            SectionCard {
                MoneyField("Quantity", quantityText, { quantityText = it })
                MoneyField("Price", priceText, { priceText = it }, currencyCode = selectedAsset?.currency)
                DateField("Date", date) { date = it }
                if (quantity != null && price != null && selectedAsset != null) {
                    Text(
                        "Estimated total: ${(quantity * price).currency(selectedAsset.currency)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            SectionCard {
                if (existing == null) {
                    SwitchRow(
                        title = "Settle from sub-portfolio cash",
                        subtitle = "Uses the sub-portfolio's own cash instead of moving money " +
                            "out of a household account.",
                        checked = settleFromCash,
                        onCheckedChange = { settleFromCash = it },
                    )
                }
                DropdownField(
                    label = "Funding account",
                    selected = accounts.firstOrNull { it.id == accountId },
                    options = selectableAccounts(accounts),
                    optionLabel = { it.name },
                    onSelect = { accountId = it.id },
                )
                FormField("Description (optional)", description, { description = it })
            }

            Button(onClick = ::save, enabled = canSave) {
                Text(if (saving) "Saving…" else "Save trade")
            }
        }
    }

    if (showNewAsset) {
        AssetCreateDialog(
            defaultCurrency = selectedAsset?.currency
                ?: sessionVm.activeHousehold?.baseCurrency
                ?: "USD",
            onDismiss = { showNewAsset = false },
            onCreated = { created ->
                assets = assets + created
                assetId = created.id
            },
        )
    }
}
