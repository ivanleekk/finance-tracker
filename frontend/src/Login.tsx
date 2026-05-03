import { useNavigate } from "react-router";
import { useState } from "react";
import api from "./lib/api";
import { Button } from "./components/ui/Button";

export default function Login() {
    const navigate = useNavigate();
    const [error, setError] = useState(null);
    const [isLoading, setIsLoading] = useState(false);

    const handleLogin = async (e) => {
        // 1. Prevent default form reload
        e.preventDefault();
        setIsLoading(true);
        setError(null);

        // 2. Extract data directly from the form elements
        const formData = new FormData(e.currentTarget);
        const data = Object.fromEntries(formData);

        try {
            // 3. Send the payload to your backend login endpoint
            await api.post("/auth/token", data, { headers: { "Content-Type": "application/x-www-form-urlencoded" } });

            // 4. On success, the HTTP-only cookie is now set. Route to dashboard.
            navigate("/dashboard");
        } catch (err) {
            console.error("Login failed:", err);
            // 5. Handle standard 401 Unauthorized errors
            setError(err.response?.data?.detail || "Invalid username or password.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex items-center justify-center h-screen">
            <form className="w-full max-w-sm bg-white p-8 rounded-lg shadow-md" onSubmit={handleLogin}>
                <h2 className="text-2xl font-bold mb-6 text-center">Login to FinTracker</h2>

                {/* Error Display */}
                {error && (
                    <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">
                        {error}
                    </div>
                )}

                <div className="mb-4">
                    <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="username">
                        Username
                    </label>
                    <input
                        id="username"
                        name="username" // Required for FormData
                        type="text"
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
                        name="password" // Required for FormData
                        type="password"
                        required
                        className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring focus:border-blue-300"
                    />
                </div>

                {/* Button Container */}
                <div className="flex justify-between items-center gap-4">
                    <Button
                        type="submit"
                        disabled={isLoading}
                        className="w-full"
                    >
                        {isLoading ? "Logging in..." : "Login"}
                    </Button>

                    <Button
                        type="button" // CRITICAL: prevents this button from submitting the form
                        variant="ghost"
                        onClick={() => navigate("/signup")}
                        disabled={isLoading}
                        className="w-full"
                    >
                        Sign Up
                    </Button>
                </div>
            </form>
        </div>
    );
}