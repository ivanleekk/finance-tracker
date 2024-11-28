import { Form, Link, useLoaderData } from "@remix-run/react";
import {
    ArrowRightLeft,
    ChartCandlestick,
    FileChartColumn,
    Gauge,
    Landmark,
    LucideLogIn,
    LucideLogOut,
    ReceiptText,
    Settings,
    RotateCcw,
    History,
} from "lucide-react";
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarHeader,
    SidebarMenuButton,
    SidebarMenuSub,
    useSidebar,
} from "~/components/ui/sidebar";
import { loader } from "~/root";
import { ModeToggle } from "./mode-toggle";


export function AppSidebar() {
    const isLoggedIn = useLoaderData<typeof loader>().sessionUser ? true : false;
    // if user is on mobile, if link is clicked, close sidebar
    const {
        state,
        open,
        setOpen,
        openMobile,
        setOpenMobile,
        isMobile,
        toggleSidebar,
    } = useSidebar()

    return (
        <Sidebar className="w-fit">
            <SidebarHeader>
                <Link
                    to="/"
                    prefetch="intent"
                    onClick={() => setOpenMobile(false)}
                >
                    <p className="text-lg font-bold">
                        Finance Tracker
                    </p>
                </Link>
            </SidebarHeader>
            <SidebarContent>
                <SidebarGroup>
                    <SidebarMenuButton asChild>
                        <Link
                            to="/dashboard"
                            prefetch="intent"
                            onClick={() => setOpenMobile(false)}>
                            <Gauge />
                            Dashboard
                        </Link>
                    </SidebarMenuButton>
                    <SidebarMenuButton asChild>
                        <Link
                            to="/portfolio"
                            prefetch="intent"
                            onClick={() => setOpenMobile(false)}>
                            <ChartCandlestick />
                            Portfolio
                        </Link>
                    </SidebarMenuButton>
                    <SidebarMenuSub>
                        <SidebarMenuButton asChild>
                            <Link
                                to="/portfolio/transactions"
                                prefetch="intent"
                                onClick={() => setOpenMobile(false)}>
                                <ReceiptText />
                                Transactions
                            </Link>
                        </SidebarMenuButton>
                        <SidebarMenuButton asChild>
                            <Link
                                to="/portfolio/trade"
                                prefetch="intent"
                                onClick={() => setOpenMobile(false)}>
                                <ArrowRightLeft />
                                Trade
                            </Link>
                        </SidebarMenuButton>
                        <SidebarMenuButton asChild>
                            <Link
                                to="/portfolio/statistics"
                                prefetch="intent"
                                onClick={() => setOpenMobile(false)}>
                                <FileChartColumn />
                                Statistics
                            </Link>
                        </SidebarMenuButton>
                    </SidebarMenuSub>
                    <SidebarMenuButton asChild>
                        <Link
                            to="/bank"
                            prefetch="intent"
                            onClick={() => setOpenMobile(false)}>
                            <Landmark />
                            Bank
                        </Link>
                    </SidebarMenuButton>
                    <SidebarMenuSub>
                        <SidebarMenuButton asChild>
                            <Link
                                to="/bank/history"
                                prefetch="intent"
                                onClick={() => setOpenMobile(false)}>
                                <History />
                                History
                            </Link>
                        </SidebarMenuButton>
                        <SidebarMenuButton asChild>
                            <Link
                                to="/bank/update"
                                prefetch="intent"
                                onClick={() => setOpenMobile(false)}>
                                <RotateCcw />
                                Update
                            </Link>
                        </SidebarMenuButton>
                    </SidebarMenuSub>
                </SidebarGroup>
            </SidebarContent>
            <SidebarFooter>
                <ModeToggle />
                {isLoggedIn ? (
                    <Form method="post">
                        <SidebarMenuButton type="submit">
                            <LucideLogOut />
                            Logout
                        </SidebarMenuButton>
                    </Form>
                ) : (
                    <SidebarMenuButton asChild>
                        <Link
                            to="/login"
                            prefetch="intent"
                            onClick={() => setOpenMobile(false)}>
                            <LucideLogIn />
                            Login
                        </Link>
                    </SidebarMenuButton>
                )}
                <SidebarMenuButton asChild>
                    <Link
                        to="/settings"
                        prefetch="intent"
                        onClick={() => setOpenMobile(false)}>
                        <Settings />
                        Settings
                    </Link>
                </SidebarMenuButton>
            </SidebarFooter>
        </Sidebar>
    );
}