package com.ivanlee.financetracker.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import com.ivanlee.financetracker.logic.CalculatorInput
import com.ivanlee.financetracker.logic.mediumDate
import java.time.Instant

/** A labelled outlined text field — the default M3 text input, sized for a form column. */
@Composable
fun FormField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    keyboardType: KeyboardType = KeyboardType.Text,
    singleLine: Boolean = true,
    supportingText: String? = null,
    isError: Boolean = false,
    trailingIcon: @Composable (() -> Unit)? = null,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        placeholder = placeholder?.let { { Text(it) } },
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
        singleLine = singleLine,
        isError = isError,
        supportingText = supportingText?.let { { Text(it) } },
        trailingIcon = trailingIcon,
        modifier = modifier.fillMaxWidth(),
    )
}

/**
 * A numeric field with a +/-/x/div row that appears under it while focused, so the user can
 * type a quick expression ("42.50/3") instead of doing the math elsewhere. On losing focus the
 * text normalizes to the evaluated result (`CalculatorInput`) — which is also why every
 * existing `text.replace(",", "").toDoubleOrNull()` parse at a call site's save path should go
 * through `CalculatorInput.evaluateArithmeticExpression` instead: it's a strict superset of the
 * old parse and catches the rare case where the field is submitted while still focused.
 *
 * [KeyboardType.Decimal] rather than Number: a numeric keypad without a decimal separator
 * makes it impossible to type $12.50, which is most of the amounts anyone enters.
 */
@Composable
fun CalculatorField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String? = "0.00",
    keyboardType: KeyboardType = KeyboardType.Decimal,
    allowsDecimal: Boolean = true,
    isError: Boolean = false,
    supportingText: String? = null,
    trailingIcon: @Composable (() -> Unit)? = null,
) {
    var isFocused by remember { mutableStateOf(false) }

    // A plain-String OutlinedTextField keeps the cursor at its old numeric offset when `value`
    // changes programmatically (an operator-button tap, or the on-blur normalization below)
    // rather than moving it to the end — so "12.50" + tap "+" + type "3" produced "12.503+"
    // instead of "12.50+3". Managing our own TextFieldValue lets us pin the cursor to the end
    // on every synthetic change while still tracking the IME's own cursor placement during
    // normal typing. Resyncing only when `value` disagrees with our own last-known text (rather
    // than on every recomposition) is what avoids fighting the user mid-string: our own edits
    // always update `fieldValue` before calling `onValueChange`, so by the next recomposition
    // `value` already matches — a mismatch here means the caller changed it for some other
    // reason (e.g. seeding an edit form from loaded data) and deserves a fresh cursor position.
    var fieldValue by remember { mutableStateOf(TextFieldValue(value, TextRange(value.length))) }
    if (value != fieldValue.text) {
        fieldValue = TextFieldValue(value, TextRange(value.length))
    }

    fun setText(newText: String) {
        fieldValue = TextFieldValue(newText, TextRange(newText.length))
        onValueChange(newText)
    }

    Column(modifier) {
        OutlinedTextField(
            value = fieldValue,
            onValueChange = { new ->
                fieldValue = new
                onValueChange(new.text)
            },
            label = { Text(label) },
            placeholder = placeholder?.let { { Text(it) } },
            keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
            singleLine = true,
            isError = isError,
            supportingText = supportingText?.let { { Text(it) } },
            trailingIcon = trailingIcon,
            modifier = Modifier
                .fillMaxWidth()
                .onFocusChanged { state ->
                    if (isFocused && !state.isFocused) {
                        setText(CalculatorInput.normalizedDisplayText(fieldValue.text, allowsDecimal))
                    }
                    isFocused = state.isFocused
                },
        )
        if (isFocused) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(top = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                listOf(
                    CalculatorInput.Operator.ADD to "+",
                    CalculatorInput.Operator.SUBTRACT to "−",
                    CalculatorInput.Operator.MULTIPLY to "×",
                    CalculatorInput.Operator.DIVIDE to "÷",
                ).forEach { (op, symbol) ->
                    OutlinedButton(onClick = { setText(CalculatorInput.inserting(op, fieldValue.text)) }) {
                        Text(symbol)
                    }
                }
            }
        }
    }
}

/**
 * Money entry — a [CalculatorField] with a currency-code trailing label and digit/operator
 * filtering on typed input.
 */
@Composable
fun MoneyField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    currencyCode: String? = null,
    isError: Boolean = false,
    supportingText: String? = null,
) {
    CalculatorField(
        label = label,
        value = value,
        onValueChange = { text ->
            onValueChange(text.filter { it.isDigit() || it in ".,-+×÷*/" })
        },
        modifier = modifier,
        isError = isError,
        supportingText = supportingText,
        trailingIcon = currencyCode?.let {
            { Text(it, style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(end = 12.dp)) }
        },
    )
}

/**
 * A tappable date field backed by the M3 date picker dialog.
 *
 * The picker works in UTC, matching how every date the backend sends is interpreted — a
 * picker in local time would let a user in UTC-5 pick "the 3rd" and post the 2nd.
 */
@Composable
fun DateField(
    label: String,
    value: Instant,
    modifier: Modifier = Modifier,
    // Last so `DateField("Date", date) { date = it }` binds the trailing lambda here rather
    // than to `modifier` — the call shape every form on every screen uses.
    onValueChange: (Instant) -> Unit,
) {
    var showPicker by remember { mutableStateOf(false) }
    OutlinedTextField(
        value = value.mediumDate(),
        onValueChange = {},
        readOnly = true,
        label = { Text(label) },
        trailingIcon = {
            IconButton(onClick = { showPicker = true }) {
                Icon(Icons.Filled.DateRange, contentDescription = "Pick a date")
            }
        },
        modifier = modifier
            .fillMaxWidth()
            .clickable { showPicker = true },
    )
    if (showPicker) {
        val state = rememberDatePickerState(initialSelectedDateMillis = value.toEpochMilli())
        DatePickerDialog(
            onDismissRequest = { showPicker = false },
            confirmButton = {
                TextButton(onClick = {
                    state.selectedDateMillis?.let { onValueChange(Instant.ofEpochMilli(it)) }
                    showPicker = false
                }) { Text("OK") }
            },
            dismissButton = {
                TextButton(onClick = { showPicker = false }) { Text("Cancel") }
            },
        ) {
            DatePicker(state = state)
        }
    }
}

/** A read-only text field that opens a menu of options — M3's exposed dropdown. */
@Composable
fun <T> DropdownField(
    label: String,
    selected: T?,
    options: List<T>,
    optionLabel: (T) -> String,
    onSelect: (T) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "Select…",
    enabled: Boolean = true,
) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(
        expanded = expanded && enabled,
        onExpandedChange = { if (enabled) expanded = it },
        modifier = modifier.fillMaxWidth(),
    ) {
        OutlinedTextField(
            value = selected?.let(optionLabel) ?: placeholder,
            onValueChange = {},
            readOnly = true,
            enabled = enabled,
            label = { Text(label) },
            trailingIcon = { Icon(Icons.Filled.ArrowDropDown, contentDescription = null) },
            colors = ExposedDropdownMenuDefaults.outlinedTextFieldColors(),
            modifier = Modifier
                .menuAnchor(androidx.compose.material3.MenuAnchorType.PrimaryNotEditable)
                .fillMaxWidth(),
        )
        ExposedDropdownMenu(
            expanded = expanded && enabled,
            onDismissRequest = { expanded = false },
        ) {
            options.forEach { option ->
                DropdownMenuItem(
                    text = { Text(optionLabel(option)) },
                    onClick = {
                        onSelect(option)
                        expanded = false
                    },
                )
            }
        }
    }
}

/** A small set of mutually exclusive choices — M3 single-choice segmented buttons. */
@Composable
fun <T> SegmentedChoice(
    options: List<T>,
    selected: T,
    optionLabel: (T) -> String,
    onSelect: (T) -> Unit,
    modifier: Modifier = Modifier,
) {
    SingleChoiceSegmentedButtonRow(modifier.fillMaxWidth()) {
        options.forEachIndexed { index, option ->
            SegmentedButton(
                selected = option == selected,
                onClick = { onSelect(option) },
                shape = SegmentedButtonDefaults.itemShape(index, options.size),
            ) {
                Text(optionLabel(option), maxLines = 1)
            }
        }
    }
}

/** A settings-style row with a trailing switch; the whole row is the tap target. */
@Composable
fun SwitchRow(
    title: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    enabled: Boolean = true,
) {
    ListItem(
        colors = cardListItemColors(),
        headlineContent = { Text(title) },
        supportingContent = subtitle?.let { { Text(it) } },
        trailingContent = {
            Switch(checked = checked, onCheckedChange = onCheckedChange, enabled = enabled)
        },
        modifier = modifier
            .fillMaxWidth()
            .clickable(enabled = enabled) { onCheckedChange(!checked) },
    )
}

/** Label on the left, value on the right — the workhorse of every detail screen. */
@Composable
fun KeyValueRow(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    valueColor: androidx.compose.ui.graphics.Color = MaterialTheme.colorScheme.onSurface,
) {
    Row(
        modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(value, style = MaterialTheme.typography.bodyMedium, color = valueColor)
    }
}

/**
 * Destructive-action confirmation. Deleting is always behind one of these — an accidental
 * swipe should never be able to destroy a year of transaction history.
 */
@Composable
fun ConfirmDialog(
    title: String,
    message: String,
    confirmLabel: String = "Delete",
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(message) },
        confirmButton = {
            TextButton(onClick = {
                onConfirm()
                onDismiss()
            }) {
                Text(confirmLabel, color = MaterialTheme.colorScheme.error)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

/**
 * A searchable single-select list, for the long reference lists (currencies, timezones,
 * countries) where a dropdown of 400 entries is unusable.
 */
@Composable
fun <T> SearchablePickerDialog(
    title: String,
    options: List<T>,
    optionLabel: (T) -> String,
    optionKey: (T) -> String,
    onSelect: (T) -> Unit,
    onDismiss: () -> Unit,
    searchText: (T) -> String = optionLabel,
) {
    var query by remember { mutableStateOf("") }
    val filtered = remember(query, options) {
        if (query.isBlank()) options
        else options.filter { searchText(it).contains(query, ignoreCase = true) }
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column {
                FormField(label = "Search", value = query, onValueChange = { query = it })
                HorizontalDivider(Modifier.padding(vertical = 8.dp))
                Box(Modifier.fillMaxWidth()) {
                    LazyColumn {
                        items(filtered, key = optionKey) { option ->
                            ListItem(
                                colors = cardListItemColors(),
                                headlineContent = { Text(optionLabel(option)) },
                                modifier = Modifier.clickable {
                                    onSelect(option)
                                    onDismiss()
                                },
                            )
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
