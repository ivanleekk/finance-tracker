import { Form, redirect, useActionData, useNavigation, Link } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import { Button } from "../../components/ui/Button";
import { getApiUrl } from "../../lib/api-url";

export async function action({ request }: ActionFunctionArgs) {
    const formData = await request.formData();
    const data = Object.fromEntries(formData);

    try {
        const response = await fetch(getApiUrl("/users"), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(data),
        });

        if (!response.ok) {
            const contentType = response.headers.get("content-type");
            if (contentType && contentType.includes("application/json")) {
                const errorData = await response.json();
                return { error: errorData.detail || "An error occurred during signup." };
            }
            return { error: `Server error (${response.status}). Please check backend logs.` };
        }

        // Signup itself doesn't create a session — log the new user in
        // so they land on onboarding already authenticated.
        const urlEncoded = new URLSearchParams();
        urlEncoded.append("username", data.email as string);
        urlEncoded.append("password", data.password as string);
        const loginResponse = await fetch(getApiUrl("/auth/token"), {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: urlEncoded,
        });

        if (!loginResponse.ok) {
            // Account exists but auto-login failed; let them log in manually.
            return redirect("/login");
        }

        // Forward every cookie (access + refresh) individually — merging them
        // into one header would make the browser drop the refresh token.
        const headers = new Headers();
        for (const cookie of loginResponse.headers.getSetCookie()) {
            headers.append("Set-Cookie", cookie);
        }

        return redirect("/dashboard", { headers });

    } catch (err) {
        console.error("Signup fetch failed:", err);
        return { error: "Failed to connect to the server." };
    }
}

export default function Signup() {
    const actionData = useActionData<typeof action>();
    const navigation = useNavigation();
    const isLoading = navigation.state === "submitting";

    return (
        <div className="flex items-center justify-center h-screen">
            <Form method="post" className="w-full max-w-sm bg-white dark:bg-base-900 p-8 rounded-lg shadow-md border border-base-200 dark:border-base-800">
                <h2 className="text-2xl font-bold mb-6 text-center text-base-900 dark:text-base-50">Sign up for Waypoint</h2>

                {actionData?.error && (
                    <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded text-sm">
                        {actionData.error}
                    </div>
                )}

                <div className="mb-4">
                    <label className="block text-base-700 dark:text-base-300 text-sm font-bold mb-2" htmlFor="name">
                        Username
                    </label>
                    <input
                        id="name"
                        name="name"
                        type="text"
                        required
                        className="w-full px-3 py-2 border border-base-200 dark:border-base-800 bg-white dark:bg-base-900 text-base-900 dark:text-base-50 rounded-lg focus:outline-none focus:ring focus:border-blue-300"
                    />
                </div>
                <div className="mb-4">
                    <label className="block text-base-700 dark:text-base-300 text-sm font-bold mb-2" htmlFor="email">
                        Email
                    </label>
                    <input
                        id="email"
                        name="email"
                        type="email"
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
                        name="password"
                        type="password"
                        required
                        className="w-full px-3 py-2 border border-base-200 dark:border-base-800 bg-white dark:bg-base-900 text-base-900 dark:text-base-50 rounded-lg focus:outline-none focus:ring focus:border-blue-300"
                    />
                </div>

                <div className="flex flex-col gap-4">
                    <Button
                        type="submit"
                        disabled={isLoading}
                        className="w-full"
                    >
                        {isLoading ? "Signing up..." : "Sign Up"}
                    </Button>

                    <p className="text-center text-sm text-base-500 dark:text-base-400">
                        Already have an account?{" "}
                        <Link to="/login" className="text-primary-600 dark:text-primary-400 hover:underline">
                            Log In
                        </Link>
                    </p>
                </div>
            </Form>
        </div>
    );
}
