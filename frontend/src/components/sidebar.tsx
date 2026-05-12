import { Link, Form } from "react-router";
import {
    LayoutDashboard,
    ArrowRightLeft,
    PieChart,
    History,
    UserCircle,
    Wallet,
    Landmark,
    Users,
    LogOut,
    LogIn,
    X // Added Close icon
} from "lucide-react";
import SidebarButton from "./sidebarButton";
import { useAuth } from "../lib/AuthContext";
import { HouseholdSelector } from "./HouseholdSelector";

interface SidebarProps {
    isOpen: boolean;
    setIsOpen: (isOpen: boolean) => void;
}

function Sidebar({ isOpen, setIsOpen }: SidebarProps) {
    // Pull the authentication state from your context
    const { isAuthenticated } = useAuth();

    const handleClose = () => setIsOpen(false);

    return (
        <>
            {/* Backdrop for mobile */}
            {isOpen && (
                <div
                    className="fixed inset-0 z-40 bg-base-900/50 md:hidden backdrop-blur-sm"
                    onClick={handleClose}
                />
            )}

            {/* Sidebar */}
            <div className={`fixed inset-y-0 left-0 z-50 w-64 transform flex-col border-r border-base-200 bg-white transition-transform duration-300 dark:border-base-800 dark:bg-base-950 md:relative md:translate-x-0 flex ${isOpen ? "translate-x-0" : "-translate-x-full"}`}>
                <div className="flex h-16 items-center justify-between px-6 border-b border-base-100 dark:border-base-800">
                    <Link to="/" onClick={handleClose} className="flex items-center gap-2 text-xl font-bold tracking-tight text-primary-600 dark:text-primary-500">
                        <Wallet className="h-6 w-6" />
                        FinTracker
                    </Link>
                    <button
                        className="md:hidden text-base-500 hover:text-base-900 dark:text-base-400 dark:hover:text-base-50 min-h-[44px] min-w-[44px] flex items-center justify-center -mr-2"
                        onClick={handleClose}
                        aria-label="Close sidebar"
                    >
                        <X className="h-6 w-6" />
                    </button>
                </div>

                <div className="flex flex-1 flex-col justify-between overflow-y-auto px-4 py-6">
                    <div className="flex flex-col gap-1">
                        {isAuthenticated && <HouseholdSelector />}
                        <SidebarButton text="Dashboard" href="/dashboard" icon={<LayoutDashboard />} onClick={handleClose} />
                        <SidebarButton text="Accounts" href="/accounts" icon={<Landmark />} onClick={handleClose} />
                        <SidebarButton text="Households" href="/households" icon={<Users />} onClick={handleClose} />
                        <SidebarButton text="Trade" href="/trade" icon={<ArrowRightLeft />} onClick={handleClose} />
                        <SidebarButton text="Portfolio" href="/portfolio" icon={<PieChart />} onClick={handleClose} />
                        <SidebarButton text="Transactions" href="/transactions" icon={<History />} onClick={handleClose} />
                    </div>

                    <div className="flex flex-col gap-1 mt-4">
                        {/* Conditionally render based on auth state */}
                        {isAuthenticated ? (
                            <>
                                <SidebarButton text="Profile" href="/profile" icon={<UserCircle />} onClick={handleClose} />
                                <Form method="post" action="/logout" onSubmit={handleClose}>
                                    <button type="submit" className="flex w-full min-h-[44px] items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors text-base-600 hover:bg-base-100 hover:text-base-900 dark:text-base-400 dark:hover:bg-base-900 dark:hover:text-base-100">
                                        <LogOut className="h-5 w-5 md:h-4 md:w-4" />
                                        Logout
                                    </button>
                                </Form>
                            </>
                        ) : (
                            <SidebarButton text="Login" href="/login" icon={<LogIn />} onClick={handleClose} />
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}

export default Sidebar;