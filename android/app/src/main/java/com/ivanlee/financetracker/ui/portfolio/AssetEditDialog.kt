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
import com.ivanlee.financetracker.data.model.AssetResponse
import com.ivanlee.financetracker.data.model.AssetUpdate
import com.ivanlee.financetracker.data.net.Api
import com.ivanlee.financetracker.ui.components.DropdownField
import com.ivanlee.financetracker.ui.components.FormField
import com.ivanlee.financetracker.ui.components.SegmentedChoice
import kotlinx.coroutines.launch

/**
 * Correct an asset's identity (PUT /portfolio/assets/{id}).
 *
 * The case this exists for: a ticker created with the wrong currency -- a Singapore listing
 * entered as USD -- which quietly misvalues every snapshot it appears in. Ticker and currency
 * are the two fields that reach back into history: saving either one replays the holding
 * households' snapshots server-side, so the caller reloads rather than patching in place.
 */
@Composable
fun AssetEditDialog(
    asset: AssetResponse,
    onDismiss: () -> Unit,
    onSaved: () -> Unit,
) {
    var ticker by remember { mutableStateOf(asset.ticker) }
    var name by remember { mutableStateOf(asset.name) }
    // Existing assets carry types the create form never offered ("Bond" with a capital B,
    // or something typed on another client). Keep the asset's own value in the list, exactly
    // as stored -- not case-folded onto a list entry, which would silently rewrite the label
    // the allocation chart groups by on a save the user meant as a no-op.
    val typeOptions = remember(asset.type) {
        if (asset.type in ASSET_TYPES) ASSET_TYPES else ASSET_TYPES + asset.type
    }
    var type by remember { mutableStateOf(asset.type) }
    var currency by remember { mutableStateOf(asset.currency) }
    var manualPricing by remember { mutableStateOf(asset.isManualPriced) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    val revaluesHistory = ticker.trim().uppercase() != asset.ticker ||
        currency.trim().uppercase() != asset.currency

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Edit ${asset.ticker}") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                FormField(
                    "Ticker", ticker, { ticker = it.uppercase() },
                    supportingText = "Exactly as your market data provider spells it",
                )
                FormField("Name", name, { name = it })
                DropdownField(
                    label = "Type",
                    selected = type,
                    options = typeOptions,
                    optionLabel = { it.replaceFirstChar(Char::titlecase) },
                    onSelect = { type = it },
                )
                FormField("Currency", currency, { currency = it.uppercase() })
                SegmentedChoice(
                    options = listOf(false, true),
                    selected = manualPricing,
                    optionLabel = { if (it) "Manual price" else "Auto price" },
                    onSelect = { manualPricing = it },
                )
                if (revaluesHistory) {
                    Text(
                        "Valuations recalculate back to your first trade in this asset.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            TextButton(
                enabled = ticker.isNotBlank() && currency.trim().length >= 3 && !saving,
                onClick = {
                    saving = true
                    error = null
                    scope.launch {
                        try {
                            Api.put<AssetUpdate, AssetResponse>(
                                "/portfolio/assets/${asset.id}",
                                AssetUpdate(
                                    ticker = ticker.trim().uppercase(),
                                    name = name.trim().ifEmpty { ticker.trim().uppercase() },
                                    type = type,
                                    currency = currency.trim().uppercase(),
                                    pricingMode = if (manualPricing) "manual" else "market",
                                ),
                            )
                            onSaved()
                            onDismiss()
                        } catch (e: Exception) {
                            error = e.message ?: "Couldn't update that asset."
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
