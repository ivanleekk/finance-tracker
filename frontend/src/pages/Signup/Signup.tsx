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
            const errorData = await response.json();
            return { error: errorData.detail || "An error occurred during signup." };
        }

        // After signup, we might want to log the user in automatically
        // or just redirect to login page. The current implementation 
        // in Signup.tsx redirected to dashboard, but that requires 
        // a session which we don't have yet (unless the backend returns one).
        
        // If backend returns a Set-Cookie on signup, we should forward it.
        const setCookieHeader = response.headers.get("Set-Cookie");
        
        return redirect("/dashboard", {
            headers: setCookieHeader ? { "Set-Cookie": setCookieHeader } : undefined,
        });

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
            <Form method="post" className="w-full max-w-sm bg-white p-8 rounded-lg shadow-md">
                <h2 className="text-2xl font-bold mb-6 text-center">Sign Up for FinTracker</h2>

                {actionData?.error && (
                    <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">
                        {actionData.error}
                    </div>
                )}

                <div className="mb-4">
                    <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="name">
                        Username
                    </label>
                    <input
                        id="name"
                        name="name"
                        type="text"
                        required
                        className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring focus:border-blue-300"
                    />
                </div>
                <div className="mb-4">
                    <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="email">
                        Email
                    </label>
                    <input
                        id="email"
                        name="email"
                        type="email"
                        required
                        className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring focus:border-blue-300"
                    />
                </div>
                <div className="mb-6">
                    <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="password">
                        Password
                    </label>
                    <input
                        id="password"
                        name="password"
                        type="password"
                        required
                        className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring focus:border-blue-300"
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
                    
                    <p className="text-center text-sm text-base-500">
                        Already have an account?{" "}
                        <Link to="/login" className="text-primary-600 hover:underline">
                            Log In
                        </Link>
                    </p>
                </div>
            </Form>
        </div>
    );
}
