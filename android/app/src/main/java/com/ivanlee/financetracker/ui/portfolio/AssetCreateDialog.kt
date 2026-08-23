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
import com.ivanlee.financetracker.data.net.Api
import com.ivanlee.financetracker.ui.components.DropdownField
import com.ivanlee.financetracker.ui.components.FormField
import com.ivanlee.financetracker.ui.components.SegmentedChoice
import kotlinx.coroutines.launch
import java.util.UUID

/** Asset classes the backend recognises, minus `cash` — that pseudo-asset is created for you. */
internal val ASSET_TYPES = listOf("stock", "etf", "bond", "crypto", "commodity", "other")

/**
 * Add a tradable asset.
 *
 * `pricing_mode` matters more than it looks: **auto** assets get their price from yfinance by
 * ticker, **manual** ones only ever have the prices you record. Picking auto for something
 * yfinance doesn't know leaves a holding permanently valued at its cost basis.
 */
@Composable
fun AssetCreateDialog(
    defaultCurrency: String,
    onDismiss: () -> Unit,
    onCreated: (AssetResponse) -> Unit,
) {
    var ticker by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var type by remember { mutableStateOf("stock") }
    var currency by remember { mutableStateOf(defaultCurrency) }
    var manualPricing by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("New asset") },
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
                    optionLabel = { if (it) "Manual price" else "Auto price" },
                    onSelect = { manualPricing = it },
                )
                Text(
                    if (manualPricing) {
                        "You'll record prices yourself. Use this for anything not on a public market."
                    } else {
                        "Prices are fetched by ticker. If the ticker isn't recognised, the holding " +
                            "will stay stuck at cost."
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
                    scope.launch {
                        try {
                            val created = Api.post<AssetCreate, AssetResponse>(
                                "/portfolio/assets",
                                AssetCreate(
                                    // Client-generated, matching the backend's AssetCreate contract.
                                    id = UUID.randomUUID().toString(),
                                    ticker = ticker.trim().uppercase(),
                                    name = name.trim().ifEmpty { ticker.trim().uppercase() },
                                    type = type,
                                    currency = currency.trim().uppercase(),
                                    pricingMode = if (manualPricing) "manual" else "market",
                                ),
                            )
                            onCreated(created)
                            onDismiss()
                        } catch (e: Exception) {
                            error = e.message ?: "Couldn't create that asset."
                        } finally {
                            saving = false
                        }
                    }
                },
            ) { Text("Create") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
