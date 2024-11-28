import { Button } from "~/components/ui/button";
import { Link } from "@remix-run/react";
import { getUserSession } from "~/utils/session.server";
import { LoaderFunctionArgs, redirect } from "@vercel/remix";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const user = await getUserSession(request);

    if (user) {
        return redirect("/dashboard");
    }

    return null
}

export default function Home() {
    return (
        <div className="space-y-4">
            <h1 className="text-4xl font-bold">Welcome to your Personal Finance Manager</h1>
            <h2 className="text-2xl">Please login to continue</h2>
            <Link to="/login">
                <Button>Login</Button>
            </Link>
            <p className="text-xs mt-auto">Built by Ivan</p>

        </div>
    );
}