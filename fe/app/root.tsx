import {
    isRouteErrorResponse,
    Links,
    Meta,
    Outlet,
    Scripts,
    ScrollRestoration,
    useRouteError,
} from "@remix-run/react";
import {ActionFunctionArgs, LinksFunction, LoaderFunctionArgs} from "@remix-run/node";

import styles from "./tailwind.css?url";
import { SidebarProvider } from "./components/ui/sidebar";
import { AppSidebar } from "./components/app-sidebar";
import { json } from "@remix-run/node";
import {getUserSession, signOut} from "~/utils/session.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const sessionUser = await getUserSession(request);
    return json({ isLoggedIn: !!sessionUser });
};

export let action = async ({ request }: ActionFunctionArgs) => {
    return signOut(request);
}

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