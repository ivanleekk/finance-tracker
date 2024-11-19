import { Form, Link, useLoaderData } from "@remix-run/react";
import {
    ArrowRightLeft,
    ChartCandlestick,
    FileChartColumn,
    Gauge,
    LucideLogIn,
    LucideLogOut,
    ReceiptText,
    Settings
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
    const isLoggedIn = useLoaderData();
    return (
        <Sidebar>
            <SidebarHeader>
                <Link to="/">
                    <p className="text-lg font-bold">
                        Finance Tracker
                    </p>
                </Link>
            </SidebarHeader>
            <SidebarContent>
                <SidebarGroup>
                    <SidebarMenuButton asChild>
                        <Link to="/">
                            <Gauge />
                            Dashboard
                        </Link>
                    </SidebarMenuButton>
                    <SidebarMenuButton asChild>
                        <Link to="/portfolio">
                            <ChartCandlestick />
                            Portfolio
                        </Link>
                    </SidebarMenuButton>
                    <SidebarMenuSub>
                        <SidebarMenuButton asChild>
                            <Link to="/portfolio/transactions">
                                <ReceiptText />
                                Transactions
                            </Link>
                        </SidebarMenuButton>
                        <SidebarMenuButton asChild>
                            <Link to="/portfolio/trade">
                                <ArrowRightLeft />
                                Trade
                            </Link>
                        </SidebarMenuButton>
                        <SidebarMenuButton asChild>
                            <Link to="/portfolio/statistics">
                                <FileChartColumn />
                                Statistics
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
                        <Link to="/login">
                            <LucideLogIn />
                            Login
                        </Link>
                    </SidebarMenuButton>
                )}
                <SidebarMenuButton asChild>
                    <Link to="/settings">
                        <Settings />
                        Settings
                    </Link>
                </SidebarMenuButton>
            </SidebarFooter>
        </Sidebar>
    );
}