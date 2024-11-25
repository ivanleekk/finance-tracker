import {Button} from "~/components/ui/button";
import {Link} from "@remix-run/react";

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