import type { MetaFunction } from "@remix-run/node";
import Sidebar from "~/components/sidebar";
import { Outlet } from "@remix-run/react";

export default function Index() {
    return (
        <div className="flex flex-row h-full w-full">
            <div className="mx-auto my-auto">
                <h1 className="text-3xl text-center">Welcome to Finance Tracker by Ivan</h1>

            </div>
        </div>

    );
}