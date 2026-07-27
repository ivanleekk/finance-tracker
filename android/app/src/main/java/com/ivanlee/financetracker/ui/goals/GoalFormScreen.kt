package com.ivanlee.financetracker.ui.goals

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
import androidx.compose.ui.unit.dp
import com.ivanlee.financetracker.data.model.SubPortfolioCreate
import com.ivanlee.financetracker.data.model.SubPortfolioResponse
import com.ivanlee.financetracker.data.model.SubPortfolioUpdate
import com.ivanlee.financetracker.data.net.Api
import com.ivanlee.financetracker.data.net.apiDateOnly
import com.ivanlee.financetracker.state.SessionViewModel
import com.ivanlee.financetracker.ui.components.DateField
import com.ivanlee.financetracker.ui.components.DetailScaffold
import com.ivanlee.financetracker.ui.components.DropdownField
import com.ivanlee.financetracker.ui.components.FormField
import com.ivanlee.financetracker.ui.components.MoneyField
import com.ivanlee.financetracker.ui.components.SectionCard
import com.ivanlee.financetracker.ui.components.SwitchRow
import kotlinx.coroutines.launch
import java.time.Instant

private val RISK_PROFILES = listOf("conservative", "balanced", "growth", "aggressive")

/**
 * Create or edit a goal — which is to say, a sub-portfolio and its optional target.
 *
 * The privacy toggle is the interesting part on edit. The backend PATCH uses `exclude_unset`,
 * so *omitting* `owner_user_id` leaves ownership alone while an explicit null clears it. Only
 * a deliberate change to the toggle sends the field, which is what lets "Private → Shared"
 * actually work here (the web UI can't express it).
 */
@Composable
fun GoalFormScreen(
    subPortfolioId: String?,
    sessionVm: SessionViewModel,
    onBack: () -> Unit,
    onSaved: () -> Unit,
) {
    var existing by remember { mutableStateOf<SubPortfolioResponse?>(null) }
    var name by remember { mutableStateOf("") }
    var riskProfile by remember { mutableStateOf("balanced") }
    var hasTarget by remember { mutableStateOf(false) }
    var targetAmountText by remember { mutableStateOf("") }
    var hasTargetDate by remember { mutableStateOf(false) }
    var targetDate by remember { mutableStateOf(Instant.now()) }
    var isPrivate by remember { mutableStateOf(false) }
    var privacyTouched by remember { mutableStateOf(false) }
    var seeded by remember { mutableStateOf(false) }

    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(subPortfolioId, sessionVm.activeHousehold?.id, sessionVm.user?.id) {
        val h = sessionVm.activeHousehold ?: return@LaunchedEffect
        if (subPortfolioId != null && existing == null) {
            runCatching {
                Api.get<List<SubPortfolioResponse>>("/portfolio/subportfolios/household/${h.id}")
                    .firstOrNull { it.id == subPortfolioId }
            }.getOrNull()?.let { sub ->
                existing = sub
                name = sub.name
                riskProfile = sub.riskProfile ?: "balanced"
                hasTarget = sub.targetAmount != null
                targetAmountText = sub.targetAmount?.toString().orEmpty()
                hasTargetDate = sub.targetDate != null
                targetDate = sub.targetDate ?: Instant.now()
                isPrivate = sub.ownerUserId != null
                seeded = true
            }
        }
        if (!seeded && subPortfolioId == null) {
            // Seeded on appear, not at declaration: the user record isn't loaded yet when this
            // composable first runs. Matches iOS's onAppear seeding.
            isPrivate = sessionVm.user?.defaultsNewItemsPrivate ?: false
            seeded = true
        }
    }

    val targetAmount = targetAmountText.replace(",", "").toDoubleOrNull()
    val canSave = name.isNotBlank() && !saving

    fun save() {
        val h = sessionVm.activeHousehold ?: return
        if (!canSave) return
        saving = true
        error = null
        val owner = if (isPrivate) sessionVm.user?.id else null
        val targetDateString = if (hasTargetDate) targetDate.apiDateOnly() else null
        val amount = if (hasTarget) targetAmount else null
        scope.launch {
            try {
                val current = existing
                if (current != null) {
                    Api.patch<SubPortfolioUpdate, SubPortfolioResponse>(
                        "/portfolio/subportfolios/${current.id}",
                        SubPortfolioUpdate(
                            name = name.trim(),
                            targetAmount = amount,
                            targetDate = targetDateString,
                            // Untouched → omit the key entirely → ownership unchanged.
                            ownerUserId = if (privacyTouched) {
                                SubPortfolioUpdate.ownerSetTo(owner)
                            } else {
                                SubPortfolioUpdate.ownerUnchanged
                            },
                        ),
                    )
                } else {
                    Api.post<SubPortfolioCreate, SubPortfolioResponse>(
                        "/portfolio/subportfolios",
                        SubPortfolioCreate(
                            householdId = h.id,
                            name = name.trim(),
                            riskProfile = riskProfile,
                            targetAmount = amount,
                            targetDate = targetDateString,
                            ownerUserId = owner,
                        ),
                    )
                }
                onSaved()
            } catch (e: Exception) {
                error = e.message ?: "Couldn't save this goal."
            } finally {
                saving = false
            }
        }
    }

    DetailScaffold(
        title = if (existing == null) "New goal" else "Edit goal",
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
                FormField("Name", name, { name = it }, placeholder = "House deposit")
                DropdownField(
                    label = "Risk profile",
                    selected = riskProfile,
                    options = RISK_PROFILES,
                    optionLabel = { it.replaceFirstChar(Char::titlecase) },
                    onSelect = { riskProfile = it },
                    enabled = existing == null,
                )
                if (existing != null) {
                    Text(
                        "Risk profile is set when the sub-portfolio is created.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            SectionCard(title = "Target") {
                SwitchRow(
                    title = "Set a target amount",
                    checked = hasTarget,
                    onCheckedChange = { hasTarget = it },
                )
                AnimatedVisibility(visible = hasTarget) {
                    MoneyField(
                        "Target amount",
                        targetAmountText,
                        { targetAmountText = it },
                        currencyCode = sessionVm.activeHousehold?.baseCurrency,
                    )
                }
                SwitchRow(
                    title = "Set a target date",
                    checked = hasTargetDate,
                    onCheckedChange = { hasTargetDate = it },
                )
                AnimatedVisibility(visible = hasTargetDate) {
                    DateField("Target date", targetDate) { targetDate = it }
                }
                Text(
                    "A sub-portfolio with a target becomes a goal: it gets progress, pace and a " +
                        "projected completion date.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            SectionCard {
                SwitchRow(
                    title = "Private to me",
                    subtitle = "Private goals are visible only to you, not other household members.",
                    checked = isPrivate,
                    onCheckedChange = {
                        isPrivate = it
                        privacyTouched = true
                    },
                )
            }

            Button(onClick = ::save, enabled = canSave) {
                Text(if (saving) "Saving…" else "Save goal")
            }
        }
    }
}
