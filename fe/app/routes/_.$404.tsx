import type { MetaFunction } from "@remix-run/node";
import { SidebarProvider, SidebarTrigger } from "~/components/ui/sidebar";
import { AppSidebar } from "~/components/ui/app-sidebar";

export const meta: MetaFunction = () => {
    return [
        { title: "Finance Tracker" },
        { name: "Finance Tracker", content: "Finance Tracker" },
    ];
};

export default function Index({ children }: { children: React.ReactNode }) {
    return (
        <div>
            <h1>404 - Page Not Found</h1>
            <p>Sorry, there is nothing here.</p>
        </div>
    );
}
