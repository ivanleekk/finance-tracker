package com.ivanlee.financetracker.ui

import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import com.ivanlee.financetracker.state.QuickAddViewModel
import com.ivanlee.financetracker.state.SessionViewModel
import com.ivanlee.financetracker.state.ViewModeViewModel
import com.ivanlee.financetracker.ui.accounts.AccountDetailScreen
import com.ivanlee.financetracker.ui.accounts.AccountFormScreen
import com.ivanlee.financetracker.ui.accounts.AccountsScreen
import com.ivanlee.financetracker.ui.accounts.AddBalanceScreen
import com.ivanlee.financetracker.ui.accounts.LoanScheduleScreen
import com.ivanlee.financetracker.ui.dashboard.DashboardScreen
import com.ivanlee.financetracker.ui.goals.GoalDetailScreen
import com.ivanlee.financetracker.ui.goals.GoalFormScreen
import com.ivanlee.financetracker.ui.more.ApiServerScreen
import com.ivanlee.financetracker.ui.more.AppearanceSettingsScreen
import com.ivanlee.financetracker.ui.more.BudgetsScreen
import com.ivanlee.financetracker.ui.more.CardsScreen
import com.ivanlee.financetracker.ui.more.CreateHouseholdScreen
import com.ivanlee.financetracker.ui.more.HouseholdSettingsScreen
import com.ivanlee.financetracker.ui.more.MembersScreen
import com.ivanlee.financetracker.ui.more.MoreRoutes
import com.ivanlee.financetracker.ui.more.MoreScreen
import com.ivanlee.financetracker.ui.more.PrivacySettingsScreen
import com.ivanlee.financetracker.ui.more.ProfileSettingsScreen
import com.ivanlee.financetracker.ui.more.ReimbursementsScreen
import com.ivanlee.financetracker.ui.more.RecurringScreen
import com.ivanlee.financetracker.ui.more.ReportsScreen
import com.ivanlee.financetracker.ui.more.SecuritySettingsScreen
import com.ivanlee.financetracker.ui.portfolio.DividendsScreen
import com.ivanlee.financetracker.ui.portfolio.PortfolioScreen
import com.ivanlee.financetracker.ui.portfolio.SubPortfolioCashScreen
import com.ivanlee.financetracker.ui.portfolio.SubPortfolioDetailScreen
import com.ivanlee.financetracker.ui.portfolio.TradeFormScreen
import com.ivanlee.financetracker.ui.portfolio.TradesScreen
import com.ivanlee.financetracker.ui.transactions.CategoriesScreen
import com.ivanlee.financetracker.ui.transactions.TransactionFormScreen
import com.ivanlee.financetracker.ui.transactions.TransactionsScreen

/**
 * Every destination in the signed-in app.
 *
 * Form screens navigate back with `popBackStack()` after saving rather than to a named route:
 * the same form is reachable from several places (an account from the Dashboard or the
 * Accounts tab, a trade from Portfolio or a sub-portfolio), and popping is the only thing
 * that returns the user to wherever they actually came from.
 */
@Composable
fun WaypointNavHost(
    navController: NavHostController,
    sessionVm: SessionViewModel,
    viewModeVm: ViewModeViewModel,
    quickAddVm: QuickAddViewModel,
) {
    val householdId = sessionVm.activeHousehold?.id.orEmpty()

    /** Reload open screens after a write, then go back where we came from. */
    fun savedAndBack() {
        quickAddVm.requestReload()
        navController.popBackStack()
    }

    NavHost(navController = navController, startDestination = Routes.DASHBOARD) {

        // ---- Dashboard ------------------------------------------------------------------
        composable(Routes.DASHBOARD) {
            DashboardScreen(
                sessionVm = sessionVm,
                viewModeVm = viewModeVm,
                quickAddVm = quickAddVm,
                onSeeAccounts = { navController.navigateToTopLevel(TopLevelDestination.ACCOUNTS) },
                onSeePortfolio = { navController.navigateToTopLevel(TopLevelDestination.PORTFOLIO) },
                onOpenAccount = { navController.navigate(Routes.accountDetail(it)) },
                onOpenBudgets = { navController.navigate(Routes.BUDGETS) },
            )
        }

        // ---- Accounts -------------------------------------------------------------------
        composable(Routes.ACCOUNTS) {
            AccountsScreen(
                sessionVm = sessionVm,
                viewModeVm = viewModeVm,
                quickAddVm = quickAddVm,
                onOpenAccount = { navController.navigate(Routes.accountDetail(it)) },
                onNewAccount = { navController.navigate(Routes.accountForm()) },
            )
        }
        composable(
            Routes.ACCOUNT_DETAIL,
            arguments = listOf(navArgument("accountId") { type = NavType.StringType }),
        ) { entry ->
            AccountDetailScreen(
                accountId = entry.arguments?.getString("accountId").orEmpty(),
                sessionVm = sessionVm,
                onBack = { navController.popBackStack() },
                onEdit = { navController.navigate(Routes.accountForm(it)) },
                onAddBalance = { navController.navigate(Routes.addBalance(it)) },
                onLoanSchedule = { navController.navigate(Routes.loanSchedule(it)) },
            )
        }
        composable(
            Routes.ACCOUNT_FORM,
            arguments = listOf(
                navArgument("accountId") { type = NavType.StringType; defaultValue = "" },
            ),
        ) { entry ->
            AccountFormScreen(
                accountId = entry.arguments?.getString("accountId")?.takeIf { it.isNotEmpty() },
                sessionVm = sessionVm,
                onBack = { navController.popBackStack() },
                onSaved = ::savedAndBack,
            )
        }
        composable(
            Routes.ADD_BALANCE,
            arguments = listOf(navArgument("accountId") { type = NavType.StringType }),
        ) { entry ->
            AddBalanceScreen(
                accountId = entry.arguments?.getString("accountId").orEmpty(),
                sessionVm = sessionVm,
                onBack = { navController.popBackStack() },
                onSaved = ::savedAndBack,
            )
        }
        composable(
            Routes.LOAN_SCHEDULE,
            arguments = listOf(navArgument("accountId") { type = NavType.StringType }),
        ) { entry ->
            LoanScheduleScreen(
                accountId = entry.arguments?.getString("accountId").orEmpty(),
                onBack = { navController.popBackStack() },
            )
        }

        // ---- Portfolio ------------------------------------------------------------------
        composable(Routes.PORTFOLIO) {
            PortfolioScreen(
                sessionVm = sessionVm,
                viewModeVm = viewModeVm,
                quickAddVm = quickAddVm,
                onOpenSubPortfolio = { navController.navigate(Routes.subPortfolio(it)) },
                onOpenGoal = { navController.navigate(Routes.goalDetail(it)) },
                onNewGoal = { navController.navigate(Routes.goalForm()) },
                onOpenTrades = { navController.navigate(Routes.TRADES) },
                onOpenDividends = { navController.navigate(Routes.DIVIDENDS) },
                onNewTrade = { navController.navigate(Routes.tradeForm()) },
            )
        }
        composable(
            Routes.SUB_PORTFOLIO,
            arguments = listOf(navArgument("subPortfolioId") { type = NavType.StringType }),
        ) { entry ->
            val id = entry.arguments?.getString("subPortfolioId").orEmpty()
            SubPortfolioDetailScreen(
                subPortfolioId = id,
                sessionVm = sessionVm,
                onBack = { navController.popBackStack() },
                onOpenGoal = { navController.navigate(Routes.goalDetail(it)) },
                onRecordTrade = { navController.navigate(Routes.tradeForm(subPortfolioId = it)) },
            )
        }
        composable(Routes.TRADES) {
            TradesScreen(
                sessionVm = sessionVm,
                onBack = { navController.popBackStack() },
                onNewTrade = { navController.navigate(Routes.tradeForm()) },
                onEditTrade = { navController.navigate(Routes.tradeForm(tradeId = it)) },
            )
        }
        composable(
            Routes.TRADE_FORM,
            arguments = listOf(
                navArgument("tradeId") { type = NavType.StringType; defaultValue = "" },
                navArgument("subPortfolioId") { type = NavType.StringType; defaultValue = "" },
            ),
        ) { entry ->
            TradeFormScreen(
                tradeId = entry.arguments?.getString("tradeId")?.takeIf { it.isNotEmpty() },
                presetSubPortfolioId = entry.arguments?.getString("subPortfolioId")?.takeIf { it.isNotEmpty() },
                sessionVm = sessionVm,
                onBack = { navController.popBackStack() },
                onSaved = ::savedAndBack,
            )
        }
        composable(Routes.DIVIDENDS) {
            DividendsScreen(sessionVm = sessionVm, onBack = { navController.popBackStack() })
        }
        composable(
            Routes.SUB_PORTFOLIO_CASH,
            arguments = listOf(navArgument("subPortfolioId") { type = NavType.StringType }),
        ) { entry ->
            SubPortfolioCashScreen(
                subPortfolioId = entry.arguments?.getString("subPortfolioId").orEmpty(),
                sessionVm = sessionVm,
                onBack = { navController.popBackStack() },
                onSaved = ::savedAndBack,
            )
        }

        // ---- Goals ----------------------------------------------------------------------
        composable(
            Routes.GOAL_DETAIL,
            arguments = listOf(navArgument("subPortfolioId") { type = NavType.StringType }),
        ) { entry ->
            val id = entry.arguments?.getString("subPortfolioId").orEmpty()
            GoalDetailScreen(
                subPortfolioId = id,
                sessionVm = sessionVm,
                onBack = { navController.popBackStack() },
                onEdit = { navController.navigate(Routes.goalForm(it)) },
                onAddFunds = { navController.navigate(Routes.subPortfolioCash(it)) },
                onDeleted = {
                    quickAddVm.requestReload()
                    navController.popBackStack()
                },
            )
        }
        composable(
            Routes.GOAL_FORM,
            arguments = listOf(
                navArgument("subPortfolioId") { type = NavType.StringType; defaultValue = "" },
            ),
        ) { entry ->
            GoalFormScreen(
                subPortfolioId = entry.arguments?.getString("subPortfolioId")?.takeIf { it.isNotEmpty() },
                sessionVm = sessionVm,
                onBack = { navController.popBackStack() },
                onSaved = ::savedAndBack,
            )
        }

        // ---- Transactions ---------------------------------------------------------------
        composable(Routes.TRANSACTIONS) {
            TransactionsScreen(
                sessionVm = sessionVm,
                viewModeVm = viewModeVm,
                quickAddVm = quickAddVm,
                onNewTransaction = { navController.navigate(Routes.transactionForm()) },
                onEditTransaction = { navController.navigate(Routes.transactionForm(it)) },
                onOpenCategories = { navController.navigate(Routes.CATEGORIES) },
            )
        }
        composable(
            Routes.TRANSACTION_FORM,
            arguments = listOf(
                navArgument("transactionId") { type = NavType.StringType; defaultValue = "" },
            ),
        ) { entry ->
            TransactionFormScreen(
                transactionId = entry.arguments?.getString("transactionId")?.takeIf { it.isNotEmpty() },
                sessionVm = sessionVm,
                onBack = { navController.popBackStack() },
                onSaved = ::savedAndBack,
            )
        }
        composable(Routes.CATEGORIES) {
            CategoriesScreen(householdId = householdId, onBack = { navController.popBackStack() })
        }

        // ---- More -----------------------------------------------------------------------
        composable(Routes.MORE) {
            MoreScreen(
                sessionVm = sessionVm,
                viewModeVm = viewModeVm,
                quickAddVm = quickAddVm,
                onNavigate = { navController.navigate(it) },
                routes = MoreRoutes(
                    profile = Routes.PROFILE,
                    security = Routes.SECURITY,
                    privacy = Routes.PRIVACY,
                    household = Routes.HOUSEHOLD,
                    appearance = Routes.APPEARANCE,
                    budgets = Routes.BUDGETS,
                    reimbursements = Routes.REIMBURSEMENTS,
                    cards = Routes.CARDS,
                    recurring = Routes.RECURRING,
                    categories = Routes.CATEGORIES,
                    reports = Routes.REPORTS,
                    members = Routes.MEMBERS,
                    createHousehold = Routes.CREATE_HOUSEHOLD,
                    apiServer = Routes.API_SERVER,
                ),
            )
        }
        composable(Routes.PROFILE) {
            ProfileSettingsScreen(sessionVm) { navController.popBackStack() }
        }
        composable(Routes.SECURITY) {
            SecuritySettingsScreen(sessionVm) { navController.popBackStack() }
        }
        composable(Routes.PRIVACY) {
            PrivacySettingsScreen(sessionVm, viewModeVm) { navController.popBackStack() }
        }
        composable(Routes.HOUSEHOLD) {
            HouseholdSettingsScreen(sessionVm) { navController.popBackStack() }
        }
        composable(Routes.APPEARANCE) {
            AppearanceSettingsScreen(sessionVm) { navController.popBackStack() }
        }
        composable(Routes.CREATE_HOUSEHOLD) {
            CreateHouseholdScreen(
                sessionVm = sessionVm,
                onBack = { navController.popBackStack() },
                onCreated = ::savedAndBack,
            )
        }
        composable(Routes.BUDGETS) {
            BudgetsScreen(sessionVm) { navController.popBackStack() }
        }
        composable(Routes.CARDS) {
            CardsScreen(sessionVm = sessionVm, onBack = { navController.popBackStack() })
        }
        composable(Routes.REIMBURSEMENTS) {
            ReimbursementsScreen(sessionVm) { navController.popBackStack() }
        }
        composable(Routes.RECURRING) {
            RecurringScreen(sessionVm) { navController.popBackStack() }
        }
        composable(Routes.REPORTS) {
            ReportsScreen(sessionVm) { navController.popBackStack() }
        }
        composable(Routes.MEMBERS) {
            MembersScreen(sessionVm, viewModeVm) { navController.popBackStack() }
        }
        composable(Routes.API_SERVER) {
            ApiServerScreen { navController.popBackStack() }
        }
    }
}
