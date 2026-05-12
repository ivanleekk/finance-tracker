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
import Sidebar from "./components/sidebar";
import { getSSRContext } from "./lib/ssr-helpers";
import { useState } from "react";
import { Menu, Wallet } from "lucide-react";
import { Link } from "react-router";
import type { HouseholdResponse, UserResponse } from "./types/types";

export async function loader({ request }: LoaderFunctionArgs) {
    const { ssrFetch, combineHeaders } = await getSSRContext(request);

    let isAuthenticated = false;
    let user: UserResponse | null = null;
    let households: HouseholdResponse[] = [];

    try {
        const res = await ssrFetch("/auth/me").catch(e => {
            if (e instanceof Response && e.status === 302) return null;
            throw e;
        });

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
            if (url.pathname !== "/households" && url.pathname !== "/logout" && url.pathname !== "/login" && url.pathname !== "/signup") {
                return redirect("/households?setup=true");
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

    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    return (
        <html lang="en" className="dark" style={{ colorScheme: "dark" }}>
            <head>
                <meta charSet="UTF-8" />
                <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>Finance-Tracker</title>
                <Meta />
                <Links />
            </head>
            <body>
                <AuthProvider initialIsAuthenticated={isAuthenticated} initialUser={user}>
                    <ThemeProvider>
                        <HouseholdProvider initialHouseholds={households}>
                            <div className="flex h-dvh overflow-hidden bg-base-100 text-base-900 dark:bg-base-950 dark:text-base-50 transition-colors duration-300">
                                <Sidebar isOpen={isSidebarOpen} setIsOpen={setIsSidebarOpen} />
                                <div className="flex flex-1 flex-col overflow-hidden">
                                    {/* Mobile Header */}
                                    <header className="md:hidden flex h-16 shrink-0 items-center justify-between border-b border-base-200 bg-white px-4 dark:border-base-800 dark:bg-base-950">
                                        <Link to="/" className="flex items-center gap-2 text-lg font-bold tracking-tight text-primary-600 dark:text-primary-500">
                                            <Wallet className="h-6 w-6" />
                                            FinTracker
                                        </Link>
                                        <button
                                            onClick={() => setIsSidebarOpen(true)}
                                            className="p-2 text-base-600 hover:bg-base-100 rounded-md dark:text-base-400 dark:hover:bg-base-900 min-h-[44px] min-w-[44px] flex items-center justify-center"
                                            aria-label="Open sidebar"
                                        >
                                            <Menu className="h-6 w-6" />
                                        </button>
                                    </header>

                                    <main className="flex-1 overflow-y-auto bg-base-50 dark:bg-base-900 transition-colors duration-300">
                                        {children}
                                    </main>
                                </div>
                            </div>
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
