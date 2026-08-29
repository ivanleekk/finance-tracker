package com.ivanlee.financetracker.ui.dashboard

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountBalance
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ivanlee.financetracker.data.model.CounterpartyBalanceResponse
import com.ivanlee.financetracker.data.model.AccountResponse
import com.ivanlee.financetracker.data.model.AssetResponse
import com.ivanlee.financetracker.data.model.BalanceResponse
import com.ivanlee.financetracker.data.model.CategoryResponse
import com.ivanlee.financetracker.data.model.EmergencyFundResponse
import com.ivanlee.financetracker.data.model.NetWorthProjectionResponse
import com.ivanlee.financetracker.data.model.PerformanceMetrics
import com.ivanlee.financetracker.data.model.PortfolioMetricsResponse
import com.ivanlee.financetracker.data.model.PortfolioSnapshotResponse
import com.ivanlee.financetracker.data.model.PortfolioTimeseriesPoint
import com.ivanlee.financetracker.data.model.SubPortfolioResponse
import com.ivanlee.financetracker.data.model.TransactionResponse
import com.ivanlee.financetracker.data.model.TransactionType
import com.ivanlee.financetracker.data.net.Api
import com.ivanlee.financetracker.logic.BudgetPresentation
import com.ivanlee.financetracker.logic.NetWorthAccountInput
import com.ivanlee.financetracker.logic.RunwayTone
import com.ivanlee.financetracker.logic.currency
import com.ivanlee.financetracker.logic.currencyWhole
import com.ivanlee.financetracker.logic.monthYear
import com.ivanlee.financetracker.logic.OwedTotals
import com.ivanlee.financetracker.logic.Reimbursements
import com.ivanlee.financetracker.logic.netWorthBreakdown
import com.ivanlee.financetracker.logic.shortDay
import com.ivanlee.financetracker.state.QuickAddViewModel
import com.ivanlee.financetracker.state.SessionViewModel
import com.ivanlee.financetracker.state.ViewModeViewModel
import com.ivanlee.financetracker.ui.components.AdaptiveStatGrid
import com.ivanlee.financetracker.ui.components.EmptyState
import com.ivanlee.financetracker.ui.components.PrivateBadge
import com.ivanlee.financetracker.ui.components.StatTileData
import com.ivanlee.financetracker.ui.components.MainScreenScaffold
import com.ivanlee.financetracker.ui.components.SectionCard
import com.ivanlee.financetracker.ui.components.NetWorthSplitChart
import com.ivanlee.financetracker.ui.components.StackedAreaChart
import com.ivanlee.financetracker.ui.theme.LocalAppTheme
import com.ivanlee.financetracker.ui.theme.luminanceIsDark
import com.ivanlee.financetracker.ui.theme.negativeColor
import com.ivanlee.financetracker.ui.theme.positiveColor
import com.ivanlee.financetracker.ui.theme.warningColor
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import java.time.Instant
import java.time.ZoneOffset
import com.ivanlee.financetracker.ui.components.cardListItemColors

/**
 * The Dashboard tab. Android port of ios/FinanceTracker/Views/Dashboard/DashboardView.swift:
 * net worth (cash + investments, stacked), emergency-fund runway, debt outlook, headline
 * returns, top holdings, accounts and recent activity.
 */
@Composable
fun DashboardScreen(
    sessionVm: SessionViewModel,
    viewModeVm: ViewModeViewModel,
    quickAddVm: QuickAddViewModel,
    onSeeAccounts: () -> Unit,
    onSeePortfolio: () -> Unit,
    onOpenAccount: (String) -> Unit,
    onOpenBudgets: () -> Unit,
) {
    var accounts by remember { mutableStateOf<List<AccountResponse>>(emptyList()) }
    var balances by remember { mutableStateOf<List<BalanceResponse>>(emptyList()) }
    var transactions by remember { mutableStateOf<List<TransactionResponse>>(emptyList()) }
    var categories by remember { mutableStateOf<List<CategoryResponse>>(emptyList()) }
    var snapshots by remember { mutableStateOf<List<PortfolioSnapshotResponse>>(emptyList()) }
    var timeseries by remember { mutableStateOf<List<PortfolioTimeseriesPoint>>(emptyList()) }
    var subPortfolios by remember { mutableStateOf<List<SubPortfolioResponse>>(emptyList()) }
    var assets by remember { mutableStateOf<List<AssetResponse>>(emptyList()) }
    var metrics by remember { mutableStateOf<PortfolioMetricsResponse?>(null) }
    var emergencyFund by remember { mutableStateOf<EmergencyFundResponse?>(null) }
    var projection by remember { mutableStateOf<NetWorthProjectionResponse?>(null) }
    // Outstanding debts either way. They sit in no account, so net worth has to be told
    // about them or a split bill's unreturned half looks like money that evaporated.
    var owed by remember { mutableStateOf<List<CounterpartyBalanceResponse>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var lastLoadedAt by remember { mutableStateOf<Instant?>(null) }

    val household = sessionVm.activeHousehold
    val baseCurrency = household?.baseCurrency ?: "USD"
    val userId = sessionVm.user?.id
    val theme = LocalAppTheme.current
    val dark = MaterialTheme.colorScheme.background.luminanceIsDark()

    suspend fun load() {
        val h = sessionVm.activeHousehold ?: return
        isLoading = true
        try {
            coroutineScope {
                val accountsReq = async { Api.get<List<AccountResponse>>("/accounts/household/${h.id}") }
                val balancesReq = async { Api.get<List<BalanceResponse>>("/accounts/balances/household/${h.id}") }
                val txnsReq = async { Api.get<List<TransactionResponse>>("/cashflow/transactions/household/${h.id}") }
                val categoriesReq = async { Api.get<List<CategoryResponse>>("/cashflow/categories/household/${h.id}") }
                val snapshotsReq = async {
                    Api.get<List<PortfolioSnapshotResponse>>("/portfolio/snapshots/household/${h.id}?latest_only=true")
                }
                val timeseriesReq = async {
                    Api.get<List<PortfolioTimeseriesPoint>>("/portfolio/snapshots/household/${h.id}/timeseries")
                }
                val subsReq = async { Api.get<List<SubPortfolioResponse>>("/portfolio/subportfolios/household/${h.id}") }
                val assetsReq = async { Api.get<List<AssetResponse>>("/portfolio/assets") }
                // Metrics, emergency fund and projection are supplementary — one of them
                // erroring must never blank the dashboard the user came for.
                val metricsReq = async {
                    runCatching { Api.get<PortfolioMetricsResponse>("/portfolio/household/${h.id}/metrics") }.getOrNull()
                }
                val fundReq = async {
                    runCatching { Api.get<EmergencyFundResponse>("/cashflow/household/${h.id}/emergency-fund") }.getOrNull()
                }
                val projectionReq = async {
                    runCatching {
                        Api.get<NetWorthProjectionResponse>("/accounts/household/${h.id}/projection?months=360")
                    }.getOrNull()
                }
                val owedReq = async {
                    runCatching {
                        Api.get<List<CounterpartyBalanceResponse>>(
                            "/cashflow/reimbursements/household/${h.id}"
                        )
                    }.getOrNull()
                }

                accounts = accountsReq.await()
                balances = balancesReq.await()
                transactions = txnsReq.await()
                categories = categoriesReq.await()
                snapshots = snapshotsReq.await()
                timeseries = timeseriesReq.await()
                subPortfolios = subsReq.await()
                assets = assetsReq.await()
                metrics = metricsReq.await()
                emergencyFund = fundReq.await()
                projection = projectionReq.await()
                owed = owedReq.await() ?: emptyList()
            }
            lastLoadedAt = Instant.now()
        } catch (e: Exception) {
            error = e.message ?: "Couldn't load the dashboard."
        } finally {
            isLoading = false
        }
    }

    // View-mode visibility: accounts/sub-portfolios the current mode shows, and the derived
    // data (balances, holdings, transactions) that inherits their visibility.
    val visibleAccounts = accounts.filter { viewModeVm.isVisible(it.ownerUserId, userId) }
    val visibleAccountIds = visibleAccounts.map { it.id }.toSet()
    val visibleSubIds = subPortfolios
        .filter { viewModeVm.isVisible(it.ownerUserId, userId) }
        .map { it.id }.toSet()
    val visibleBalances = balances.filter { it.accountId in visibleAccountIds }
    val visibleSnapshots = snapshots.filter { it.subPortfolioId in visibleSubIds }
    val visibleTimeseries = timeseries.filter { it.subPortfolioId in visibleSubIds }

    val assetsById = assets.associateBy { it.id }
    val categoriesById = categories.associateBy { it.id }
    val accountsById = accounts.associateBy { it.id }

    /** Liabilities hold their outstanding balance as a positive number and count against net worth. */
    val liabilityIds = accounts.filter { it.kind == "liability" }.map { it.id }.toSet()

    val latestByAccount = remember(balances) {
        buildMap<String, BalanceResponse> {
            balances.forEach { balance ->
                val existing = get(balance.accountId)
                if (existing == null || existing.date.isBefore(balance.date)) put(balance.accountId, balance)
            }
        }
    }

    val currentCash = visibleBalances
        .groupBy { it.accountId }
        .entries.sumOf { (accountId, history) ->
            val latest = history.maxByOrNull { it.date }?.homeValue ?: 0.0
            if (accountId in liabilityIds) -latest else latest
        }

    val latestSnapshotDate = visibleSnapshots.maxOfOrNull { it.date }
    val latestHoldings = visibleSnapshots.filter { it.date == latestSnapshotDate && it.quantity > 0 }
    val currentPortfolioValue = latestHoldings.sumOf { it.currentValueHomeCurrency }
    val topHoldings = latestHoldings.sortedByDescending { it.currentValueHomeCurrency }.take(4)
    // Debts either way belong in net worth: a receivable is a claim you hold, a payable is one
    // held against you. Kept in step with the split donut below, which draws its own "Owed to
    // You" slice from the same figures — a headline that ignored them while the chart showed
    // them would be worse than neither.
    val owedTotals = Reimbursements.totals(owed)
    val netWorth =
        currentCash + currentPortfolioValue + owedTotals.owedToYou - owedTotals.youOwe

    val worthBreakdown = remember(visibleAccounts, visibleBalances, currentPortfolioValue, owed) {
        val byAccount = visibleBalances.groupBy { it.accountId }
        val inputs = visibleAccounts.map { account ->
            NetWorthAccountInput(account.kind, account.liquidity, byAccount[account.id] ?: emptyList())
        }
        netWorthBreakdown(
            inputs,
            currentPortfolioValue,
            OwedTotals(owedToYou = owedTotals.owedToYou, youOwe = owedTotals.youOwe),
        )
    }

    val recentTransactions = transactions
        .filter { it.accountId in visibleAccountIds }
        .sortedByDescending { it.date }
        .take(5)

    // One stacked band per date: cash forward-filled from account balances, investments
    // forward-filled from snapshot totals, so the two always sum to net worth on that date.
    val netWorthSeries = remember(visibleBalances, visibleTimeseries) {
        buildNetWorthSeries(visibleBalances, visibleTimeseries, liabilityIds)
    }

    MainScreenScaffold(
        title = household?.name ?: "Dashboard",
        viewModeVm = viewModeVm,
        quickAddVm = quickAddVm,
        isLoading = isLoading,
        showSkeleton = isLoading && balances.isEmpty(),
        error = error,
        onErrorShown = { error = null },
        onReload = {
            // Re-fetching all eleven requests on every tab reselect makes switching tabs
            // visibly re-spin a screen where nothing has changed. Skip while still fresh;
            // a Quick Add bumps reloadToken, which reloads through this same path.
            val last = lastLoadedAt
            if (last == null || Instant.now().epochSecond - last.epochSecond >= 30) load()
        },
    ) {
        item {
            SectionCard {
                Text(
                    "Net Worth",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    netWorth.currency(baseCurrency),
                    style = MaterialTheme.typography.displaySmall,
                    fontWeight = FontWeight.Bold,
                )
                if (netWorthSeries.size > 1) {
                    StackedAreaChart(
                        series = netWorthSeries,
                        lowerColor = theme.secondary.accent(dark),
                        upperColor = theme.primary.accent(dark),
                    )
                }
                if (visibleSnapshots.isNotEmpty()) {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        BreakdownCell("Cash", currentCash, theme.secondary.accent(dark), baseCurrency, Modifier.weight(1f))
                        BreakdownCell("Investments", currentPortfolioValue, theme.primary.accent(dark), baseCurrency, Modifier.weight(1f))
                    }
                }
            }
        }

        emergencyFund?.let { fund ->
            item {
                SectionCard {
                    RunwaySummary(fund, baseCurrency, onOpenBudgets)
                }
            }
        }

        if (worthBreakdown.slices.isNotEmpty()) {
            item {
                SectionCard(title = "Net Worth Split") {
                    NetWorthSplitChart(
                        slices = worthBreakdown.slices,
                        sliceTotal = worthBreakdown.sliceTotal,
                        liabilities = worthBreakdown.liabilities,
                        netWorth = netWorth,
                        currencyCode = baseCurrency,
                    )
                }
            }
        }

        projection?.takeIf { it.currentNetWorth < 0 || it.debtFreeDate != null }?.let { p ->
            item {
                SectionCard(title = "Outlook") {
                    KeyValue(
                        "Net worth positive",
                        if (p.currentNetWorth >= 0) "Already there"
                        else p.netWorthPositiveDate?.monthYear() ?: "Not within 30 years",
                    )
                    KeyValue("Debt free", p.debtFreeDate?.monthYear() ?: "Not within 30 years")
                    KeyValue(
                        "Interest still to pay",
                        p.totalInterestRemaining.currencyWhole(baseCurrency),
                        valueColor = negativeColor(),
                    )
                }
            }
        }

        if (latestHoldings.isNotEmpty()) {
            item {
                SectionCard(title = "Returns") {
                    ReturnsGrid(metrics?.overallMetrics)
                }
            }
        }

        if (topHoldings.isNotEmpty()) {
            item {
                SectionCard(
                    title = "Portfolio",
                    trailing = { TextButton(onClick = onSeePortfolio) { Text("See all") } },
                ) {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(
                            "Total value",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(
                            currentPortfolioValue.currency(baseCurrency),
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                    topHoldings.forEach { holding ->
                        HoldingRow(
                            ticker = assetsById[holding.assetId]?.ticker ?: "—",
                            name = assetsById[holding.assetId]?.name,
                            quantity = holding.quantity,
                            value = holding.currentValueHomeCurrency,
                            currencyCode = baseCurrency,
                        )
                    }
                }
            }
        }

        item {
            SectionCard(
                title = "Accounts",
                trailing = { TextButton(onClick = onSeeAccounts) { Text("See all") } },
            ) {
                if (visibleAccounts.isEmpty() && !isLoading) {
                    EmptyState(
                        icon = Icons.Filled.AccountBalance,
                        title = "No accounts",
                        message = "Tap “See all” to add your first account.",
                    )
                }
                visibleAccounts.take(4).forEachIndexed { index, account ->
                    if (index > 0) HorizontalDivider()
                    AccountRow(
                        account = account,
                        latestBalance = latestByAccount[account.id],
                        onClick = { onOpenAccount(account.id) },
                        baseCurrency = baseCurrency,
                    )
                }
            }
        }

        item {
            SectionCard(title = "Recent activity") {
                if (recentTransactions.isEmpty() && !isLoading) {
                    Text(
                        "Nothing logged yet. Pull down to add something.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                recentTransactions.forEach { txn ->
                    TransactionRow(
                        transaction = txn,
                        categoryName = categoriesById[txn.categoryId]?.name,
                        accountName = accountsById[txn.accountId]?.name,
                        baseCurrency = baseCurrency,
                    )
                }
            }
        }
    }
}

/**
 * Forward-fills cash and investment values onto every date either series has a point for.
 *
 * Both sides have to be forward-filled: an account balance recorded on the 1st is still the
 * balance on the 15th, and a portfolio snapshot from Friday is still the value on Saturday.
 * Without it the stacked chart would collapse to zero on any date one series happens to miss.
 */
private fun buildNetWorthSeries(
    balances: List<BalanceResponse>,
    timeseries: List<PortfolioTimeseriesPoint>,
    liabilityIds: Set<String>,
): List<Triple<Instant, Double, Double>> {
    fun startOfDay(instant: Instant): Instant =
        instant.atZone(ZoneOffset.UTC).toLocalDate().atStartOfDay(ZoneOffset.UTC).toInstant()

    val dates = (balances.map { startOfDay(it.date) } + timeseries.map { startOfDay(it.date) })
        .distinct().sorted()
    if (dates.isEmpty()) return emptyList()

    val byAccount = balances.groupBy { it.accountId }.mapValues { it.value.sortedBy { b -> b.date } }
    val portfolioByDate = timeseries.groupBy { startOfDay(it.date) }
        .mapValues { entry -> entry.value.sumOf { it.value } }
    val snapshotDates = portfolioByDate.keys.sorted()

    return dates.map { date ->
        val cutoff = date.plusSeconds(86_399)
        val cash = byAccount.entries.sumOf { (accountId, history) ->
            val value = history.lastOrNull { !it.date.isAfter(cutoff) }?.homeValue ?: 0.0
            if (accountId in liabilityIds) -value else value
        }
        val portfolio = snapshotDates.lastOrNull { !it.isAfter(date) }?.let { portfolioByDate[it] } ?: 0.0
        Triple(date, cash, portfolio)
    }
}

@Composable
private fun BreakdownCell(
    title: String,
    value: Double,
    color: Color,
    currencyCode: String,
    modifier: Modifier = Modifier,
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            Box(Modifier.size(8.dp).clip(CircleShape).background(color))
            Text(
                title,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text(
            value.currency(currencyCode),
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

@Composable
private fun KeyValue(
    label: String,
    value: String,
    valueColor: Color = MaterialTheme.colorScheme.onSurface,
) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodyMedium, color = valueColor)
    }
}

/** The compact returns row — the four figures worth a glance; the rest live on Portfolio. */
@Composable
private fun ReturnsGrid(metrics: PerformanceMetrics?) {
    AdaptiveStatGrid(
        listOf(
            StatTileData("Overall Return", percentString(metrics?.simpleReturn), signal = metrics?.simpleReturn),
            StatTileData("TWR (${returnBasis(metrics?.annualized)})", percentString(metrics?.timeWeightedReturn), signal = metrics?.timeWeightedReturn),
            StatTileData("IRR / MWR (${returnBasis(metrics?.annualized)})", percentString(metrics?.moneyWeightedReturn), signal = metrics?.moneyWeightedReturn),
            StatTileData("Sharpe", ratioString(metrics?.sharpeRatio)),
        )
    )
}

fun percentString(value: Double?): String {
    if (value == null || !value.isFinite()) return "—"
    return String.format(java.util.Locale.getDefault(), "%+.1f%%", value * 100)
}

/**
 * Label for the basis a return is quoted on. The backend only annualizes TWR
 * and MWR once the window spans at least a year; shorter windows carry the
 * plain period return, and calling that "Ann." is how a 2% week ended up
 * displayed as +180% (issue #256).
 */
fun returnBasis(annualized: Boolean?): String = if (annualized == true) "Ann." else "Period"

fun ratioString(value: Double?): String {
    if (value == null || !value.isFinite()) return "—"
    return String.format(java.util.Locale.getDefault(), "%.2f", value)
}

/** Compact runway readout, linking through to Budgets. */
@Composable
private fun RunwaySummary(
    fund: EmergencyFundResponse,
    currencyCode: String,
    onClick: () -> Unit,
) {
    val tone = BudgetPresentation.runwayTone(fund)
    val tint = when (tone) {
        RunwayTone.CRITICAL -> negativeColor()
        RunwayTone.LOW -> warningColor()
        RunwayTone.OK -> positiveColor()
        RunwayTone.UNKNOWN -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    Column(
        Modifier
            .fillMaxWidth()
            .clip(MaterialTheme.shapes.medium)
            .clickable(onClick = onClick),
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Text(
            "Emergency fund runway",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            BudgetPresentation.runwayLabel(fund),
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            color = tint,
        )
        Text(
            if (fund.monthsCovered == null) {
                "Log some expenses to measure your burn rate."
            } else {
                "${fund.liquidTotal.currencyWhole(currencyCode)} liquid against " +
                    "${fund.averageMonthlyExpenses.currencyWhole(currencyCode)}/month"
            },
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/**
 * One account in a list — the Accounts screen and the dashboard's preview both use it.
 *
 * **Liabilities are shown as what they are: money owed.** A loan's balance is stored as a
 * positive number, and rendering it as-is put `HDB Mortgage  $440,000.00` in the same colour,
 * sign and weight as real cash, while net worth quietly subtracted it — a household with two
 * loans read as if it had three-quarters of a million on hand. The figure is negated and
 * tinted with the error colour, and the caption says "Owed". Matches the web Accounts page
 * and the iOS `AccountRow`; the three are ports of each other.
 *
 * @param baseCurrency the household's reporting currency, so the caption names the account's
 *   own currency only when it differs. The amount renders in `account.currency` either way,
 *   and two accounts in different currencies otherwise show the same "$".
 * @param showsLiquidity false on the Accounts screen, where the row already sits under a
 *   section header naming the bucket — the caption read "Liquid" under a "Liquid" header on
 *   every row, spending the row's only secondary line on a word just read.
 */
@Composable
fun AccountRow(
    account: AccountResponse,
    latestBalance: BalanceResponse?,
    onClick: () -> Unit,
    baseCurrency: String? = null,
    showsLiquidity: Boolean = true,
) {
    val balance = latestBalance?.balance ?: 0.0
    val amount = if (account.isLiability) -balance else balance
    val caption = buildList {
        if (account.isLiability) add("Owed")
        if (showsLiquidity) add(account.liquidity.label)
        if (baseCurrency != null && account.currency != baseCurrency) add(account.currency)
    }.joinToString(" · ")
    ListItem(
        colors = cardListItemColors(),
        headlineContent = {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(account.name)
                if (account.ownerUserId != null) PrivateBadge()
            }
        },
        supportingContent = caption.takeIf { it.isNotEmpty() }?.let { { Text(it) } },
        trailingContent = {
            Text(
                amount.currency(account.currency),
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
                color = if (account.isLiability) {
                    MaterialTheme.colorScheme.error
                } else {
                    Color.Unspecified
                },
            )
        },
        modifier = Modifier.clickable(onClick = onClick),
    )
}

@Composable
fun HoldingRow(
    ticker: String,
    name: String?,
    quantity: Double,
    value: Double,
    currencyCode: String,
    /** Non-null adds a pencil for correcting the asset's ticker/currency (Portfolio tab only). */
    onEdit: (() -> Unit)? = null,
) {
    ListItem(
        colors = cardListItemColors(),
        headlineContent = { Text(ticker, fontWeight = FontWeight.Medium) },
        supportingContent = {
            Text(
                listOfNotNull(name, "${trimQuantity(quantity)} units").joinToString(" · "),
                maxLines = 1,
            )
        },
        trailingContent = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(value.currency(currencyCode), style = MaterialTheme.typography.bodyMedium)
                if (onEdit != null) {
                    IconButton(onClick = onEdit) {
                        Icon(
                            Icons.Filled.Edit,
                            contentDescription = "Edit $ticker",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        },
    )
}

/** "12" not "12.0", but "0.5" stays "0.5" — share counts are frequently fractional. */
fun trimQuantity(value: Double): String =
    if (value % 1.0 == 0.0) value.toLong().toString()
    else String.format(java.util.Locale.getDefault(), "%.4f", value).trimEnd('0').trimEnd('.')

@Composable
fun TransactionRow(
    transaction: TransactionResponse,
    categoryName: String?,
    accountName: String?,
    baseCurrency: String,
    onClick: (() -> Unit)? = null,
) {
    val isIncome = transaction.transactionType == TransactionType.INCOME
    val isTransfer = transaction.transferId != null
    ListItem(
        colors = cardListItemColors(),
        headlineContent = {
            Text(transaction.description?.takeIf { it.isNotBlank() } ?: categoryName ?: "Transaction")
        },
        supportingContent = {
            Column {
                Text(
                    listOfNotNull(
                        categoryName,
                        accountName,
                        transaction.date.shortDay(),
                    ).joinToString(" · "),
                    maxLines = 1,
                )
                // The amount on the right stays the full sum, because that is what left the
                // account. This says how much of it wasn't yours, which is otherwise invisible
                // on a list of full amounts.
                val splits = transaction.splits
                if (splits.isNotEmpty()) {
                    val currency = transaction.currency ?: baseCurrency
                    val text = if (splits.size == 1) {
                        "${splits[0].amount.currency(currency)} owed by ${splits[0].counterpartyName}"
                    } else {
                        val total = splits.sumOf { it.amount }
                        "${total.currency(currency)} split with " +
                            splits.joinToString(", ") { it.counterpartyName }
                    }
                    Text(
                        text,
                        style = MaterialTheme.typography.bodySmall,
                        color = warningColor(),
                        maxLines = 1,
                    )
                }
            }
        },
        trailingContent = {
            Text(
                (if (isIncome) "+" else "−") +
                    transaction.amount.currency(transaction.currency ?: baseCurrency),
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
                color = when {
                    isTransfer -> MaterialTheme.colorScheme.onSurfaceVariant
                    isIncome -> positiveColor()
                    else -> MaterialTheme.colorScheme.onSurface
                },
            )
        },
        modifier = if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier,
    )
}
