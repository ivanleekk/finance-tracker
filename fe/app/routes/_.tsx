// app/routes/_layout.tsx (this file is responsible for layout and catching errors globally for all routes)
import { Outlet } from "@remix-run/react";
import Sidebar from "~/components/sidebar";

// Error boundary for the entire layout
export function ErrorBoundary({ error }: { error: Error }) {
    return (
        <div className="flex flex-row h-screen w-screen">
            <div className="w-64">
                <Sidebar />
            </div>
            <div className="flex w-full h-screen items-center justify-center">
                <div className="text-red-500 text-lg p-4">
                    <h2 className="font-bold">An error occurred:</h2>
                    <p>{error.message}</p>
                </div>
            </div>
        </div>
    );
}

// Layout for the index route
export default function Layout() {
    return (
        <div className="flex flex-row h-screen w-screen">
            <div className="w-64">
                <Sidebar />
            </div>
            <div className="flex w-full h-screen items-center justify-center">
                    <Outlet />
            </div>
        </div>
    );
}
