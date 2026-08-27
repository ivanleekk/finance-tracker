package com.ivanlee.financetracker.ui.more

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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.ivanlee.financetracker.BuildConfig
import com.ivanlee.financetracker.data.model.HouseholdCreate
import com.ivanlee.financetracker.data.model.ReferenceCurrency
import com.ivanlee.financetracker.data.model.ReferenceTimezone
import com.ivanlee.financetracker.data.model.UserUpdate
import com.ivanlee.financetracker.data.net.Api
import com.ivanlee.financetracker.state.SessionViewModel
import com.ivanlee.financetracker.state.ViewModeViewModel
import com.ivanlee.financetracker.ui.components.DetailScaffold
import com.ivanlee.financetracker.ui.components.DropdownField
import com.ivanlee.financetracker.ui.components.FormField
import com.ivanlee.financetracker.ui.components.SearchablePickerDialog
import com.ivanlee.financetracker.ui.components.SectionCard
import com.ivanlee.financetracker.ui.components.SegmentedChoice
import com.ivanlee.financetracker.ui.components.SwitchRow
import com.ivanlee.financetracker.ui.theme.AppTheme
import kotlinx.coroutines.launch

/** Shared scaffold for the settings pages — a form column with a save button. */
@Composable
private fun SettingsPage(
    title: String,
    onBack: () -> Unit,
    error: String?,
    onErrorShown: () -> Unit,
    content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit,
) {
    DetailScaffold(title = title, onBack = onBack, error = error, onErrorShown = onErrorShown) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            content = content,
        )
    }
}

/** Name + preferred timezone. */
@Composable
fun ProfileSettingsScreen(sessionVm: SessionViewModel, onBack: () -> Unit) {
    var name by remember { mutableStateOf(sessionVm.user?.name.orEmpty()) }
    var timezone by remember { mutableStateOf(sessionVm.user?.preferredTimezone.orEmpty()) }
    var timezones by remember { mutableStateOf<List<ReferenceTimezone>>(emptyList()) }
    var showPicker by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        timezones = runCatching { Api.get<List<ReferenceTimezone>>("/reference/timezones") }
            .getOrDefault(emptyList())
    }

    SettingsPage("Profile", onBack, error, { error = null }) {
        SectionCard {
            FormField("Name", name, { name = it })
            FormField(
                "Timezone",
                timezone.ifBlank { "Device default" },
                {},
                supportingText = "Used for report periods and recurring due dates",
                trailingIcon = { TextButton(onClick = { showPicker = true }) { Text("Change") } },
            )
        }
        // Saves on toggle rather than waiting for the button below, which applies to
        // the text fields. Standard for switches, and it keeps the setting honest:
        // what you see is what the server has.
        SectionCard {
            SwitchRow(
                title = "Record merchant codes",
                subtitle = "Adds an optional MCC field when logging a transaction. Nothing is " +
                    "calculated from it — it's recorded so you can look it up later, and it's " +
                    "fine to leave blank when you don't know it.",
                checked = sessionVm.user?.recordsMerchantCodes ?: false,
                onCheckedChange = { value ->
                    scope.launch {
                        try {
                            sessionVm.updateUser(UserUpdate(recordMerchantCodes = value))
                        } catch (e: Exception) {
                            error = e.message ?: "Couldn't save that setting."
                        }
                    }
                },
            )
        }
        Button(
            enabled = name.isNotBlank() && !saving,
            onClick = {
                saving = true
                scope.launch {
                    try {
                        sessionVm.updateUser(
                            UserUpdate(
                                name = name.trim(),
                                preferredTimezone = timezone.ifBlank { null },
                            )
                        )
                        onBack()
                    } catch (e: Exception) {
                        error = e.message ?: "Couldn't save your profile."
                    } finally {
                        saving = false
                    }
                }
            },
        ) { Text(if (saving) "Saving…" else "Save") }
    }

    if (showPicker) {
        SearchablePickerDialog(
            title = "Timezone",
            options = timezones,
            optionLabel = { it.label },
            optionKey = { it.name },
            searchText = { "${it.label} ${it.name}" },
            onSelect = { timezone = it.name },
            onDismiss = { showPicker = false },
        )
    }
}

/** Change email / password. Both go through the same partial PUT /users. */
@Composable
fun SecuritySettingsScreen(sessionVm: SessionViewModel, onBack: () -> Unit) {
    var email by remember { mutableStateOf(sessionVm.user?.email.orEmpty()) }
    var password by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    val passwordsMatch = password.isEmpty() || password == confirm
    val canSave = email.isNotBlank() && passwordsMatch &&
        (password.isEmpty() || password.length >= 6) && !saving

    SettingsPage("Email & password", onBack, error, { error = null }) {
        SectionCard(title = "Email") {
            FormField("Email", email, { email = it }, keyboardType = KeyboardType.Email)
        }
        SectionCard(title = "New password") {
            FormField(
                "New password", password, { password = it },
                keyboardType = KeyboardType.Password,
                supportingText = "Leave blank to keep your current password",
            )
            FormField(
                "Confirm password", confirm, { confirm = it },
                keyboardType = KeyboardType.Password,
                isError = !passwordsMatch,
                supportingText = if (!passwordsMatch) "Passwords don't match" else null,
            )
        }
        notice?.let { Text(it, color = MaterialTheme.colorScheme.primary) }
        Button(
            enabled = canSave,
            onClick = {
                saving = true
                scope.launch {
                    try {
                        sessionVm.updateUser(
                            UserUpdate(
                                email = email.trim(),
                                password = password.ifBlank { null },
                            )
                        )
                        password = ""
                        confirm = ""
                        notice = "Saved."
                    } catch (e: Exception) {
                        error = e.message ?: "Couldn't save those changes."
                    } finally {
                        saving = false
                    }
                }
            },
        ) { Text(if (saving) "Saving…" else "Save") }
    }
}

/**
 * The private vault settings. Each toggle saves immediately — these are single-switch
 * decisions, and a "Save" button on a screen of three switches is friction with no payoff.
 */
@Composable
fun PrivacySettingsScreen(
    sessionVm: SessionViewModel,
    viewModeVm: ViewModeViewModel,
    onBack: () -> Unit,
) {
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val user = sessionVm.user

    fun update(update: UserUpdate) {
        scope.launch {
            try {
                sessionVm.updateUser(update)
            } catch (e: Exception) {
                error = e.message ?: "Couldn't save that setting."
            }
        }
    }

    SettingsPage("Privacy & vault", onBack, error, { error = null }) {
        SectionCard {
            SwitchRow(
                title = "Hide my private items from the household",
                subtitle = "Other members never see accounts or goals you've marked private.",
                checked = user?.hidesPrivateFromHousehold ?: true,
                onCheckedChange = { update(UserUpdate(hidePrivateFromHousehold = it)) },
            )
            SwitchRow(
                title = "New entries are private by default",
                subtitle = "Pre-ticks the Private switch on new accounts and goals.",
                checked = user?.defaultsNewItemsPrivate ?: true,
                onCheckedChange = { update(UserUpdate(defaultNewItemsPrivate = it)) },
            )
            SwitchRow(
                title = "Require unlock for private items",
                subtitle = "Fingerprint, face or device PIN before private balances appear. " +
                    "On a device with no screen lock this stays off, so you can't be locked out.",
                checked = user?.requiresBiometricForVault ?: false,
                onCheckedChange = { update(UserUpdate(requireBiometricForVault = it)) },
            )
        }
        if (viewModeVm.vaultLockActive) {
            SectionCard {
                Text(
                    if (viewModeVm.isVaultLocked) "Vault is locked." else "Vault is unlocked for this session.",
                    style = MaterialTheme.typography.bodyMedium,
                )
                TextButton(onClick = { viewModeVm.lockVault() }) { Text("Lock now") }
            }
        }
    }
}

/** Household name + base reporting currency. */
@Composable
fun HouseholdSettingsScreen(sessionVm: SessionViewModel, onBack: () -> Unit) {
    val household = sessionVm.activeHousehold
    var name by remember(household?.id) { mutableStateOf(household?.name.orEmpty()) }
    var baseCurrency by remember(household?.id) { mutableStateOf(household?.baseCurrency.orEmpty()) }
    var currencies by remember { mutableStateOf<List<ReferenceCurrency>>(emptyList()) }
    var showPicker by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        currencies = runCatching { Api.get<List<ReferenceCurrency>>("/reference/currencies") }
            .getOrDefault(emptyList())
    }

    SettingsPage("Household settings", onBack, error, { error = null }) {
        SectionCard {
            FormField("Name", name, { name = it })
            FormField(
                "Base currency",
                baseCurrency,
                {},
                supportingText = "Everything aggregate — net worth, portfolio, reports — is totalled in this",
                trailingIcon = { TextButton(onClick = { showPicker = true }) { Text("Change") } },
            )
        }
        Button(
            enabled = household != null && name.isNotBlank() && !saving,
            onClick = {
                val id = household?.id ?: return@Button
                saving = true
                scope.launch {
                    try {
                        sessionVm.updateHousehold(id, name = name.trim(), baseCurrency = baseCurrency)
                        onBack()
                    } catch (e: Exception) {
                        error = e.message ?: "Couldn't save the household."
                    } finally {
                        saving = false
                    }
                }
            },
        ) { Text(if (saving) "Saving…" else "Save") }
    }

    if (showPicker) {
        SearchablePickerDialog(
            title = "Base currency",
            options = currencies,
            optionLabel = { "${it.code} — ${it.name}" },
            optionKey = { it.code },
            onSelect = { baseCurrency = it.code },
            onDismiss = { showPicker = false },
        )
    }
}

/** Create an additional household and switch to it. */
@Composable
fun CreateHouseholdScreen(sessionVm: SessionViewModel, onBack: () -> Unit, onCreated: () -> Unit) {
    var name by remember { mutableStateOf("") }
    var baseCurrency by remember { mutableStateOf(sessionVm.activeHousehold?.baseCurrency ?: "USD") }
    var countryCode by remember { mutableStateOf(sessionVm.activeHousehold?.countryCode ?: "US") }
    var currencies by remember { mutableStateOf<List<ReferenceCurrency>>(emptyList()) }
    var showPicker by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        currencies = runCatching { Api.get<List<ReferenceCurrency>>("/reference/currencies") }
            .getOrDefault(emptyList())
    }

    SettingsPage("Create household", onBack, error, { error = null }) {
        SectionCard {
            FormField("Name", name, { name = it }, placeholder = "Shared finances")
            FormField(
                "Base currency", baseCurrency, {},
                trailingIcon = { TextButton(onClick = { showPicker = true }) { Text("Change") } },
            )
            FormField("Country code", countryCode, { countryCode = it.uppercase() })
        }
        Button(
            enabled = name.isNotBlank() && !saving,
            onClick = {
                saving = true
                scope.launch {
                    try {
                        sessionVm.createHousehold(name.trim(), baseCurrency, countryCode.trim().uppercase())
                        onCreated()
                    } catch (e: Exception) {
                        error = e.message ?: "Couldn't create that household."
                    } finally {
                        saving = false
                    }
                }
            },
        ) { Text(if (saving) "Creating…" else "Create household") }
    }

    if (showPicker) {
        SearchablePickerDialog(
            title = "Base currency",
            options = currencies,
            optionLabel = { "${it.code} — ${it.name}" },
            optionKey = { it.code },
            onSelect = { baseCurrency = it.code },
            onDismiss = { showPicker = false },
        )
    }
}

/**
 * Theme mode and palette.
 *
 * These are backend-stored preferences shared with web and iOS, which is why the app doesn't
 * use Material You dynamic colour — the same account should look like the same account on
 * every device.
 */
@Composable
fun AppearanceSettingsScreen(sessionVm: SessionViewModel, onBack: () -> Unit) {
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val user = sessionVm.user

    fun apply(
        themeMode: String? = null,
        primary: String? = null,
        secondary: String? = null,
        base: String? = null,
    ) {
        scope.launch {
            try {
                sessionVm.updateAppearance(themeMode, primary, secondary, base)
            } catch (e: Exception) {
                error = e.message ?: "Couldn't save your appearance settings."
            }
        }
    }

    SettingsPage("Appearance", onBack, error, { error = null }) {
        SectionCard(title = "Theme") {
            SegmentedChoice(
                options = listOf("system", "light", "dark"),
                selected = user?.themeMode ?: "system",
                optionLabel = { it.replaceFirstChar(Char::titlecase) },
                onSelect = { apply(themeMode = it) },
            )
        }
        SectionCard(title = "Colours") {
            DropdownField(
                label = "Primary",
                selected = user?.primaryColor ?: AppTheme.primaryChoices.first(),
                options = AppTheme.primaryChoices,
                optionLabel = { it.replaceFirstChar(Char::titlecase) },
                onSelect = { apply(primary = it) },
            )
            DropdownField(
                label = "Secondary",
                selected = user?.secondaryColor ?: AppTheme.secondaryChoices.first(),
                options = AppTheme.secondaryChoices,
                optionLabel = { it.replaceFirstChar(Char::titlecase) },
                onSelect = { apply(secondary = it) },
            )
            DropdownField(
                label = "Base",
                selected = user?.baseColor ?: AppTheme.baseChoices.first(),
                options = AppTheme.baseChoices,
                optionLabel = { it.replaceFirstChar(Char::titlecase) },
                onSelect = { apply(base = it) },
            )
            Text(
                "Your colour choices follow you to the web and iOS apps.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/**
 * Debug-only backend override, for pointing a physical device at a Mac on the LAN. The
 * screen isn't routed at all in release builds, and [Api.baseUrl] ignores the value there.
 */
@Composable
fun ApiServerScreen(onBack: () -> Unit) {
    var value by remember { mutableStateOf(Api.currentOverride().orEmpty()) }
    var notice by remember { mutableStateOf<String?>(null) }

    SettingsPage("API server", onBack, null, {}) {
        SectionCard {
            FormField(
                "Base URL override",
                value,
                { value = it },
                placeholder = "http://192.168.1.20:8000",
                supportingText = "Blank uses the built-in ${BuildConfig.API_BASE_URL}",
            )
            Text(
                "Currently: ${Api.baseUrl}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            notice?.let { Text(it, color = MaterialTheme.colorScheme.primary) }
        }
        Button(onClick = {
            Api.setBaseUrlOverride(value.ifBlank { null })
            notice = "Saved — log out and back in to reconnect."
        }) { Text("Save") }
    }
}
