package com.ivanlee.financetracker.ui.more

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.ivanlee.financetracker.logic.CalculatorInput
import com.ivanlee.financetracker.logic.selectableAccounts
import com.ivanlee.financetracker.data.model.AccountResponse
import com.ivanlee.financetracker.data.model.CardCategoryCreate
import com.ivanlee.financetracker.data.model.CardCategoryDefaultUpdate
import com.ivanlee.financetracker.data.model.CardCategoryResponse
import com.ivanlee.financetracker.data.model.CardCreate
import com.ivanlee.financetracker.data.model.CardLimitCreate
import com.ivanlee.financetracker.data.model.CardLimitResponse
import com.ivanlee.financetracker.data.model.CardResponse
import com.ivanlee.financetracker.data.model.LimitDirection
import com.ivanlee.financetracker.data.model.LimitResetBasis
import com.ivanlee.financetracker.data.net.Api
import com.ivanlee.financetracker.logic.currencyWhole
import com.ivanlee.financetracker.ui.components.FormField
import com.ivanlee.financetracker.ui.components.MoneyField
import com.ivanlee.financetracker.ui.components.SegmentedChoice
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

@Composable
fun CardManageDialog(
    card: CardResponse,
    onDismiss: () -> Unit,
    onChanged: () -> Unit,
) {
    var limits by remember(card.id) { mutableStateOf(card.limits) }
    var categories by remember(card.id) { mutableStateOf(card.categories) }
    var error by remember { mutableStateOf<String?>(null) }

    var limitName by remember(card.id) { mutableStateOf("") }
    var limitAmount by remember(card.id) { mutableStateOf("") }
    var isFloor by remember(card.id) { mutableStateOf(false) }
    var categoryName by remember(card.id) { mutableStateOf("") }
    var categoryLimitId by remember(card.id) { mutableStateOf<String?>(null) }
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
                    ) {
                        Text(
                            "${limit.name} · ${if (limit.direction == LimitDirection.FLOOR) "min" else "cap"} ${limit.amount.currencyWhole(currency)}",
                            style = MaterialTheme.typography.bodySmall,
                        )
                        TextButton(onClick = {
                            scope.launch {
                                try {
                                    Api.delete("/cards/limits/${limit.id}")
                                    limits = limits.filterNot { it.id == limit.id }
                                    // Its categories survive and become unmetered.
                                    categories = categories.map {
                                        if (it.limitId == limit.id) it.copy(limitId = null) else it
                                    }
                                    onChanged()
                                } catch (e: Exception) {
                                    error = e.message ?: "Couldn't remove that limit."
                                }
                            }
                        }) { Text("Remove") }
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
                                        resetBasis = "cycle",
                                    ),
                                )
                                limits = limits + created
                                limitName = ""
                                limitAmount = ""
                                isFloor = false
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
                    "This card's own slicing of spend — free to cut across your budget categories. Untagged spending lands in the default.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                categories.forEach { category ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(categoryLabel(category), style = MaterialTheme.typography.bodySmall)
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
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    TextButton(onClick = { categoryLimitId = null }) {
                        Text(if (categoryLimitId == null) "● No limit" else "○ No limit")
                    }
                    limits.forEach { limit ->
                        TextButton(onClick = { categoryLimitId = limit.id }) {
                            Text((if (categoryLimitId == limit.id) "● " else "○ ") + limit.name)
                        }
                    }
                }
                TextButton(
                    enabled = categoryName.isNotBlank(),
                    onClick = {
                        scope.launch {
                            try {
                                val created = Api.post<CardCategoryCreate, CardCategoryResponse>(
                                    "/cards/${card.id}/categories",
                                    CardCategoryCreate(name = categoryName, limitId = categoryLimitId),
                                )
                                categories = categories + created
                                categoryName = ""
                                categoryLimitId = null
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
}

private fun categoryLabel(category: CardCategoryResponse): String {
    val notes = buildList {
        if (category.isDefault) add("default")
        if (category.limitId == null) add("unmetered")
    }
    return if (notes.isEmpty()) category.name else "${category.name} · ${notes.joinToString(" · ")}"
}
