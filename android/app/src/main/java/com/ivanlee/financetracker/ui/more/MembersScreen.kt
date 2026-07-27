package com.ivanlee.financetracker.ui.more

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Group
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
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
import com.ivanlee.financetracker.data.model.HouseholdInviteCreate
import com.ivanlee.financetracker.data.model.HouseholdInviteResponse
import com.ivanlee.financetracker.data.model.HouseholdMemberUserResponse
import com.ivanlee.financetracker.data.model.HouseholdRole
import com.ivanlee.financetracker.data.net.Api
import com.ivanlee.financetracker.logic.mediumDate
import com.ivanlee.financetracker.state.SessionViewModel
import com.ivanlee.financetracker.state.ViewModeViewModel
import com.ivanlee.financetracker.ui.components.ConfirmDialog
import com.ivanlee.financetracker.ui.components.DetailScaffold
import com.ivanlee.financetracker.ui.components.DropdownField
import com.ivanlee.financetracker.ui.components.EmptyState
import com.ivanlee.financetracker.ui.components.FormField
import com.ivanlee.financetracker.ui.components.SectionCard
import com.ivanlee.financetracker.ui.components.SwipeActionRow
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import com.ivanlee.financetracker.ui.components.cardListItemColors

/**
 * Household members and pending invites.
 *
 * Also the place the Private/Household/Blended switch appears from: adding a second person is
 * exactly the signal [ViewModeViewModel.hasSecondPerson] watches for, so this screen updates
 * it directly from the counts it just fetched instead of making the switch wait for a reload.
 */
@Composable
fun MembersScreen(
    sessionVm: SessionViewModel,
    viewModeVm: ViewModeViewModel,
    onBack: () -> Unit,
) {
    var members by remember { mutableStateOf<List<HouseholdMemberUserResponse>>(emptyList()) }
    var invites by remember { mutableStateOf<List<HouseholdInviteResponse>>(emptyList()) }
    var inviting by remember { mutableStateOf(false) }
    var pendingRemoveMember by remember { mutableStateOf<HouseholdMemberUserResponse?>(null) }
    var pendingCancelInvite by remember { mutableStateOf<HouseholdInviteResponse?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var reloadKey by remember { mutableStateOf(0) }
    val scope = rememberCoroutineScope()

    val household = sessionVm.activeHousehold

    LaunchedEffect(household?.id, reloadKey) {
        val h = household ?: return@LaunchedEffect
        try {
            coroutineScope {
                val m = async {
                    Api.get<List<HouseholdMemberUserResponse>>("/users/householdmember/${h.id}")
                }
                val i = async {
                    Api.get<List<HouseholdInviteResponse>>("/users/households/${h.id}/invites")
                }
                members = m.await()
                invites = i.await()
            }
            viewModeVm.setComposition(members.size, invites.size)
        } catch (e: Exception) {
            error = e.message ?: "Couldn't load members."
        }
    }

    DetailScaffold(
        title = "Members & invites",
        subtitle = household?.name,
        onBack = onBack,
        error = error,
        onErrorShown = { error = null },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = { inviting = true },
                icon = { Icon(Icons.Filled.Group, contentDescription = null) },
                text = { Text("Invite") },
            )
        },
    ) { padding ->
        LazyColumn(
            Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                SectionCard(title = "Members") {
                    if (members.isEmpty()) {
                        EmptyState(
                            icon = Icons.Filled.Group,
                            title = "Just you so far",
                            message = "Invite someone to start tracking shared money.",
                        )
                    }
                    members.forEachIndexed { index, member ->
                        if (index > 0) HorizontalDivider()
                        val isSelf = member.userId == sessionVm.user?.id
                        SwipeActionRow(
                            onEndAction = if (isSelf || member.role == HouseholdRole.OWNER) null
                            else ({ pendingRemoveMember = member }),
                        ) {
                            ListItem(
                                colors = cardListItemColors(),
                                headlineContent = { Text(member.name + if (isSelf) " (you)" else "") },
                                supportingContent = { Text("${member.email} · ${member.role.label}") },
                            )
                        }
                    }
                }
            }

            if (invites.isNotEmpty()) {
                item {
                    SectionCard(title = "Pending invites") {
                        invites.forEachIndexed { index, invite ->
                            if (index > 0) HorizontalDivider()
                            SwipeActionRow(onEndAction = { pendingCancelInvite = invite }) {
                                ListItem(
                                    colors = cardListItemColors(),
                                    headlineContent = { Text(invite.email) },
                                    supportingContent = {
                                        Text("${invite.role.label} · sent ${invite.createdAt.mediumDate()}")
                                    },
                                )
                            }
                        }
                        Text(
                            "An invite is accepted automatically when that email signs up or logs in.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }

    if (inviting) {
        var email by remember { mutableStateOf("") }
        var role by remember { mutableStateOf(HouseholdRole.EDITOR) }
        var saving by remember { mutableStateOf(false) }
        var dialogError by remember { mutableStateOf<String?>(null) }
        AlertDialog(
            onDismissRequest = { inviting = false },
            title = { Text("Invite someone") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    FormField("Email", email, { email = it }, keyboardType = KeyboardType.Email)
                    DropdownField(
                        label = "Role",
                        selected = role,
                        options = listOf(HouseholdRole.EDITOR, HouseholdRole.VIEWER),
                        optionLabel = { it.label },
                        onSelect = { role = it },
                    )
                    dialogError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                }
            },
            confirmButton = {
                TextButton(
                    enabled = email.isNotBlank() && !saving,
                    onClick = {
                        val id = household?.id ?: return@TextButton
                        saving = true
                        scope.launch {
                            try {
                                Api.post<HouseholdInviteCreate, HouseholdInviteResponse>(
                                    "/users/households/$id/invites",
                                    HouseholdInviteCreate(email.trim(), role),
                                )
                                inviting = false
                                reloadKey++
                            } catch (e: Exception) {
                                dialogError = e.message ?: "Couldn't send that invite."
                            } finally {
                                saving = false
                            }
                        }
                    },
                ) { Text("Send") }
            },
            dismissButton = { TextButton(onClick = { inviting = false }) { Text("Cancel") } },
        )
    }

    pendingRemoveMember?.let { member ->
        ConfirmDialog(
            title = "Remove ${member.name}?",
            message = "They lose access to this household's shared accounts and goals.",
            confirmLabel = "Remove",
            onConfirm = {
                val id = household?.id ?: return@ConfirmDialog
                scope.launch {
                    try {
                        Api.delete("/users/householdmember/${member.id}")
                        reloadKey++
                    } catch (e: Exception) {
                        error = e.message ?: "Couldn't remove that member."
                    }
                }
            },
            onDismiss = { pendingRemoveMember = null },
        )
    }

    pendingCancelInvite?.let { invite ->
        ConfirmDialog(
            title = "Cancel the invite to ${invite.email}?",
            message = "They won't be added if they sign up later.",
            confirmLabel = "Cancel invite",
            onConfirm = {
                scope.launch {
                    try {
                        // Not nested under the household: the backend route is a bare
                        // /users/invites/{id}.
                        Api.delete("/users/invites/${invite.id}")
                        reloadKey++
                    } catch (e: Exception) {
                        error = e.message ?: "Couldn't cancel that invite."
                    }
                }
            },
            onDismiss = { pendingCancelInvite = null },
        )
    }
}
