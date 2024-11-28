import {
    isRouteErrorResponse,
    Link,
    Links,
    LiveReload,
    Meta,
    Outlet,
    Scripts,
    ScrollRestoration, useLoaderData,
    useRouteError,
} from "@remix-run/react";
import { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@vercel/remix";
import styles from "./tailwind.css?url";
import sonnerStyles from "./sonner.css?url";
import { SidebarProvider, SidebarTrigger } from "./components/ui/sidebar";
import { AppSidebar } from "./components/app-sidebar";
import { getUserSession, signOut, themeSessionResolver } from "~/utils/session.server";
import { getToast } from "remix-toast";
import { useEffect } from "react";
import { Toaster, toast as notify } from "sonner";
import clsx from "clsx"
import { PreventFlashOnWrongTheme, Theme, ThemeProvider, useTheme } from "remix-themes"

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const sessionUser = await getUserSession(request);
    const { toast, headers } = await getToast(request);
    const { getTheme } = await themeSessionResolver(request)

    return json({ sessionUser, toast, theme: getTheme() }, { headers });
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

export function App({ children }: { children: React.ReactNode }) {
    const theme = useTheme();
    return (
        <html lang="en" className={clsx(theme)}>
            <head>
                <title>Finance Tracker</title>
                <meta charSet="utf-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <Meta />
                <PreventFlashOnWrongTheme ssrTheme={Boolean(theme)} />
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

export default function AppWithProviders() {
    const { theme, toast } = useLoaderData<typeof loader>();

    useEffect(() => {
        if (toast?.type === "error") {
            notify.error(toast.message);
        }
        else if (toast?.type === "success") {
            notify.success(toast.message);
        }
        else if (toast?.type === "warning") {
            notify.warning(toast.message);
        }
        else if (toast?.type === "info") {
            notify.info(toast.message);
        }
    }, [toast]);


    return (
        <ThemeProvider specifiedTheme={theme} themeAction="/api/set-theme">
            <App>
                <SidebarProvider>
                    <SidebarTrigger />
                    <AppSidebar />
                    <main className="w-full p-2">
                        <Outlet />
                    </main>
                    <Toaster richColors
                        closeButton
                    />
                </SidebarProvider>

            </App>


        </ThemeProvider>
    )
}