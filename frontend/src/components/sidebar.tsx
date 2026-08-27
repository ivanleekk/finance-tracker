import { useEffect, useState } from "react";
import { Link, Form, useLocation } from "react-router";
import {
    LayoutDashboard,
    ArrowRightLeft,
    PieChart,
    History,
    Landmark,
    Users,
    LogOut,
    LogIn, // Added LogIn icon
    CircleDollarSign,
    Target,
    Settings,
    PiggyBank,
    Repeat,
    HandCoins,
    Menu,
    X,
} from "lucide-react";
import SidebarButton from "./sidebarButton";
import { BrandMark } from "./BrandMark";
import { useAuth } from "../lib/AuthContext";

const NAV_ITEMS = [
    { text: "Dashboard", href: "/dashboard", icon: <LayoutDashboard /> },
    { text: "Accounts", href: "/accounts", icon: <Landmark /> },
    { text: "Portfolio", href: "/portfolio", icon: <PieChart /> },
    { text: "Dividends", href: "/dividends", icon: <CircleDollarSign /> },
    { text: "Transactions", href: "/transactions", icon: <History /> },
    { text: "Budgets", href: "/budgets", icon: <PiggyBank /> },
    { text: "Shared", href: "/reimbursements", icon: <HandCoins /> },
    { text: "Recurring", href: "/recurring", icon: <Repeat /> },
    { text: "Trade", href: "/trade", icon: <ArrowRightLeft /> },
    { text: "Goals", href: "/goals", icon: <Target /> },
    { text: "Household", href: "/households", icon: <Users /> },
    { text: "Settings", href: "/settings", icon: <Settings /> },
];

function Wordmark({ className }: { className?: string }) {
    return (
        <Link
            to="/"
            className={
                "flex items-center gap-2 font-bold tracking-tight text-primary-600 dark:text-primary-500 " +
                (className ?? "")
            }
        >
            <BrandMark className="h-6 w-6" />
            Waypoint
        </Link>
    );
}

/** The link list + auth control, shared by the desktop rail and the mobile drawer. */
function NavContent() {
    const { isAuthenticated } = useAuth();

    return (
        <div className="flex flex-1 flex-col justify-between overflow-y-auto px-4 py-6">
            <div className="flex flex-col gap-1">
                {NAV_ITEMS.map((item) => (
                    <SidebarButton key={item.href} text={item.text} href={item.href} icon={item.icon} />
                ))}
            </div>

            <div className="flex flex-col gap-1">
                {/* Conditionally render based on auth state */}
                {isAuthenticated ? (
                    <Form method="post" action="/logout">
                        <button type="submit" className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors text-base-600 hover:bg-base-100 hover:text-base-900 dark:text-base-400 dark:hover:bg-base-900 dark:hover:text-base-100">
                            <LogOut className="h-4 w-4" />
                            Logout
                        </button>
                    </Form>
                ) : (
                    <SidebarButton text="Login" href="/login" icon={<LogIn />} />
                )}
            </div>
        </div>
    );
}

/** Persistent rail, md and up. Below md the same links live in MobileNav's drawer. */
function Sidebar() {
    return (
        <div className="hidden md:flex h-dvh w-64 flex-none flex-col border-r border-base-200 bg-white dark:border-base-800 dark:bg-base-950 print:hidden">
            <div className="flex h-16 flex-none items-center px-6 border-b border-base-100 dark:border-base-800">
                <Wordmark className="text-xl" />
            </div>
            <NavContent />
        </div>
    );
}

/**
 * Below md: a slim header with a hamburger, plus the off-canvas drawer it opens.
 * The drawer closes on navigation and on Escape.
 */
export function MobileNav() {
    const [open, setOpen] = useState(false);
    const { pathname } = useLocation();

    // Close after a link takes us somewhere — also covers back/forward.
    useEffect(() => {
        setOpen(false);
    }, [pathname]);

    useEffect(() => {
        if (!open) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") setOpen(false);
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [open]);

    return (
        <>
            <header className="flex h-14 flex-none items-center gap-3 border-b border-base-200 bg-white px-4 md:hidden dark:border-base-800 dark:bg-base-950 print:hidden">
                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    aria-label="Open navigation"
                    aria-expanded={open}
                    aria-controls="mobile-nav"
                    className="-ml-2 rounded-lg p-2 text-base-600 transition-colors hover:bg-base-100 hover:text-base-900 dark:text-base-400 dark:hover:bg-base-900 dark:hover:text-base-100"
                >
                    <Menu className="h-5 w-5" />
                </button>
                <Wordmark className="text-lg" />
            </header>

            {open && (
                <div className="fixed inset-0 z-50 md:hidden print:hidden">
                    <div
                        className="fixed inset-0 bg-base-900/50 backdrop-blur-sm animate-in fade-in duration-200"
                        onClick={() => setOpen(false)}
                    />
                    <div
                        id="mobile-nav"
                        role="dialog"
                        aria-modal="true"
                        aria-label="Navigation"
                        className="relative flex h-dvh w-72 max-w-[85vw] flex-col border-r border-base-200 bg-white shadow-2xl animate-in slide-in-from-left duration-200 dark:border-base-800 dark:bg-base-950"
                    >
                        <div className="flex h-14 flex-none items-center justify-between border-b border-base-100 px-4 dark:border-base-800">
                            <Wordmark className="text-lg" />
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                aria-label="Close navigation"
                                className="-mr-2 rounded-lg p-2 text-base-500 transition-colors hover:bg-base-100 hover:text-base-900 dark:text-base-400 dark:hover:bg-base-900 dark:hover:text-base-100"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <NavContent />
                    </div>
                </div>
            )}
        </>
    );
}

export default Sidebar;
