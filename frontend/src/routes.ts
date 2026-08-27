import {
    type RouteConfig,
    route,
} from "@react-router/dev/routes";

export default [
    route("/", "LandingPage.tsx"),
    route("/login", "pages/Login/Login.tsx"),
    route("/signup", "pages/Signup/Signup.tsx"),
    route("/onboarding", "pages/Onboarding/Onboarding.tsx"),
    route("/logout", "pages/Logout/logout.ts"),
    route("/dashboard", "pages/Dashboard/Dashboard.tsx"),
    route("/accounts", "pages/Accounts/Accounts.tsx"),
    route("/accounts/loan-schedule/:accountId", "pages/Accounts/loanSchedule.resource.ts"),
    route("/trade", "pages/Trade/Trade.tsx"),
    route("/portfolio", "pages/Portfolio/Portfolio.tsx"),
    route("/dividends", "pages/Dividends/Dividends.tsx"),
    route("/transactions", "pages/Transactions/Transactions.tsx"),
    route("/budgets", "pages/Budgets/Budgets.tsx"),
    route("/reimbursements", "pages/Reimbursements/Reimbursements.tsx"),
    route("/recurring", "pages/Recurring/Recurring.tsx"),
    route("/goals", "pages/Goals/Goals.tsx"),
    route("/goals/:id", "pages/Goals/GoalDetail.tsx"),
    route("/households", "pages/Household/Households.tsx"),
    route("/settings", "pages/Settings/Settings.tsx"),
    route("/reports", "pages/Reports/Reports.tsx"),
    route("/profile", "pages/Profile/profile.redirect.ts"),
    route("*?", "catchall.tsx"),
] satisfies RouteConfig;
