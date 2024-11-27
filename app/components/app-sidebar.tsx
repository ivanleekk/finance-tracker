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
} from "~/components/ui/sidebar";

export function AppSidebar() {
    const isLoggedIn = useLoaderData().sessionUser;
    return (
        <Sidebar className="w-fit">
            <SidebarHeader>
                <Link to="/" prefetch="intent">
                    <p className="text-lg font-bold">
                        Finance Tracker
                    </p>
                </Link>
            </SidebarHeader>
            <SidebarContent>
                <SidebarGroup>
                    <SidebarMenuButton asChild>
                        <Link to="/dashboard" prefetch="intent">
                            <Gauge />
                            Dashboard
                        </Link>
                    </SidebarMenuButton>
                    <SidebarMenuButton asChild>
                        <Link to="/portfolio" prefetch="intent">
                            <ChartCandlestick />
                            Portfolio
                        </Link>
                    </SidebarMenuButton>
                    <SidebarMenuSub>
                        <SidebarMenuButton asChild>
                            <Link to="/portfolio/transactions" prefetch="intent">
                                <ReceiptText />
                                Transactions
                            </Link>
                        </SidebarMenuButton>
                        <SidebarMenuButton asChild>
                            <Link to="/portfolio/trade" prefetch="intent">
                                <ArrowRightLeft />
                                Trade
                            </Link>
                        </SidebarMenuButton>
                        <SidebarMenuButton asChild>
                            <Link to="/portfolio/statistics" prefetch="intent">
                                <FileChartColumn />
                                Statistics
                            </Link>
                        </SidebarMenuButton>
                    </SidebarMenuSub>
                    <SidebarMenuButton asChild>
                        <Link to="/bank" prefetch="intent">
                            <Landmark />
                            Bank
                        </Link>
                    </SidebarMenuButton>
                    <SidebarMenuSub>
                        <SidebarMenuButton asChild>
                            <Link to="/bank/history" prefetch="intent">
                                <History />
                                History
                            </Link>
                        </SidebarMenuButton>
                        <SidebarMenuButton asChild>
                            <Link to="/bank/update" prefetch="intent">
                                <RotateCcw />
                                Update
                            </Link>
                        </SidebarMenuButton>
                    </SidebarMenuSub>
                </SidebarGroup>
            </SidebarContent>
            <SidebarFooter>
                {isLoggedIn ? (
                    <Form method="post">
                        <SidebarMenuButton type="submit">
                            <LucideLogOut />
                            Logout
                        </SidebarMenuButton>
                    </Form>
                ) : (
                    <SidebarMenuButton asChild>
                        <Link to="/login" prefetch="intent">
                            <LucideLogIn />
                            Login
                        </Link>
                    </SidebarMenuButton>
                )}
                <SidebarMenuButton asChild>
                    <Link to="/settings" prefetch="intent">
                        <Settings />
                        Settings
                    </Link>
                </SidebarMenuButton>
            </SidebarFooter>
        </Sidebar>
    );
}