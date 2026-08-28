package com.ivanlee.financetracker.ui

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ListAlt
import androidx.compose.material.icons.filled.AccountBalance
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.PieChart
import androidx.compose.material.icons.outlined.AccountBalance
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.PieChart
import androidx.compose.ui.graphics.vector.ImageVector

/**
 * Every route in the app.
 *
 * A single flat NavHost rather than one graph per tab: the drill-ins genuinely cross tabs
 * (the Dashboard opens an account detail, the Portfolio opens a goal, More opens Budgets),
 * and duplicating those destinations per tab would mean five copies of every screen's state.
 */
object Routes {
    // Top-level (the navigation bar / rail destinations)
    const val DASHBOARD = "dashboard"
    const val ACCOUNTS = "accounts"
    const val PORTFOLIO = "portfolio"
    const val TRANSACTIONS = "transactions"
    const val MORE = "more"

    // Accounts
    const val ACCOUNT_DETAIL = "accounts/detail/{accountId}"
    const val ACCOUNT_FORM = "accounts/form?accountId={accountId}"
    const val ADD_BALANCE = "accounts/balance/{accountId}"
    const val LOAN_SCHEDULE = "accounts/loan/{accountId}"

    fun accountDetail(id: String) = "accounts/detail/$id"
    fun accountForm(id: String? = null) = "accounts/form?accountId=${id ?: ""}"
    fun addBalance(id: String) = "accounts/balance/$id"
    fun loanSchedule(id: String) = "accounts/loan/$id"

    // Portfolio
    const val SUB_PORTFOLIO = "portfolio/sub/{subPortfolioId}"
    const val TRADES = "portfolio/trades"
    const val TRADE_FORM = "portfolio/trade?tradeId={tradeId}&subPortfolioId={subPortfolioId}"
    const val DIVIDENDS = "portfolio/dividends"
    const val SUB_PORTFOLIO_CASH = "portfolio/cash/{subPortfolioId}"

    fun subPortfolio(id: String) = "portfolio/sub/$id"
    fun tradeForm(tradeId: String? = null, subPortfolioId: String? = null) =
        "portfolio/trade?tradeId=${tradeId ?: ""}&subPortfolioId=${subPortfolioId ?: ""}"

    fun subPortfolioCash(id: String) = "portfolio/cash/$id"

    // Goals (a goal is a sub-portfolio with a target — not a tab of its own)
    const val GOAL_DETAIL = "goals/{subPortfolioId}"
    const val GOAL_FORM = "goals/form?subPortfolioId={subPortfolioId}"

    fun goalDetail(id: String) = "goals/$id"
    fun goalForm(id: String? = null) = "goals/form?subPortfolioId=${id ?: ""}"

    // Transactions
    const val TRANSACTION_FORM = "transactions/form?transactionId={transactionId}"
    const val CATEGORIES = "transactions/categories"

    fun transactionForm(id: String? = null) = "transactions/form?transactionId=${id ?: ""}"

    // More
    const val PROFILE = "more/profile"
    const val SECURITY = "more/security"
    const val PRIVACY = "more/privacy"
    const val HOUSEHOLD = "more/household"
    const val APPEARANCE = "more/appearance"
    const val BUDGETS = "more/budgets"
    const val REIMBURSEMENTS = "more/reimbursements"
    const val CARDS = "more/cards"
    const val BUDGET_FORM = "more/budgets/form?budgetId={budgetId}"
    const val RECURRING = "more/recurring"
    const val RECURRING_FORM = "more/recurring/form?ruleId={ruleId}"
    const val REPORTS = "more/reports"
    const val MEMBERS = "more/members"
    const val CREATE_HOUSEHOLD = "more/household/new"
    const val API_SERVER = "more/api-server"

    fun budgetForm(id: String? = null) = "more/budgets/form?budgetId=${id ?: ""}"
    fun recurringForm(id: String? = null) = "more/recurring/form?ruleId=${id ?: ""}"
}

/**
 * The five navigation-bar destinations, in order. Same five as the iOS tab bar — Goals is
 * deliberately absent from both, because a goal is a sub-portfolio and lives inside Portfolio.
 */
enum class TopLevelDestination(
    val route: String,
    val label: String,
    val selectedIcon: ImageVector,
    val unselectedIcon: ImageVector,
) {
    DASHBOARD(
        Routes.DASHBOARD, "Dashboard",
        Icons.Filled.Dashboard, Icons.Outlined.Dashboard,
    ),
    ACCOUNTS(
        Routes.ACCOUNTS, "Accounts",
        Icons.Filled.AccountBalance, Icons.Outlined.AccountBalance,
    ),
    PORTFOLIO(
        Routes.PORTFOLIO, "Portfolio",
        Icons.Filled.PieChart, Icons.Outlined.PieChart,
    ),
    TRANSACTIONS(
        Routes.TRANSACTIONS, "Activity",
        Icons.AutoMirrored.Filled.ListAlt, Icons.AutoMirrored.Filled.ListAlt,
    ),
    MORE(
        Routes.MORE, "More",
        Icons.Filled.MoreHoriz, Icons.Outlined.MoreHoriz,
    ),
}
