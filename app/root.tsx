import {
    isRouteErrorResponse,
    Links,
    Meta,
    Outlet,
    Scripts,
    ScrollRestoration, useLoaderData,
    useRouteError,
} from "@remix-run/react";
import { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs, json } from "@remix-run/node";

import styles from "./tailwind.css?url";
import sonnerStyles from "./sonner.css?url";
import { SidebarProvider } from "./components/ui/sidebar";
import { AppSidebar } from "./components/app-sidebar";
import { getUserSession, signOut } from "~/utils/session.server";
import { getToast } from "remix-toast";
import { useEffect } from "react";
import { Toaster, toast as notify } from "sonner";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const sessionUser = await getUserSession(request);
    const { toast, headers } = await getToast(request);
    return json({ sessionUser, toast }, { headers });
};

export const action = async ({ request }: ActionFunctionArgs) => {
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
    { rel: 'stylesheet', href: sonnerStyles },
];

export function Layout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <head>
                <title>Finance Tracker</title>
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
    const { toast } = useLoaderData<typeof loader>();

    useEffect(() => {
        if (toast?.type === "error") {
            notify.error(toast.message);
        }
        if (toast?.type === "success") {
            notify.success(toast.message);
        }
    }, [toast]);
    return (
        <Layout>
            <SidebarProvider>
                <AppSidebar />
                <main className="w-full p-2">
                    <Outlet />
                </main>
                <Toaster position="top-center" />

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