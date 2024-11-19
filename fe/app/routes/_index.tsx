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
        <div className="text-center text-9xl">
            Hi i am
        </div>
    );
}
