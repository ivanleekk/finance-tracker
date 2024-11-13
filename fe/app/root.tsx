import {
    isRouteErrorResponse,
    Links,
    Meta,
    Outlet,
    Scripts,
    ScrollRestoration,
    useRouteError,
} from "@remix-run/react";
import type { LinksFunction } from "@remix-run/node";

import styles from "./tailwind.css";
import { SidebarProvider } from "./components/ui/sidebar";
import { AppSidebar } from "./components/ui/app-sidebar";

export const links: LinksFunction = () => [
    { rel: "preconnect", href: "https://fonts.googleapis.com" },
    {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
    },
    { rel: "stylesheet", href: styles },
];

export function Layout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <head>
                <meta charSet="utf-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <Meta />
                <Links />
            </head>
            <body>
                {children}
                <ScrollRestoration />
                <Scripts />
            </body>
        </html>
    );
}

export default function App() {
    return (
        <Layout>
            <SidebarProvider>
                <AppSidebar />
                <main className="w-full p-2">
                    <Outlet />
                </main>
            </SidebarProvider>
        </Layout>
    );
}

export function ErrorBoundary() {
    const error = useRouteError();
    return (
        <Layout>
            <SidebarProvider>
                <AppSidebar />
                <main className="w-full">
                    <p>test</p>
                    <div className="text-center text-9xl">
                        {isRouteErrorResponse(error) ? error.status : "Unknown Error"}
                    </div>
                    <div className="text-center text-xl">
                        {isRouteErrorResponse(error) ? error.statusText : (error as Error).message}
                    </div>
                </main>
            </SidebarProvider>
        </Layout>
    );
}