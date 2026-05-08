// App.tsx
import { createBrowserRouter, RouterProvider, Outlet, redirect } from "react-router";
import api from "./lib/api"; 
import { getSSRContext } from "./lib/ssr-helpers";
import type { LoaderFunctionArgs } from "react-router";
import './index.css'

// Components
import Sidebar from './components/sidebar.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'

// Pages
import LandingPage from './LandingPage.tsx'
import Dashboard from './pages/Dashboard/Dashboard.tsx';
import Trade from './pages/Trade/Trade.tsx';
import Portfolio from './pages/Portfolio/Portfolio.tsx';
import Transactions from './pages/Transactions/Transactions.tsx';
import Settings from './Settings.tsx';
import Profile from './Profile.tsx';
import Accounts from './pages/Accounts/Accounts.tsx';
import Households from './pages/Household/Households.tsx';
import Login from './pages/Login/Login.tsx';
import Signup from './pages/Signup/Signup.tsx';
import { householdsLoader } from "./pages/Household/households.loader.ts";
import { portfolioLoader } from "./pages/Portfolio/portfolio.loader.ts";
import { transactionsLoader } from "./pages/Transactions/transactions.loader.ts";

// --- 1. Define Loaders ---

// Protects private routes by checking the backend cookie
const requireAuthLoader = async ({ request }: LoaderFunctionArgs) => {
    const { ssrFetch } = await getSSRContext(request);
    try {
        await ssrFetch("/auth/me");
        return null; // Cookie is valid, proceed
    } catch {
        return redirect("/login"); // Invalid/missing cookie, force redirect
    }
};

// Prevents logged-in users from accessing the login/signup pages
const requireGuestLoader = async ({ request }: LoaderFunctionArgs) => {
    const { ssrFetch } = await getSSRContext(request);
    try {
        await ssrFetch("/auth/me");
        return redirect("/dashboard"); // Already logged in, send to dashboard
    } catch {
        return null; // Not logged in, allow access to login page
    }
};

// --- 2. Define the UI Layout ---

// This replaces your old App function return. 
// The <Outlet /> is where the child routes (Dashboard, Login, etc.) will render.
function RootLayout() {
    return (
        <div className="flex h-dvh overflow-hidden bg-base-50">
            <Sidebar />
            <main className="flex-1 overflow-y-auto">
                <Outlet />
            </main>
        </div>
    );
}

// --- 3. Create the Router ---

const router = createBrowserRouter([
    {
        element: <RootLayout />, // The Sidebar wraps everything
        errorElement: <ErrorBoundary />,
        children: [
            {
                errorElement: <ErrorBoundary />,
                children: [
                    // Public Routes
                    {
                        path: "/",
                        element: <LandingPage />,
                        loader: requireGuestLoader
                    },
                    {
                        path: "/login",
                        element: <Login />,
                        loader: requireGuestLoader
                    },
                    {
                        path: "/signup",
                        element: <Signup />,
                        loader: requireGuestLoader
                    },

                    // Protected Routes Group
                    {
                        loader: requireAuthLoader, // This single loader protects ALL children below
                        children: [
                            { path: "/dashboard", element: <Dashboard /> },
                            { path: "/accounts", element: <Accounts /> },
                            { path: "/trade", element: <Trade /> },
                            { loader: portfolioLoader, path: "/portfolio", element: <Portfolio /> },
                            { loader: transactionsLoader, path: "/transactions", element: <Transactions /> },
                            { path: "/households", loader: householdsLoader, element: <Households /> },
                            { path: "/settings", element: <Settings /> },
                            { path: "/profile", element: <Profile /> },
                        ]
                    },
                    // Catch-all route for 404s
                    {
                        path: "*",
                        loader: () => {
                            throw new Response("Not Found", { status: 404 });
                        }
                    }
                ]
            }
        ]
    }
]);

// --- 4. Export the App ---
export default function App() {
    return <RouterProvider router={router} />;
}