import { Form, redirect, useActionData, useNavigation, useNavigate } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import { Button } from "../../components/ui/Button";
import { getApiUrl } from "../../lib/api-url";

// 1. THIS RUNS SECURELY ON YOUR NODE SERVER
export async function action({ request }: ActionFunctionArgs) {
    const formData = await request.formData();

    // FastAPI's OAuth2PasswordRequestForm requires URL-encoded data
    const urlEncoded = new URLSearchParams();
    urlEncoded.append("username", formData.get("username") as string);
    urlEncoded.append("password", formData.get("password") as string);

    try {
        const response = await fetch(getApiUrl("/auth/token"), {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: urlEncoded,
        });

        if (!response.ok) {
            // Check if the response is JSON before parsing
            const contentType = response.headers.get("content-type");
            if (contentType && contentType.includes("application/json")) {
                const errorData = await response.json();
                return { error: errorData.detail || "Invalid username or password." };
            }
            // Fallback for non-JSON errors (like 500 Internal Server Error)
            return { error: `Server error (${response.status}). Please check backend logs.` };
        }

        // CRITICAL: Grab the cookie the backend just set
        const setCookieHeader = response.headers.get("Set-Cookie");

        // Redirect to dashboard and forward the cookie to the browser
        return redirect("/dashboard", {
            headers: setCookieHeader ? { "Set-Cookie": setCookieHeader } : undefined,
        });

    } catch (err) {
        console.error("Login fetch failed:", err);
        return { error: "Failed to connect to the server." };
    }
}

// 2. THIS IS YOUR UI (RUNS IN BROWSER)
export default function Login() {
    const navigate = useNavigate();

    // Grab errors from the server action (replaces the error useState)
    const actionData = useActionData<typeof action>();

    // Track loading state automatically (replaces the isLoading useState)
    const navigation = useNavigation();
    const isLoading = navigation.state === "submitting";

    return (
        <div className="flex items-center justify-center h-screen">
            {/* Replace standard <form> with React Router's <Form> */}
            <Form method="post" className="w-full max-w-sm bg-white dark:bg-base-900 p-8 rounded-lg shadow-md border border-base-200 dark:border-base-800">
                <h2 className="text-2xl font-bold mb-6 text-center text-base-900 dark:text-base-50">Login to FinTracker</h2>

                {/* Error Display */}
                {actionData?.error && (
                    <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded text-sm">
                        {actionData.error}
                    </div>
                )}

                <div className="mb-4">
                    <label className="block text-base-700 dark:text-base-300 text-sm font-bold mb-2" htmlFor="username">
                        Username
                    </label>
                    <input
                        id="username"
                        name="username" // Required for FormData extraction
                        type="text"
                        required
                        className="w-full px-3 py-2 border border-base-200 dark:border-base-800 bg-white dark:bg-base-900 text-base-900 dark:text-base-50 rounded-lg focus:outline-none focus:ring focus:border-blue-300"
                    />
                </div>
                <div className="mb-6">
                    <label className="block text-base-700 dark:text-base-300 text-sm font-bold mb-2" htmlFor="password">
                        Password
                    </label>
                    <input
                        id="password"
                        name="password" // Required for FormData extraction
                        type="password"
                        required
                        className="w-full px-3 py-2 border border-base-200 dark:border-base-800 bg-white dark:bg-base-900 text-base-900 dark:text-base-50 rounded-lg focus:outline-none focus:ring focus:border-blue-300"
                    />
                </div>

                {/* Button Container */}
                <div className="grid grid-cols-2 items-center gap-4">
                    <Button
                        type="submit"
                        disabled={isLoading}
                        className="w-full"
                    >
                        {isLoading ? "Logging in..." : "Login"}
                    </Button>

                    <Button
                        type="button"
                        variant="ghost"
                        onClick={() => navigate("/signup")}
                        disabled={isLoading}
                        className="w-full"
                    >
                        Sign Up
                    </Button>
                </div>
            </Form>
        </div>
    );
}