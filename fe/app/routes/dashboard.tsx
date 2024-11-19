import {LoaderFunctionArgs, MetaFunction, redirect} from "@remix-run/node";
import { SidebarProvider, SidebarTrigger } from "~/components/ui/sidebar";
import { AppSidebar } from "~/components/ui/app-sidebar";
import {getUserSession} from "~/utils/session.server";

export const meta: MetaFunction = () => {
    return [
        { title: "Finance Tracker" },
        { name: "Finance Tracker", content: "Finance Tracker" },
    ];
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const sessionUser = await getUserSession(request);
    if (!sessionUser) {
        return redirect("/login");
    }

    return null;
};

export default function Index({ children }: { children: React.ReactNode }) {
    return (
        <div className="text-center text-9xl">
            Hi i am
        </div>
    );
}
