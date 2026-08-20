package com.ivanlee.financetracker.ui.portfolio

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.unit.dp
import com.ivanlee.financetracker.data.model.AssetCreate
import com.ivanlee.financetracker.data.model.AssetResponse
import com.ivanlee.financetracker.data.model.AssetUpdate
import com.ivanlee.financetracker.data.net.Api
import com.ivanlee.financetracker.ui.components.DropdownField
import com.ivanlee.financetracker.ui.components.FormField
import com.ivanlee.financetracker.ui.components.SegmentedChoice
import kotlinx.coroutines.launch
import java.util.UUID

/** Asset classes the backend recognises, minus `cash` — that pseudo-asset is created for you. */
private val ASSET_TYPES = listOf("stock", "etf", "bond", "crypto", "commodity", "other")

/**
 * Add a tradable asset, or correct one that already exists.
 *
 * `pricing_mode` matters more than it looks: **market** assets get their price from yfinance by
 * ticker, **manual** ones only ever have the prices you record. Picking market for something
 * yfinance doesn't know leaves a holding permanently valued at its cost basis. The two wire
 * values are exactly `"market"` and `"manual"` — `schemas.AssetBase.pricing_mode` is a `Literal`,
 * so anything else is rejected with a 422.
 *
 * Pass [existing] to edit (PUT) instead of create (POST). The edit changes the asset itself, so
 * every trade, dividend and holding already filed against it follows the correction.
 */
@Composable
fun AssetFormDialog(
    defaultCurrency: String,
    onDismiss: () -> Unit,
    onSaved: (AssetResponse) -> Unit,
    existing: AssetResponse? = null,
) {
    var ticker by remember { mutableStateOf(existing?.ticker ?: "") }
    var name by remember { mutableStateOf(existing?.name ?: "") }
    var type by remember { mutableStateOf(existing?.type ?: "stock") }
    var currency by remember { mutableStateOf(existing?.currency ?: defaultCurrency) }
    var manualPricing by remember { mutableStateOf(existing?.isManualPriced ?: false) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (existing != null) "Edit asset" else "New asset") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                FormField(
                    "Ticker", ticker, { ticker = it.uppercase() },
                    placeholder = "VWRA.L",
                    supportingText = "Exactly as your market data provider spells it",
                )
                FormField("Name", name, { name = it })
                DropdownField(
                    label = "Type",
                    selected = type,
                    options = ASSET_TYPES,
                    optionLabel = { it.replaceFirstChar(Char::titlecase) },
                    onSelect = { type = it },
                )
                FormField("Currency", currency, { currency = it.uppercase() })
                SegmentedChoice(
                    options = listOf(false, true),
                    selected = manualPricing,
                    optionLabel = { if (it) "Manual price" else "Market price" },
                    onSelect = { manualPricing = it },
                )
                Text(
                    when {
                        manualPricing ->
                            "You'll record prices yourself. Use this for anything not on a public market."
                        existing != null ->
                            "Prices are fetched by ticker. Correcting the ticker applies to every " +
                                "trade, dividend and holding already recorded against this asset."
                        else ->
                            "Prices are fetched by ticker. If the ticker isn't recognised, the " +
                                "holding will stay stuck at cost."
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            TextButton(
                enabled = ticker.isNotBlank() && currency.trim().length >= 3 && !saving,
                onClick = {
                    saving = true
                    error = null
                    val cleanTicker = ticker.trim().uppercase()
                    val cleanCurrency = currency.trim().uppercase()
                    val cleanName = name.trim().ifEmpty { cleanTicker }
                    val pricingMode = if (manualPricing) "manual" else "market"
                    scope.launch {
                        try {
                            val saved = if (existing != null) {
                                // Only send name/currency when they were actually edited here, so
                                // a ticker-only fix lets the backend re-enrich both from Yahoo
                                // Finance (it falls back to the stored values if that lookup fails).
                                Api.put<AssetUpdate, AssetResponse>(
                                    "/portfolio/assets/${existing.id}",
                                    AssetUpdate(
                                        ticker = cleanTicker,
                                        name = cleanName.takeIf { it != existing.name },
                                        type = type,
                                        currency = cleanCurrency.takeIf { it != existing.currency },
                                        pricingMode = pricingMode,
                                    ),
                                )
                            } else {
                                Api.post<AssetCreate, AssetResponse>(
                                    "/portfolio/assets",
                                    AssetCreate(
                                        // Client-generated, matching the backend's AssetCreate contract.
                                        id = UUID.randomUUID().toString(),
                                        ticker = cleanTicker,
                                        name = cleanName,
                                        type = type,
                                        currency = cleanCurrency,
                                        pricingMode = pricingMode,
                                    ),
                                )
                            }
                            onSaved(saved)
                            onDismiss()
                        } catch (e: Exception) {
                            val fallback = if (existing != null) {
                                "Couldn't save that asset."
                            } else {
                                "Couldn't create that asset."
                            }
                            error = e.message ?: fallback
                        } finally {
                            saving = false
                        }
                    }
                },
            ) { Text(if (existing != null) "Save" else "Create") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
