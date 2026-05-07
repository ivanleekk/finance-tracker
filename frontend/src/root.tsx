import {
    Links,
    Meta,
    Outlet,
    Scripts,
    ScrollRestoration,
    useLoaderData,
    data,
} from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { AuthProvider } from "./lib/AuthContext";
import { HouseholdProvider } from "./lib/HouseholdContext";
import Sidebar from "./components/sidebar";
import { getSSRContext } from "./lib/ssr-helpers";
import type { HouseholdResponse } from "./types/types";

export async function loader({ request }: LoaderFunctionArgs) {
    const { ssrFetch, combineHeaders } = await getSSRContext(request);

    let isAuthenticated = false;
    let households: HouseholdResponse[] = [];

    try {
        // We use a manual fetch here instead of ssrFetch to avoid the auto-redirect to /login
        // because the root loader should handle both authenticated and unauthenticated states.
        const res = await ssrFetch("/auth/me").catch(e => {
            if (e instanceof Response && e.status === 302) return null; // Ignore redirect for root
            throw e;
        });

        if (res && res.ok) {
            isAuthenticated = true;
            const hRes = await ssrFetch("/users/households");
            if (hRes.ok) {
                households = await hRes.json();
            }
        }
        
        return data({ isAuthenticated, households }, {
            headers: combineHeaders()
        });
    } catch {
        return data({ isAuthenticated: false, households: [] }, {
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
    const households = loaderData?.households;

    return (
        <html lang="en">
            <head>
                <meta charSet="UTF-8" />
                <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>Finance-Tracker</title>
                <Meta />
                <Links />
            </head>
            <body>
                <AuthProvider initialIsAuthenticated={isAuthenticated}>
                    <HouseholdProvider initialHouseholds={households}>
                        <div className="flex h-dvh overflow-hidden bg-base-50">
                            <Sidebar />
                            <main className="flex-1 overflow-y-auto">
                                {children}
                            </main>
                        </div>
                    </HouseholdProvider>
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
