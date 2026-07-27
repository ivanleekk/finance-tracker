package com.ivanlee.financetracker.ui.accounts

import androidx.compose.animation.AnimatedVisibility
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
import androidx.compose.ui.unit.dp
import com.ivanlee.financetracker.data.model.AccountCreate
import com.ivanlee.financetracker.data.model.AccountKind
import com.ivanlee.financetracker.data.model.AccountResponse
import com.ivanlee.financetracker.data.model.AccountUpdate
import com.ivanlee.financetracker.data.model.LiquidityStatus
import com.ivanlee.financetracker.data.model.TaxTreatment
import com.ivanlee.financetracker.data.net.Api
import com.ivanlee.financetracker.data.net.apiDateOnly
import com.ivanlee.financetracker.state.SessionViewModel
import com.ivanlee.financetracker.ui.components.DateField
import com.ivanlee.financetracker.ui.components.DetailScaffold
import com.ivanlee.financetracker.ui.components.DropdownField
import com.ivanlee.financetracker.ui.components.FormField
import com.ivanlee.financetracker.ui.components.MoneyField
import com.ivanlee.financetracker.ui.components.SectionCard
import com.ivanlee.financetracker.ui.components.SegmentedChoice
import com.ivanlee.financetracker.ui.components.SwitchRow
import kotlinx.coroutines.launch
import java.time.Instant

/**
 * Create or edit an account, including optional loan terms (liabilities) and property terms
 * (illiquid assets). Android port of `AccountFormView`.
 *
 * Loan/property numbers are held as text so a **blank** field means "not set" rather than 0 —
 * the backend treats a partial set of terms as no terms at all and keeps the flat balance,
 * and sending 0 would look like a real value.
 */
@Composable
fun AccountFormScreen(
    accountId: String?,
    sessionVm: SessionViewModel,
    onBack: () -> Unit,
    onSaved: () -> Unit,
) {
    var existing by remember { mutableStateOf<AccountResponse?>(null) }
    var propertyAccounts by remember { mutableStateOf<List<AccountResponse>>(emptyList()) }

    var name by remember { mutableStateOf("") }
    var liquidity by remember { mutableStateOf(LiquidityStatus.LIQUID) }
    var taxStatus by remember { mutableStateOf(TaxTreatment.TAXABLE) }
    var kind by remember { mutableStateOf(AccountKind.ASSET) }
    var currency by remember { mutableStateOf("") }
    var isPrivate by remember { mutableStateOf(false) }
    var seededPrivacy by remember { mutableStateOf(false) }

    var principalText by remember { mutableStateOf("") }
    var rateText by remember { mutableStateOf("") }
    var termMonthsText by remember { mutableStateOf("") }
    var paymentText by remember { mutableStateOf("") }
    var hasLoanStart by remember { mutableStateOf(false) }
    var loanStartDate by remember { mutableStateOf(Instant.now()) }
    var appreciationText by remember { mutableStateOf("") }
    var linkedAccountId by remember { mutableStateOf<String?>(null) }

    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(accountId, sessionVm.activeHousehold?.id) {
        val household = sessionVm.activeHousehold
        // One request covers both jobs: the account being edited and the property accounts a
        // loan could be secured against. There is no GET /accounts/{id} to use instead.
        val all = if (household == null) emptyList() else runCatching {
            Api.get<List<AccountResponse>>("/accounts/household/${household.id}")
        }.getOrDefault(emptyList())
        if (accountId != null) {
            all.firstOrNull { it.id == accountId }?.let { account ->
                existing = account
                name = account.name
                liquidity = account.liquidity
                taxStatus = TaxTreatment.entries.firstOrNull { it.wire == account.taxStatus } ?: TaxTreatment.TAXABLE
                kind = AccountKind.entries.firstOrNull { it.wire == account.kind } ?: AccountKind.ASSET
                currency = account.currency
                isPrivate = account.ownerUserId != null
                seededPrivacy = true
                principalText = account.originalPrincipal?.toString() ?: ""
                rateText = account.interestRateAnnual?.toString() ?: ""
                termMonthsText = account.loanTermMonths?.toString() ?: ""
                paymentText = account.monthlyPayment?.toString() ?: ""
                hasLoanStart = account.loanStartDate != null
                loanStartDate = account.loanStartDate ?: Instant.now()
                appreciationText = account.appreciationRateAnnual?.toString() ?: ""
                linkedAccountId = account.linkedAccountId
            }
        }
        if (currency.isBlank()) currency = household?.baseCurrency ?: "USD"
        if (!seededPrivacy) {
            // Seeded here, not at declaration: the user record isn't loaded when this
            // composable first runs. Matches iOS's onAppear seeding.
            isPrivate = sessionVm.user?.defaultsNewItemsPrivate ?: false
            seededPrivacy = true
        }
        propertyAccounts = all.filter { it.liquidity == LiquidityStatus.ILLIQUID && !it.isLiability }
    }

    fun loanNumber(text: String): Double? {
        if (kind != AccountKind.LIABILITY) return null
        return text.trim().toDoubleOrNull()?.takeIf { it > 0 }
    }

    fun loanInt(text: String): Int? {
        if (kind != AccountKind.LIABILITY) return null
        return text.trim().toIntOrNull()?.takeIf { it > 0 }
    }

    /** Property can fall in value, so a negative rate is legitimate here. */
    fun propertyNumber(text: String): Double? {
        if (kind != AccountKind.ASSET || liquidity != LiquidityStatus.ILLIQUID) return null
        return text.trim().toDoubleOrNull()
    }

    val canSave = name.isNotBlank() && currency.trim().length >= 3 && !saving

    fun save() {
        val household = sessionVm.activeHousehold ?: return
        if (!canSave) return
        saving = true
        error = null
        val owner = if (isPrivate) sessionVm.user?.id else null
        val cleanName = name.trim()
        val cleanCurrency = currency.trim().uppercase()
        val loanStart = if (kind == AccountKind.LIABILITY && hasLoanStart) loanStartDate.apiDateOnly() else null
        scope.launch {
            try {
                val current = existing
                if (current != null) {
                    Api.put<AccountUpdate, AccountResponse>(
                        "/accounts/${current.id}",
                        AccountUpdate(
                            name = cleanName,
                            liquidity = liquidity,
                            taxStatus = taxStatus,
                            kind = kind,
                            currency = cleanCurrency,
                            ownerUserId = owner,
                            originalPrincipal = loanNumber(principalText),
                            interestRateAnnual = loanNumber(rateText),
                            loanTermMonths = loanInt(termMonthsText),
                            monthlyPayment = loanNumber(paymentText),
                            loanStartDate = loanStart,
                            appreciationRateAnnual = propertyNumber(appreciationText),
                            linkedAccountId = linkedAccountId,
                        ),
                    )
                } else {
                    Api.post<AccountCreate, AccountResponse>(
                        "/accounts",
                        AccountCreate(
                            householdId = household.id,
                            name = cleanName,
                            liquidity = liquidity,
                            taxStatus = taxStatus,
                            kind = kind,
                            currency = cleanCurrency,
                            ownerUserId = owner,
                            originalPrincipal = loanNumber(principalText),
                            interestRateAnnual = loanNumber(rateText),
                            loanTermMonths = loanInt(termMonthsText),
                            monthlyPayment = loanNumber(paymentText),
                            loanStartDate = loanStart,
                            appreciationRateAnnual = propertyNumber(appreciationText),
                            linkedAccountId = linkedAccountId,
                        ),
                    )
                }
                onSaved()
            } catch (e: Exception) {
                error = e.message ?: "Couldn't save this account."
            } finally {
                saving = false
            }
        }
    }

    DetailScaffold(
        title = if (existing == null) "New account" else "Edit account",
        onBack = onBack,
        error = error,
        onErrorShown = { error = null },
        actions = {
            TextButton(onClick = ::save, enabled = canSave) { Text("Save") }
        },
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
                FormField("Name", name, { name = it })
                FormField(
                    "Currency",
                    currency,
                    { currency = it.uppercase() },
                    placeholder = "USD",
                    supportingText = "Three-letter ISO code",
                )
            }

            SectionCard(title = "Classification") {
                SegmentedChoice(
                    options = AccountKind.entries,
                    selected = kind,
                    optionLabel = { it.label },
                    onSelect = { kind = it },
                )
                DropdownField(
                    label = "Liquidity",
                    selected = liquidity,
                    options = LiquidityStatus.entries,
                    optionLabel = { it.label },
                    onSelect = { liquidity = it },
                )
                DropdownField(
                    label = "Tax status",
                    selected = taxStatus,
                    options = TaxTreatment.entries,
                    optionLabel = { it.label },
                    onSelect = { taxStatus = it },
                )
            }

            AnimatedVisibility(visible = kind == AccountKind.LIABILITY) {
                SectionCard(title = "Loan terms") {
                    MoneyField("Amount borrowed", principalText, { principalText = it }, currencyCode = currency)
                    FormField(
                        "Interest rate % / yr", rateText, { rateText = it },
                        keyboardType = KeyboardType.Decimal,
                    )
                    FormField(
                        "Term (months)", termMonthsText, { termMonthsText = it },
                        keyboardType = KeyboardType.Number,
                    )
                    MoneyField(
                        "Monthly payment (optional)", paymentText, { paymentText = it },
                        currencyCode = currency,
                    )
                    SwitchRow(
                        title = "Set first payment date",
                        checked = hasLoanStart,
                        onCheckedChange = { hasLoanStart = it },
                    )
                    if (hasLoanStart) {
                        DateField("First payment", loanStartDate) { loanStartDate = it }
                    }
                    if (propertyAccounts.isNotEmpty()) {
                        DropdownField(
                            label = "Secured against",
                            selected = propertyAccounts.firstOrNull { it.id == linkedAccountId },
                            options = propertyAccounts,
                            optionLabel = { it.name },
                            onSelect = { linkedAccountId = it.id },
                            placeholder = "Nothing — unsecured",
                        )
                    }
                    Text(
                        "Optional. With the amount, rate, term and first payment set, we amortize the " +
                            "balance down and show your payoff date. Leave the monthly payment blank to " +
                            "calculate it.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            AnimatedVisibility(
                visible = kind == AccountKind.ASSET && liquidity == LiquidityStatus.ILLIQUID,
            ) {
                SectionCard(title = "Property") {
                    FormField(
                        "Expected appreciation % / yr",
                        appreciationText,
                        { appreciationText = it },
                        keyboardType = KeyboardType.Decimal,
                    )
                    Text(
                        "Used only for the net worth projection — your recorded valuations are never " +
                            "overwritten. Leave blank to hold today's value flat.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            SectionCard {
                SwitchRow(
                    title = "Private to me",
                    subtitle = "Private accounts are visible only to you, not other household members.",
                    checked = isPrivate,
                    onCheckedChange = { isPrivate = it },
                )
            }

            Button(
                onClick = ::save,
                enabled = canSave,
                modifier = Modifier.padding(top = 4.dp),
            ) {
                Text(if (saving) "Saving…" else "Save account")
            }
        }
    }
}
