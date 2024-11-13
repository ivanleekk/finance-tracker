import type { MetaFunction } from "@remix-run/node";
import { SidebarProvider, SidebarTrigger } from "~/components/ui/sidebar";
import { AppSidebar } from "~/components/ui/app-sidebar";
import { isRouteErrorResponse, Outlet, useRouteError } from "@remix-run/react";

export const meta: MetaFunction = () => {
    return [
        { title: "Finance Tracker" },
        { name: "Finance Tracker", content: "Finance Tracker" },
    ];
};

export function ErrorBoundary() {
    const error = useRouteError();
    return (<SidebarProvider>
        <AppSidebar />
        <main className="w-full">
            {isRouteErrorResponse(error) ? (
                <div>
                    <h1>
                        {error.status} {error.statusText}
                    </h1>
                    <p>{error.data}</p>
                </div>
            ) : (
                <div>
                    <h1>Error</h1>
                    <p>{(error as Error).message}</p>
                    <p>The stack trace is:</p>
                    <pre>{(error as Error).stack}</pre>
                </div>
            )}
        </main>
    </SidebarProvider>
    );
}
export default function Index({ children }: { children: React.ReactNode }) {
    return (
        <SidebarProvider>
            <AppSidebar />
            <main className="w-full">
                <Outlet />
            </main>
        </SidebarProvider>
    );
}
