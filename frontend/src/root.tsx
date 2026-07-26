import {
    Links,
    Meta,
    Outlet,
    Scripts,
    ScrollRestoration,
    useLoaderData,
    data,
    redirect,
} from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { AuthProvider } from "./lib/AuthContext";
import { ThemeProvider } from "./lib/ThemeContext";
import { HouseholdProvider } from "./lib/HouseholdContext";
import { ViewModeProvider } from "./lib/ViewModeContext";
import { CommandBarProvider } from "./lib/CommandBarContext";
import Sidebar, { MobileNav } from "./components/sidebar";
import { CommandBar } from "./components/CommandBar/CommandBar";
import { QuickAddButton } from "./components/QuickAddButton";
import { getSSRContext } from "./lib/ssr-helpers";
import type { HouseholdResponse, UserResponse } from "./types/types";

// Default document title for every route. Routes that want their own (e.g. the
// landing page) export their own `meta`, which replaces this one.
export function meta() {
    return [{ title: "Waypoint" }];
}

export async function loader({ request }: LoaderFunctionArgs) {
    const { ssrFetch, combineHeaders } = await getSSRContext(request);

    let isAuthenticated = false;
    let user: UserResponse | null = null;
    let households: HouseholdResponse[] = [];

    try {
        const res = await ssrFetch("/auth/me", { skipRedirect: true });

        if (res && res.ok) {
            isAuthenticated = true;
            user = await res.json();
            const hRes = await ssrFetch("/users/households");
            if (hRes.ok) {
                households = await hRes.json();
            }
        }
        if (isAuthenticated && households.length === 0) {
            const url = new URL(request.url);
            if (!["/households", "/onboarding", "/logout", "/login", "/signup"].includes(url.pathname)) {
                return redirect("/onboarding");
            }
        }

        return data({ isAuthenticated, user, households }, {
            headers: combineHeaders()
        });
    } catch (e) {
        if (e instanceof Response) throw e;
        return data({ isAuthenticated: false, user: null, households: [] }, {
            headers: combineHeaders()
        });
    }
}

export function Layout({
    children,
}: {
    children: React.ReactNode;
}) {
    // Read the server-provided auth state
    const loaderData = useLoaderData<typeof loader>();
    const isAuthenticated = loaderData?.isAuthenticated || false;
    const user = loaderData?.user || null;
    const households = loaderData?.households;

    return (
        <html lang="en" className="dark" style={{ colorScheme: "dark" }}>
            <head>
                <meta charSet="UTF-8" />
                <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <link rel="preconnect" href="https://fonts.googleapis.com" />
                <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
                <link
                    href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700;800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
                    rel="stylesheet"
                />
                <Meta />
                <Links />
            </head>
            <body>
                <AuthProvider initialIsAuthenticated={isAuthenticated} initialUser={user}>
                    <ThemeProvider>
                        <HouseholdProvider initialHouseholds={households}>
                            <ViewModeProvider>
                                <CommandBarProvider>
                                    <div className="flex h-dvh overflow-hidden bg-base-100 text-base-900 dark:bg-base-950 dark:text-base-50 transition-colors duration-300 print:block print:h-auto print:overflow-visible print:bg-white">
                                        <Sidebar />
                                        {/* min-w-0 lets this column shrink below its content's intrinsic
                                            width — without it a wide table pushes the whole shell sideways. */}
                                        <div className="flex min-w-0 flex-1 flex-col print:block">
                                            <MobileNav />
                                            <main className="min-w-0 flex-1 overflow-y-auto bg-base-50 dark:bg-base-900 transition-colors duration-300 print:overflow-visible print:bg-white">
                                                {children}
                                            </main>
                                        </div>
                                    </div>
                                    <QuickAddButton />
                                    <CommandBar />
                                </CommandBarProvider>
                            </ViewModeProvider>
                        </HouseholdProvider>
                    </ThemeProvider>
                </AuthProvider>
                <ScrollRestoration />
                <Scripts />
            </body>
        </html>
    );
}

export default function Root() {
    return <Outlet />;
}
