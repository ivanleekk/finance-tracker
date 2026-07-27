package com.ivanlee.financetracker.ui.auth

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddCircleOutline
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ivanlee.financetracker.data.model.LiquidityStatus
import com.ivanlee.financetracker.data.model.ReferenceCurrency
import com.ivanlee.financetracker.data.model.UserUpdate
import com.ivanlee.financetracker.data.net.Api
import com.ivanlee.financetracker.state.SessionViewModel
import com.ivanlee.financetracker.ui.components.FormField
import com.ivanlee.financetracker.ui.components.MoneyField
import com.ivanlee.financetracker.ui.components.SearchablePickerDialog
import com.ivanlee.financetracker.ui.components.SwitchRow
import com.ivanlee.financetracker.ui.theme.LocalAppTheme
import com.ivanlee.financetracker.ui.theme.luminanceIsDark
import kotlinx.coroutines.launch

/**
 * Guided first-run setup — the Android counterpart of the web `/onboarding` flow and
 * ios/FinanceTracker/Views/Auth/OnboardingView.swift.
 *
 * Backend `POST /users` doesn't create a household, so a brand-new signup would otherwise land
 * in an empty app. Step 1 **always** creates the household, even on "Skip", so the app is
 * never entered without one; `SessionViewModel.isOnboarding` keeps this screen mounted across
 * step 1 (which makes `households` non-empty) until the user actually finishes.
 */
@Composable
fun OnboardingScreen(sessionVm: SessionViewModel) {
    var step by remember { mutableIntStateOf(1) }
    var baseCurrency by remember { mutableStateOf("USD") }
    var showCurrencyPicker by remember { mutableStateOf(false) }
    var currencies by remember { mutableStateOf<List<ReferenceCurrency>>(emptyList()) }

    // Step 1 — starter accounts (mirror web presets) + privacy default.
    var addCash by remember { mutableStateOf(false) }
    var cashBalance by remember { mutableStateOf("") }
    var addInvestment by remember { mutableStateOf(false) }
    var investmentBalance by remember { mutableStateOf("") }
    var defaultPrivate by remember { mutableStateOf(true) }

    // Step 2 — household name + optional invite.
    var householdName by remember { mutableStateOf("") }
    var inviteEmail by remember { mutableStateOf("") }

    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val scope = rememberCoroutineScope()
    val theme = LocalAppTheme.current
    val dark = MaterialTheme.colorScheme.background.luminanceIsDark()
    val quickCurrencies = listOf("USD", "SGD", "EUR", "GBP")

    val defaultHouseholdName = sessionVm.user?.name
        ?.takeIf { it.isNotBlank() }
        ?.let { "$it's finances" }
        ?: "My finances"

    LaunchedEffect(sessionVm.user?.id) {
        if (householdName.isBlank()) householdName = defaultHouseholdName
        defaultPrivate = sessionVm.user?.defaultsNewItemsPrivate ?: true
        currencies = runCatching { Api.get<List<ReferenceCurrency>>("/reference/currencies") }
            .getOrDefault(emptyList())
    }

    fun runFastSetup(skipPresets: Boolean) {
        busy = true
        error = null
        scope.launch {
            try {
                val name = householdName.trim().ifEmpty { defaultHouseholdName }
                sessionVm.createHousehold(name, baseCurrency, "US")
                sessionVm.updateUser(UserUpdate(defaultNewItemsPrivate = defaultPrivate))

                val householdId = sessionVm.activeHousehold?.id
                if (householdId == null) {
                    error = "Could not create your household. Please try again."
                    return@launch
                }
                val owner = if (defaultPrivate) sessionVm.user?.id else null
                if (!skipPresets && addCash) {
                    sessionVm.createPresetAccount(
                        householdId, "Cash account", LiquidityStatus.LIQUID,
                        baseCurrency, owner, cashBalance.toDoubleOrNull() ?: 0.0,
                    )
                }
                if (!skipPresets && addInvestment) {
                    sessionVm.createPresetAccount(
                        householdId, "Investment account", LiquidityStatus.MARKET_LIQUID,
                        baseCurrency, owner, investmentBalance.toDoubleOrNull() ?: 0.0,
                    )
                }
                step = 2
            } catch (e: Exception) {
                error = e.message ?: "Something went wrong."
            } finally {
                busy = false
            }
        }
    }

    fun finishHousehold() {
        busy = true
        error = null
        scope.launch {
            try {
                val householdId = sessionVm.activeHousehold?.id
                if (householdId == null) {
                    sessionVm.finishOnboarding()
                    return@launch
                }
                val name = householdName.trim()
                if (name.isNotEmpty() && name != sessionVm.activeHousehold?.name) {
                    sessionVm.updateHousehold(householdId, name = name)
                }
                val email = inviteEmail.trim()
                if (email.isNotEmpty()) sessionVm.sendInvite(householdId, email)
                sessionVm.finishOnboarding()
            } catch (e: Exception) {
                error = e.message ?: "Something went wrong."
            } finally {
                busy = false
            }
        }
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(
                Brush.linearGradient(
                    listOf(
                        theme.secondary.accent(dark).copy(alpha = 0.12f),
                        MaterialTheme.colorScheme.background,
                        theme.primary.accent(dark).copy(alpha = 0.10f),
                    )
                )
            ),
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .systemBarsPadding()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            Column(
                Modifier.widthIn(max = 520.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                LinearProgressIndicator(
                    progress = { if (step == 1) 0.5f else 1f },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(6.dp),
                )
                Text(
                    "STEP $step / 2",
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 1.5.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Card(
                Modifier.widthIn(max = 520.dp),
                shape = RoundedCornerShape(24.dp),
                colors = CardDefaults.elevatedCardColors(),
                elevation = CardDefaults.elevatedCardElevation(defaultElevation = 4.dp),
            ) {
                Column(
                    Modifier.padding(22.dp),
                    verticalArrangement = Arrangement.spacedBy(20.dp),
                ) {
                    if (step == 1) {
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(
                                "Set up in 30 seconds",
                                style = MaterialTheme.typography.headlineSmall,
                                fontWeight = FontWeight.Bold,
                            )
                            Text(
                                "Everything here has a smart default — change only what you want.",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }

                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("Base currency", style = MaterialTheme.typography.titleSmall)
                            Text(
                                "How your net worth and portfolio are totalled.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Row(
                                Modifier.horizontalScroll(rememberScrollState()),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                quickCurrencies.forEach { code ->
                                    FilterChip(
                                        selected = baseCurrency == code,
                                        onClick = { baseCurrency = code },
                                        label = { Text(code) },
                                    )
                                }
                                FilterChip(
                                    selected = baseCurrency !in quickCurrencies,
                                    onClick = { showCurrencyPicker = true },
                                    label = {
                                        Text(if (baseCurrency in quickCurrencies) "More…" else baseCurrency)
                                    },
                                )
                            }
                        }

                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("Add your first account", style = MaterialTheme.typography.titleSmall)
                            Text(
                                "Optional — tap a preset and enter its current balance.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            PresetAccountCard(
                                emoji = "💰",
                                title = "Cash account",
                                enabled = addCash,
                                onToggle = { addCash = !addCash },
                                balance = cashBalance,
                                onBalanceChange = { cashBalance = it },
                                currency = baseCurrency,
                            )
                            PresetAccountCard(
                                emoji = "📈",
                                title = "Investment account",
                                enabled = addInvestment,
                                onToggle = { addInvestment = !addInvestment },
                                balance = investmentBalance,
                                onBalanceChange = { investmentBalance = it },
                                currency = baseCurrency,
                            )
                        }

                        SwitchRow(
                            title = "New entries are private by default",
                            subtitle = "Keep new accounts and goals to yourself until you share them.",
                            checked = defaultPrivate,
                            onCheckedChange = { defaultPrivate = it },
                        )

                        error?.let {
                            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                        }

                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            OutlinedButton(
                                onClick = { runFastSetup(skipPresets = true) },
                                enabled = !busy,
                                modifier = Modifier.weight(1f),
                            ) { Text("Skip") }
                            Button(
                                onClick = { runFastSetup(skipPresets = false) },
                                enabled = !busy,
                                modifier = Modifier.weight(1f),
                            ) { Text(if (busy) "Setting up…" else "Continue") }
                        }
                    } else {
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(
                                "Share with a household?",
                                style = MaterialTheme.typography.headlineSmall,
                                fontWeight = FontWeight.Bold,
                            )
                            Text(
                                "Optional. Track shared money with a partner or family, kept separate " +
                                    "from your private accounts. You can always do this later.",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }

                        FormField(
                            label = "Household name",
                            value = householdName,
                            onValueChange = { householdName = it },
                            placeholder = "My finances",
                        )
                        FormField(
                            label = "Invite by email (optional)",
                            value = inviteEmail,
                            onValueChange = { inviteEmail = it },
                            placeholder = "partner@example.com",
                            keyboardType = KeyboardType.Email,
                        )

                        error?.let {
                            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                        }

                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            OutlinedButton(
                                onClick = { sessionVm.finishOnboarding() },
                                enabled = !busy,
                                modifier = Modifier.weight(1f),
                            ) { Text("Skip for now") }
                            Button(
                                onClick = { finishHousehold() },
                                enabled = !busy,
                                modifier = Modifier.weight(1f),
                            ) { Text(if (busy) "Finishing…" else "Create & finish") }
                        }
                    }
                }
            }
        }
    }

    if (showCurrencyPicker) {
        SearchablePickerDialog(
            title = "Base currency",
            options = currencies,
            optionLabel = { "${it.code} — ${it.name}" },
            optionKey = { it.code },
            onSelect = { baseCurrency = it.code },
            onDismiss = { showCurrencyPicker = false },
        )
    }
}

/** A togglable "starter account" preset with an inline balance field when enabled. */
@Composable
private fun PresetAccountCard(
    emoji: String,
    title: String,
    enabled: Boolean,
    onToggle: () -> Unit,
    balance: String,
    onBalanceChange: (String) -> Unit,
    currency: String,
) {
    Card(
        Modifier
            .fillMaxWidth()
            .border(
                width = 1.5.dp,
                color = if (enabled) MaterialTheme.colorScheme.primary.copy(alpha = 0.5f)
                else androidx.compose.ui.graphics.Color.Transparent,
                shape = RoundedCornerShape(14.dp),
            ),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
        ),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .clickable(onClick = onToggle),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("$emoji  $title", style = MaterialTheme.typography.bodyLarge)
                Icon(
                    if (enabled) Icons.Filled.CheckCircle else Icons.Filled.AddCircleOutline,
                    contentDescription = if (enabled) "Remove" else "Add",
                    tint = if (enabled) MaterialTheme.colorScheme.primary
                    else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            AnimatedVisibility(visible = enabled) {
                MoneyField(
                    label = "Current balance",
                    value = balance,
                    onValueChange = onBalanceChange,
                    currencyCode = currency,
                )
            }
        }
    }
}
