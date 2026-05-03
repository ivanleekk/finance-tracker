import { useNavigate } from "react-router";
import api from "./lib/api";
import { useState } from "react";

export default function Signup() {
    const navigate = useNavigate();
    // Optional: Add state to handle backend error messages
    const [error, setError] = useState(null);
    const [isLoading, setIsLoading] = useState(false);

    const handleSignup = async (e: any) => {
        // 1. Prevent the default browser form submission (which reloads the page)
        e.preventDefault();
        setIsLoading(true);
        setError(null);

        // 2. Extract data directly from the form elements
        const formData = new FormData(e.currentTarget);
        const data = Object.fromEntries(formData);

        try {
            // 3. Send the extracted data payload to your backend
            // The data object will look like: { name: "...", email: "...", password: "..." }
            const response = await api.post("/users", data);

            // 4. If successful, navigate to the dashboard
            console.log("Signup successful:", response.data);
            navigate("/dashboard");

        } catch (err: any) {
            // 5. Handle errors (e.g., 400 Bad Request if the email already exists)
            console.error("Signup failed:", err);
            setError(err.response?.data?.detail || "An error occurred during signup.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex items-center justify-center h-screen">
            <form className="w-full max-w-sm bg-white p-8 rounded-lg shadow-md" onSubmit={handleSignup}>
                <h2 className="text-2xl font-bold mb-6 text-center">Sign Up for FinTracker</h2>
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
                <button
                    type="submit"
                    className="w-full bg-primary-600 text-white py-2 px-4 rounded-lg hover:bg-primary-700 transition-colors"
                >
                    Sign Up
                </button>
            </form>
        </div>
    );
}