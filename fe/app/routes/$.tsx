import { Outlet } from "@remix-run/react";

export default function Index({ children }: { children: React.ReactNode }) {
    return (
        <div>
            <h1 className="text-lg text-red-500">404 - Not Found</h1>
        </div>
    );
}