package com.ivanlee.financetracker.ui.components

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberTopAppBarState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.RowScope
import com.ivanlee.financetracker.state.QuickAddViewModel
import com.ivanlee.financetracker.state.ViewModeViewModel

/**
 * The shell every top-level screen uses.
 *
 * Bundles the four things all of them need and none of them should re-derive: an M3 top app
 * bar that collapses on scroll, the vault + view-mode toolbar controls, the pull-to-Quick-Add
 * gesture, and the reload-on-Quick-Add wiring. Detail screens use [DetailScaffold] instead.
 *
 * @param onReload re-fetch this screen's data; called on first composition and whenever
 *   something is logged anywhere in the app.
 */
@Composable
fun MainScreenScaffold(
    title: String,
    viewModeVm: ViewModeViewModel,
    quickAddVm: QuickAddViewModel,
    isLoading: Boolean,
    error: String?,
    onErrorShown: () -> Unit,
    onReload: suspend () -> Unit,
    modifier: Modifier = Modifier,
    showSkeleton: Boolean = isLoading,
    floatingActionButton: @Composable () -> Unit = {},
    actions: @Composable RowScope.() -> Unit = {},
    content: LazyListScope.() -> Unit,
) {
    val scrollBehavior = TopAppBarDefaults.enterAlwaysScrollBehavior(rememberTopAppBarState())
    val snackbarHostState = remember { SnackbarHostState() }
    val listState = rememberLazyListState()
    val pull = rememberQuickAddPull(enabled = !quickAddVm.isPresented) { quickAddVm.open() }

    LaunchedEffect(Unit) { onReload() }
    LaunchedEffect(quickAddVm.reloadToken) {
        if (quickAddVm.reloadToken > 0) onReload()
    }
    LaunchedEffect(error) {
        if (error != null) {
            snackbarHostState.showSnackbar(error)
            onErrorShown()
        }
    }

    Scaffold(
        modifier = modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            TopAppBar(
                title = { Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                actions = {
                    VaultLockButton(viewModeVm)
                    ViewModeSwitcher(viewModeVm)
                    actions()
                },
                scrollBehavior = scrollBehavior,
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        floatingActionButton = floatingActionButton,
    ) { padding ->
        Box(
            Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            LazyColumn(
                state = listState,
                modifier = Modifier
                    .fillMaxSize()
                    .quickAddPull(pull),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(12.dp),
                content = content,
            )
            if (showSkeleton) {
                LoadingSkeleton(Modifier.fillMaxSize())
            }
            QuickAddPullIndicator(pull)
        }
    }
}

/**
 * A pushed detail/form screen: back arrow, optional overflow actions, no navigation suite of
 * its own (the NavHost sits inside the suite, so the bar/rail stays put underneath).
 */
@Composable
fun DetailScaffold(
    title: String,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    error: String? = null,
    onErrorShown: () -> Unit = {},
    centered: Boolean = false,
    floatingActionButton: @Composable () -> Unit = {},
    actions: @Composable RowScope.() -> Unit = {},
    content: @Composable (PaddingValues) -> Unit,
) {
    val scrollBehavior = TopAppBarDefaults.enterAlwaysScrollBehavior(rememberTopAppBarState())
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(error) {
        if (error != null) {
            snackbarHostState.showSnackbar(error)
            onErrorShown()
        }
    }

    Scaffold(
        modifier = modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            val titleContent: @Composable () -> Unit = {
                androidx.compose.foundation.layout.Column {
                    Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (subtitle != null) {
                        Text(
                            subtitle,
                            style = androidx.compose.material3.MaterialTheme.typography.labelMedium,
                            color = androidx.compose.material3.MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
            if (centered) {
                CenterAlignedTopAppBar(
                    title = titleContent,
                    navigationIcon = { BackButton(onBack) },
                    actions = actions,
                    scrollBehavior = scrollBehavior,
                )
            } else {
                TopAppBar(
                    title = titleContent,
                    navigationIcon = { BackButton(onBack) },
                    actions = actions,
                    scrollBehavior = scrollBehavior,
                )
            }
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        floatingActionButton = floatingActionButton,
        content = content,
    )
}
