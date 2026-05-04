import { Link, Form } from "react-router";
import {
    LayoutDashboard,
    ArrowRightLeft,
    PieChart,
    History,
    Settings,
    UserCircle,
    Wallet,
    Landmark,
    Users,
    LogOut,
    LogIn // Added LogIn icon
} from "lucide-react";
import SidebarButton from "./sidebarButton";
import { useAuth } from "../lib/AuthContext";
import { HouseholdSelector } from "./HouseholdSelector";
import { useNavigate } from "react-router";

function Sidebar() {
    // Pull the authentication state from your context
    const { isAuthenticated } = useAuth();
    const navigate = useNavigate();

    return (
        <div className="flex h-screen w-64 flex-col border-r border-base-200 bg-white">
            <div className="flex h-16 items-center px-6 border-b border-base-100">
                <Link to="/" className="flex items-center gap-2 text-xl font-bold tracking-tight text-primary-600">
                    <Wallet className="h-6 w-6" />
                    FinTracker
                </Link>
            </div>

            <div className="flex flex-1 flex-col justify-between overflow-y-auto px-4 py-6">
                <div className="flex flex-col gap-1">
                    {isAuthenticated && <HouseholdSelector />}
                    <SidebarButton text="Dashboard" href="/dashboard" icon={<LayoutDashboard />} />
                    <SidebarButton text="Accounts" href="/accounts" icon={<Landmark />} />
                    <SidebarButton text="Households" href="/households" icon={<Users />} />
                    <SidebarButton text="Trade" href="/trade" icon={<ArrowRightLeft />} />
                    <SidebarButton text="Portfolio" href="/portfolio" icon={<PieChart />} />
                    <SidebarButton text="History" href="/history" icon={<History />} />
                </div>

                <div className="flex flex-col gap-1">
                    {/* Conditionally render based on auth state */}
                    {isAuthenticated ? (
                        <>
                            <SidebarButton text="Settings" href="/settings" icon={<Settings />} />
                            <SidebarButton text="Profile" href="/profile" icon={<UserCircle />} />
                            <Form method="post" action="/logout">
                                <button type="submit" className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors text-base-600 hover:bg-base-100 hover:text-base-900">
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