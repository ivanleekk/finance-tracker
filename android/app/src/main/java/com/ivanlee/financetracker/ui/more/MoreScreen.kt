package com.ivanlee.financetracker.ui.more

import androidx.compose.foundation.clickable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Autorenew
import androidx.compose.material.icons.filled.Category
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Savings
import androidx.compose.material.icons.filled.Security
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import com.ivanlee.financetracker.BuildConfig
import com.ivanlee.financetracker.state.QuickAddViewModel
import com.ivanlee.financetracker.state.SessionViewModel
import com.ivanlee.financetracker.state.ViewModeViewModel
import com.ivanlee.financetracker.ui.components.ConfirmDialog
import com.ivanlee.financetracker.ui.components.MainScreenScaffold
import com.ivanlee.financetracker.ui.components.SectionCard
import com.ivanlee.financetracker.ui.components.cardListItemColors

/** Everything that isn't one of the four working tabs. */
@Composable
fun MoreScreen(
    sessionVm: SessionViewModel,
    viewModeVm: ViewModeViewModel,
    quickAddVm: QuickAddViewModel,
    onNavigate: (String) -> Unit,
    routes: MoreRoutes,
) {
    var confirmLogout by remember { mutableStateOf(false) }
    val household = sessionVm.activeHousehold

    MainScreenScaffold(
        title = "More",
        viewModeVm = viewModeVm,
        quickAddVm = quickAddVm,
        isLoading = false,
        showSkeleton = false,
        error = null,
        onErrorShown = {},
        onReload = {},
    ) {
        item {
            SectionCard {
                ListItem(
                    colors = cardListItemColors(),
                    headlineContent = { Text(sessionVm.user?.name ?: "Signed in") },
                    supportingContent = { Text(sessionVm.user?.email.orEmpty()) },
                    leadingContent = { Icon(Icons.Filled.Person, contentDescription = null) },
                    modifier = Modifier.clickable { onNavigate(routes.profile) },
                )
            }
        }

        // Household switcher — only meaningful once there is more than one to switch between.
        if (sessionVm.households.size > 1) {
            item {
                SectionCard(title = "Household") {
                    sessionVm.households.forEachIndexed { index, candidate ->
                        if (index > 0) HorizontalDivider()
                        ListItem(
                            colors = cardListItemColors(),
                            headlineContent = { Text(candidate.name) },
                            supportingContent = { Text(candidate.baseCurrency) },
                            trailingContent = {
                                if (candidate.id == household?.id) Text("✓")
                            },
                            modifier = Modifier.clickable { sessionVm.selectHousehold(candidate) },
                        )
                    }
                }
            }
        }

        item {
            SectionCard(title = "Money") {
                MoreRow("Budgets & emergency fund", Icons.Filled.Savings) { onNavigate(routes.budgets) }
                HorizontalDivider()
                MoreRow("Shared spending", Icons.Filled.Groups) { onNavigate(routes.reimbursements) }
                HorizontalDivider()
                MoreRow("Recurring", Icons.Filled.Autorenew) { onNavigate(routes.recurring) }
                HorizontalDivider()
                MoreRow("Categories", Icons.Filled.Category) { onNavigate(routes.categories) }
                HorizontalDivider()
                MoreRow("Reports & export", Icons.Filled.Description) { onNavigate(routes.reports) }
            }
        }

        item {
            SectionCard(title = "Household") {
                MoreRow("Settings", Icons.Filled.Home) { onNavigate(routes.household) }
                HorizontalDivider()
                MoreRow("Members & invites", Icons.Filled.Group) { onNavigate(routes.members) }
                HorizontalDivider()
                MoreRow("Create household", Icons.Filled.Add) { onNavigate(routes.createHousehold) }
            }
        }

        item {
            SectionCard(title = "You") {
                MoreRow("Profile", Icons.Filled.Person) { onNavigate(routes.profile) }
                HorizontalDivider()
                MoreRow("Email & password", Icons.Filled.Security) { onNavigate(routes.security) }
                HorizontalDivider()
                MoreRow("Privacy & vault", Icons.Filled.Lock) { onNavigate(routes.privacy) }
                HorizontalDivider()
                MoreRow("Appearance", Icons.Filled.Palette) { onNavigate(routes.appearance) }
                if (BuildConfig.DEBUG) {
                    HorizontalDivider()
                    MoreRow("API server", Icons.Filled.Cloud) { onNavigate(routes.apiServer) }
                }
            }
        }

        item {
            SectionCard {
                ListItem(
                    colors = cardListItemColors(),
                    headlineContent = {
                        Text("Log out", color = MaterialTheme.colorScheme.error)
                    },
                    leadingContent = {
                        Icon(
                            Icons.AutoMirrored.Filled.Logout,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.error,
                        )
                    },
                    modifier = Modifier.clickable { confirmLogout = true },
                )
            }
        }

        item {
            Text(
                "Waypoint ${BuildConfig.VERSION_NAME}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }

    if (confirmLogout) {
        ConfirmDialog(
            title = "Log out?",
            message = "You'll need to sign in again to see your finances.",
            confirmLabel = "Log out",
            onConfirm = { sessionVm.logout() },
            onDismiss = { confirmLogout = false },
        )
    }
}

@Composable
private fun MoreRow(title: String, icon: ImageVector, onClick: () -> Unit) {
    ListItem(
        colors = cardListItemColors(),
        headlineContent = { Text(title) },
        leadingContent = { Icon(icon, contentDescription = null) },
        modifier = Modifier.clickable(onClick = onClick),
    )
}

/** Route strings the More screen navigates to, passed in so it stays free of nav plumbing. */
data class MoreRoutes(
    val profile: String,
    val security: String,
    val privacy: String,
    val household: String,
    val appearance: String,
    val budgets: String,
    val reimbursements: String,
    val recurring: String,
    val categories: String,
    val reports: String,
    val members: String,
    val createHousehold: String,
    val apiServer: String,
)
