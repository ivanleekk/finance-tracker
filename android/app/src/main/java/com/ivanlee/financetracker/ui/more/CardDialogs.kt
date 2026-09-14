package com.ivanlee.financetracker.ui.more

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.ivanlee.financetracker.logic.CalculatorInput
import com.ivanlee.financetracker.logic.selectableAccounts
import com.ivanlee.financetracker.data.model.AccountResponse
import com.ivanlee.financetracker.data.model.CardCategoryCreate
import com.ivanlee.financetracker.data.model.CardCategoryDefaultUpdate
import com.ivanlee.financetracker.data.model.CardCategoryResponse
import com.ivanlee.financetracker.data.model.CardCreate
import com.ivanlee.financetracker.data.model.CardLimitCategoriesUpdate
import com.ivanlee.financetracker.data.model.CardLimitCreate
import com.ivanlee.financetracker.data.model.CardLimitResponse
import com.ivanlee.financetracker.data.model.CardResponse
import com.ivanlee.financetracker.data.model.CardUpdate
import com.ivanlee.financetracker.data.model.CycleBasis
import com.ivanlee.financetracker.data.model.LimitDirection
import com.ivanlee.financetracker.data.model.LimitResetBasis
import com.ivanlee.financetracker.data.model.cardUpdate
import com.ivanlee.financetracker.data.net.Api
import com.ivanlee.financetracker.data.net.apiDateOnly
import com.ivanlee.financetracker.logic.ANNIVERSARY_HINT
import com.ivanlee.financetracker.logic.Cards
import com.ivanlee.financetracker.logic.currencyWhole
import com.ivanlee.financetracker.logic.resetOptions
import com.ivanlee.financetracker.ui.components.DateField
import com.ivanlee.financetracker.ui.components.FormField
import com.ivanlee.financetracker.ui.components.MoneyField
import com.ivanlee.financetracker.ui.components.SegmentedChoice
import com.ivanlee.financetracker.ui.components.SwitchRow
import java.time.Instant
import kotlinx.coroutines.launch

/**
 * Setting a card up, and managing its limits and categories.
 *
 * Separate from `CardsScreen` because these are three forms with their own state,
 * and inlining them into the list is how a screen file grows past the point
 * anyone wants to open it.
 */

@Composable
fun CardSetUpDialog(
    accounts: List<AccountResponse>,
    onDismiss: () -> Unit,
    onSaved: () -> Unit,
) {
    var accountId by remember { mutableStateOf(accounts.firstOrNull()?.id) }
    var calendarBasis by remember { mutableStateOf(false) }
    var statementDay by remember { mutableStateOf("1") }
    var hasAnniversary by remember { mutableStateOf(false) }
    // Optional: blank means the card adds no default fee to foreign charges.
    var foreignFeeText by remember { mutableStateOf("") }
    var anniversary by remember { mutableStateOf(Instant.now()) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Set up a card") },
        text = {
            Column(
                modifier = Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(
                    "Pick the liability account this card already uses.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                selectableAccounts(accounts).forEach { account ->
                    TextButton(onClick = { accountId = account.id }) {
                        Text(
                            (if (account.id == accountId) "● " else "○ ") + account.name,
                        )
                    }
                }
                SegmentedChoice(
                    options = listOf("Statement cycle", "Calendar month"),
                    selected = if (calendarBasis) "Calendar month" else "Statement cycle",
                    optionLabel = { it },
                    onSelect = { calendarBasis = it == "Calendar month" },
                )
                if (!calendarBasis) {
                    FormField(
                        "Statement closes on day",
                        statementDay,
                        { statementDay = it.filter(Char::isDigit).take(2) },
                        supportingText = "Clamped in shorter months, so 31 still closes in February.",
                    )
                } else {
                    Text(
                        "Some issuers reset bonus caps on the calendar month whatever day the statement closes. It isn't derivable from the statement date, so it has to be stated.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                SwitchRow(
                    title = "Card anniversary",
                    subtitle = "Optional. Card-year and card-quarter limits count from it.",
                    checked = hasAnniversary,
                    onCheckedChange = { hasAnniversary = it },
                )
                if (hasAnniversary) {
                    DateField("Opened on", anniversary) { anniversary = it }
                }
                MoneyField(
                    "Foreign transaction fee (optional, %)",
                    foreignFeeText,
                    { foreignFeeText = it },
                    supportingText = "Filled in on every charge in another currency. You can still change it per purchase.",
                )
                error?.let {
                    Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = accountId != null,
                onClick = {
                    val account = accountId ?: return@TextButton
                    scope.launch {
                        try {
                            Api.post<CardCreate, CardResponse>(
                                "/cards",
                                CardCreate(
                                    financialAccountId = account,
                                    cycleBasis = if (calendarBasis) "calendar" else "statement",
                                    statementDay = statementDay.toIntOrNull()?.coerceIn(1, 31) ?: 1,
                                    anniversaryDate = if (hasAnniversary) anniversary.apiDateOnly() else null,
                                    foreignFeePercent = CalculatorInput.evaluateArithmeticExpression(foreignFeeText),
                                ),
                            )
                            onSaved()
                        } catch (e: Exception) {
                            error = e.message ?: "Couldn't set up that card."
                        }
                    }
                },
            ) { Text("Set up") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

/**
 * Editing a card after setup. Sends the whole card (see [CardUpdate]), so a cleared
 * anniversary goes out as JsonNull. The backend refuses to clear it while a limit
 * still counts from it, and that explanation is shown as-is.
 */
@Composable
fun CardEditDialog(
    card: CardResponse,
    onDismiss: () -> Unit,
    onSaved: (CardResponse) -> Unit,
) {
    var calendarBasis by remember(card.id) { mutableStateOf(card.cycleBasis == CycleBasis.CALENDAR) }
    var statementDay by remember(card.id) { mutableStateOf(card.statementDay.toString()) }
    var hasAnniversary by remember(card.id) { mutableStateOf(card.anniversaryDate != null) }
    var anniversary by remember(card.id) { mutableStateOf(card.anniversaryDate ?: Instant.now()) }
    // The card's foreign-transaction fee as editable text. Blank clears it.
    var foreignFeeText by remember(card.id) {
        mutableStateOf(card.foreignFeePercent?.let { if (it == Math.floor(it)) it.toInt().toString() else it.toString() }.orEmpty())
    }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Edit card") },
        text = {
            Column(
                modifier = Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                SegmentedChoice(
                    options = listOf("Statement cycle", "Calendar month"),
                    selected = if (calendarBasis) "Calendar month" else "Statement cycle",
                    optionLabel = { it },
                    onSelect = { calendarBasis = it == "Calendar month" },
                )
                if (!calendarBasis) {
                    FormField(
                        "Statement closes on day",
                        statementDay,
                        { statementDay = it.filter(Char::isDigit).take(2) },
                    )
                }
                SwitchRow(
                    title = "Card anniversary",
                    subtitle = "Card-year and card-quarter limits count from it.",
                    checked = hasAnniversary,
                    onCheckedChange = { hasAnniversary = it },
                )
                if (hasAnniversary) {
                    DateField("Opened on", anniversary) { anniversary = it }
                }
                MoneyField(
                    "Foreign transaction fee (optional, %)",
                    foreignFeeText,
                    { foreignFeeText = it },
                    supportingText = "Filled in on every charge in another currency. You can still change it per purchase.",
                )
                error?.let {
                    Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                scope.launch {
                    try {
                        val updated = Api.put<CardUpdate, CardResponse>(
                            "/cards/${card.id}",
                            cardUpdate(
                                cycleBasis = if (calendarBasis) "calendar" else "statement",
                                statementDay = statementDay.toIntOrNull()?.coerceIn(1, 31) ?: card.statementDay,
                                anniversaryDate = if (hasAnniversary) anniversary.apiDateOnly() else null,
                                foreignFeePercent = CalculatorInput.evaluateArithmeticExpression(foreignFeeText),
                            ),
                        )
                        onSaved(updated)
                    } catch (e: Exception) {
                        error = e.message ?: "Couldn't update the card."
                    }
                }
            }) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
fun CardManageDialog(
    card: CardResponse,
    onDismiss: () -> Unit,
    onChanged: () -> Unit,
) {
    var currentCard by remember(card.id) { mutableStateOf(card) }
    var limits by remember(card.id) { mutableStateOf(card.limits) }
    var categories by remember(card.id) { mutableStateOf(card.categories) }
    var error by remember { mutableStateOf<String?>(null) }

    var limitName by remember(card.id) { mutableStateOf("") }
    var limitAmount by remember(card.id) { mutableStateOf("") }
    var isFloor by remember(card.id) { mutableStateOf(false) }
    var resetBasis by remember(card.id) { mutableStateOf(LimitResetBasis.CYCLE) }
    var anniversary by remember(card.id) { mutableStateOf(card.anniversaryDate) }
    var editing by remember { mutableStateOf(false) }
    var limitCategoryIds by remember(card.id) { mutableStateOf(emptySet<String>()) }
    var editingLimitId by remember(card.id) { mutableStateOf<String?>(null) }
    var categoryName by remember(card.id) { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val currency = card.currency ?: "USD"

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(card.accountName) },
        text = {
            Column(
                modifier = Modifier.heightIn(max = 460.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                TextButton(onClick = { editing = true }) { Text("Edit card — cycle and anniversary") }
                Text("Limits", style = MaterialTheme.typography.titleSmall)
                if (limits.isEmpty()) {
                    Text(
                        "None yet.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                limits.forEach { limit ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                "${limit.name} · ${if (limit.direction == LimitDirection.FLOOR) "min" else "cap"} ${limit.amount.currencyWhole(currency)}",
                                style = MaterialTheme.typography.bodySmall,
                            )
                            Text(
                                categories.filter { it.id in limit.categoryIds }.joinToString(" · ") { it.name }
                                    .ifEmpty { "No categories — measuring nothing" },
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        TextButton(onClick = {
                            editingLimitId = if (editingLimitId == limit.id) null else limit.id
                        }) { Text(if (editingLimitId == limit.id) "Close" else "Categories") }
                        TextButton(onClick = {
                            scope.launch {
                                try {
                                    Api.delete("/cards/limits/${limit.id}")
                                    // Its categories survive; any counting towards nothing
                                    // else read as unmetered, derived from `limits`.
                                    limits = limits.filterNot { it.id == limit.id }
                                    onChanged()
                                } catch (e: Exception) {
                                    error = e.message ?: "Couldn't remove that limit."
                                }
                            }
                        }) { Text("Remove") }
                    }
                    if (editingLimitId == limit.id) {
                        CategoryChecklist(
                            categories = categories,
                            selected = limit.categoryIds.toSet(),
                            onToggle = { id ->
                                val next = limit.categoryIds.toSet().let { if (id in it) it - id else it + id }
                                scope.launch {
                                    try {
                                        val updated = Api.put<CardLimitCategoriesUpdate, CardLimitResponse>(
                                            "/cards/limits/${limit.id}",
                                            CardLimitCategoriesUpdate(categories.map { it.id }.filter { it in next }),
                                        )
                                        limits = limits.map { if (it.id == updated.id) updated else it }
                                        error = null
                                        onChanged()
                                    } catch (e: Exception) {
                                        error = e.message ?: "Couldn't update that limit's categories."
                                    }
                                }
                            },
                        )
                    }
                }

                FormField("Limit name", limitName, { limitName = it }, placeholder = "e.g. Dining cap")
                MoneyField("Amount", limitAmount, { limitAmount = it }, currencyCode = currency)
                SegmentedChoice(
                    options = listOf("Cap — stay under", "Minimum — reach it"),
                    selected = if (isFloor) "Minimum — reach it" else "Cap — stay under",
                    optionLabel = { it },
                    onSelect = { isFloor = it.startsWith("Minimum") },
                )
                Text("Resets", style = MaterialTheme.typography.labelMedium)
                resetOptions(hasAnniversary = anniversary != null).filter { it.isAvailable }.forEach { option ->
                    TextButton(onClick = { resetBasis = option.basis }) {
                        Text((if (resetBasis == option.basis) "● " else "○ ") + option.label)
                    }
                }
                Text("Counts spending in", style = MaterialTheme.typography.labelMedium)
                CategoryChecklist(
                    categories = categories,
                    selected = limitCategoryIds,
                    onToggle = { id -> limitCategoryIds = if (id in limitCategoryIds) limitCategoryIds - id else limitCategoryIds + id },
                )
                if (anniversary == null) {
                    Text(
                        ANNIVERSARY_HINT,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Text(
                    if (isFloor) {
                        "The spend you need to reach — a fee waiver or a bonus qualifier."
                    } else {
                        "Enter caps as a spend figure. A cap the issuer states in rewards (\"max \$60 cashback\") has to be converted — at 10%, that is \$600 of spend."
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                TextButton(
                    enabled = limitName.isNotBlank() && CalculatorInput.evaluateArithmeticExpression(limitAmount) != null,
                    onClick = {
                        scope.launch {
                            try {
                                val created = Api.post<CardLimitCreate, CardLimitResponse>(
                                    "/cards/${card.id}/limits",
                                    CardLimitCreate(
                                        name = limitName,
                                        amount = CalculatorInput.evaluateArithmeticExpression(limitAmount) ?: return@launch,
                                        direction = if (isFloor) "floor" else "ceiling",
                                        resetBasis = resetBasis.wire,
                                        categoryIds = categories.map { it.id }.filter { it in limitCategoryIds },
                                    ),
                                )
                                limits = limits + created
                                limitName = ""
                                limitAmount = ""
                                isFloor = false
                                resetBasis = LimitResetBasis.CYCLE
                                limitCategoryIds = emptySet()
                                error = null
                                onChanged()
                            } catch (e: Exception) {
                                error = e.message ?: "Couldn't add that limit."
                            }
                        }
                    },
                ) { Text("Add limit") }

                Text("Categories", style = MaterialTheme.typography.titleSmall)
                Text(
                    "This card's own slicing of spend — free to cut across your budget categories. Untagged spending lands in the default. Which limits a category counts towards is chosen on the limit.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                categories.forEach { category ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(categoryLabel(category, limits), style = MaterialTheme.typography.bodySmall)
                        Row {
                            if (!category.isDefault) {
                                TextButton(onClick = {
                                    scope.launch {
                                        try {
                                            val updated = Api.put<CardCategoryDefaultUpdate, CardCategoryResponse>(
                                                "/cards/categories/${category.id}",
                                                CardCategoryDefaultUpdate(),
                                            )
                                            categories = categories.map {
                                                if (it.id == updated.id) updated else it.copy(isDefault = false)
                                            }
                                            error = null
                                            onChanged()
                                        } catch (e: Exception) {
                                            error = e.message ?: "Couldn't set that category as default."
                                        }
                                    }
                                }) { Text("Make default") }
                            }
                            TextButton(onClick = {
                                scope.launch {
                                    try {
                                        Api.delete("/cards/categories/${category.id}")
                                        categories = categories.filterNot { it.id == category.id }
                                        onChanged()
                                    } catch (e: Exception) {
                                        // A category still tagged on transactions comes
                                        // back as a 409 with an explanation.
                                        error = e.message ?: "Couldn't remove that category."
                                    }
                                }
                            }) { Text("Remove") }
                        }
                    }
                }

                FormField("Category name", categoryName, { categoryName = it }, placeholder = "e.g. Online")
                TextButton(
                    enabled = categoryName.isNotBlank(),
                    onClick = {
                        scope.launch {
                            try {
                                val created = Api.post<CardCategoryCreate, CardCategoryResponse>(
                                    "/cards/${card.id}/categories",
                                    CardCategoryCreate(name = categoryName),
                                )
                                categories = categories + created
                                categoryName = ""
                                error = null
                                onChanged()
                            } catch (e: Exception) {
                                error = e.message ?: "Couldn't add that category."
                            }
                        }
                    },
                ) { Text("Add category") }

                error?.let {
                    Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Done") } },
    )

    if (editing) {
        CardEditDialog(
            card = currentCard,
            onDismiss = { editing = false },
            onSaved = { updated ->
                // Hold the PUT's response rather than just its anniversary date — the same
                // dialog also edits cycleBasis/statementDay, and reopening Edit card must not
                // re-seed those from the stale snapshot this composable was first created with.
                currentCard = updated
                anniversary = updated.anniversaryDate
                // A cleared anniversary can strip the picker's available options out from
                // under a selection made while it still had one — clamp back to CYCLE rather
                // than silently send a card-year/card-quarter reset the backend will 400 on.
                if (resetOptions(hasAnniversary = anniversary != null).none { it.isAvailable && it.basis == resetBasis }) {
                    resetBasis = LimitResetBasis.CYCLE
                }
                editing = false
                onChanged()
            },
        )
    }
}

/**
 * A checklist of a card's categories, for choosing what counts towards a limit.
 * A category already counting towards another limit is offered all the same —
 * stacking a monthly minimum and an annual cap on the same spend is the point.
 */
@Composable
private fun CategoryChecklist(
    categories: List<CardCategoryResponse>,
    selected: Set<String>,
    onToggle: (String) -> Unit,
) {
    Column {
        categories.forEach { category ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .clickable { onToggle(category.id) }
                    .padding(vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Checkbox(checked = category.id in selected, onCheckedChange = null)
                Text(category.name, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

private fun categoryLabel(category: CardCategoryResponse, limits: List<CardLimitResponse>): String {
    val notes = buildList {
        if (category.isDefault) add("default")
        if (!Cards.isMetered(category.id, limits)) add("unmetered")
    }
    return if (notes.isEmpty()) category.name else "${category.name} · ${notes.joinToString(" · ")}"
}
