import { Link, Form } from "react-router";
import {
    LayoutDashboard,
    ArrowRightLeft,
    PieChart,
    History,
    Wallet,
    Landmark,
    Users,
    LogOut,
    LogIn, // Added LogIn icon
    CircleDollarSign,
    Target,
    Settings,
    PiggyBank,
    Repeat,
} from "lucide-react";
import SidebarButton from "./sidebarButton";
import { useAuth } from "../lib/AuthContext";

function Sidebar() {
    // Pull the authentication state from your context
    const { isAuthenticated } = useAuth();

    return (
        <div className="flex h-screen w-64 flex-col border-r border-base-200 bg-white dark:border-base-800 dark:bg-base-950 print:hidden">
            <div className="flex h-16 items-center px-6 border-b border-base-100 dark:border-base-800">
                <Link to="/" className="flex items-center gap-2 text-xl font-bold tracking-tight text-primary-600 dark:text-primary-500">
                    <Wallet className="h-6 w-6" />
                    FinTracker
                </Link>
            </div>

            <div className="flex flex-1 flex-col justify-between overflow-y-auto px-4 py-6">
                <div className="flex flex-col gap-1">
                    <SidebarButton text="Dashboard" href="/dashboard" icon={<LayoutDashboard />} />
                    <SidebarButton text="Accounts" href="/accounts" icon={<Landmark />} />
                    <SidebarButton text="Portfolio" href="/portfolio" icon={<PieChart />} />
                    <SidebarButton text="Dividends" href="/dividends" icon={<CircleDollarSign />} />
                    <SidebarButton text="Transactions" href="/transactions" icon={<History />} />
                    <SidebarButton text="Budgets" href="/budgets" icon={<PiggyBank />} />
                    <SidebarButton text="Recurring" href="/recurring" icon={<Repeat />} />
                    <SidebarButton text="Trade" href="/trade" icon={<ArrowRightLeft />} />
                    <SidebarButton text="Goals" href="/goals" icon={<Target />} />
                    <SidebarButton text="Household" href="/households" icon={<Users />} />
                    <SidebarButton text="Settings" href="/settings" icon={<Settings />} />
                </div>

                <div className="flex flex-col gap-1">
                    {/* Conditionally render based on auth state */}
                    {isAuthenticated ? (
                        <>
                            <Form method="post" action="/logout">
                                <button type="submit" className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors text-base-600 hover:bg-base-100 hover:text-base-900 dark:text-base-400 dark:hover:bg-base-900 dark:hover:text-base-100">
                                    <LogOut className="h-4 w-4" />
                                    Logout
                                </button>
                            </Form>
                        </>
                    ) : (
                        <SidebarButton text="Login" href="/login" icon={<LogIn />} />
                    )}
                </div>
            </div>
        </div>
    );
}

export default Sidebar;