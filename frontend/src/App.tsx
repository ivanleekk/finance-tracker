// App.tsx
import { createBrowserRouter, RouterProvider, Outlet, redirect } from "react-router";
import api from "./lib/api"; // Adjust this path if your axios instance is located elsewhere
import './index.css'

// Components
import Sidebar from './components/sidebar.tsx'

// Pages
import LandingPage from './LandingPage.tsx'
import Dashboard from './Dashboard.tsx';
import Trade from './Trade.tsx';
import Portfolio from './Portfolio.tsx';
import History from './History.tsx';
import Settings from './Settings.tsx';
import Profile from './Profile.tsx';
import Accounts from './Accounts.tsx';
import Households from './Households.tsx';
import Login from './Login.tsx';
import Signup from './Signup.tsx';

// --- 1. Define Loaders ---

// Protects private routes by checking the backend cookie
const requireAuthLoader = async () => {
    try {
        await api.get("/auth/me");
        return null; // Cookie is valid, proceed
    } catch {
        return redirect("/login"); // Invalid/missing cookie, force redirect
    }
};

// Prevents logged-in users from accessing the login/signup pages
const requireGuestLoader = async () => {
    try {
        await api.get("/auth/me");
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
                    { path: "/portfolio", element: <Portfolio /> },
                    { path: "/history", element: <History /> },
                    { path: "/households", element: <Households /> },
                    { path: "/settings", element: <Settings /> },
                    { path: "/profile", element: <Profile /> },
                ]
            }
        ]
    }
]);

// --- 4. Export the App ---
export default function App() {
    return <RouterProvider router={router} />;
}