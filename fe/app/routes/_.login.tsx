import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form } from "@remix-run/react";
import { authenticator } from "~/services/auth.server";

export default function Screen() {
    return (
        <div className="h-screen w-full flex flex-col items-center justify-center bg-gray-100">
            <h1 className="text-2xl font-bold mb-6 text-center">Sign In</h1>
            <Form method="post" className="space-y-6">
                <div>
                    <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                        Email
                    </label>
                    <input
                        type="email"
                        name="email"
                        id="email"
                        required
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    />
                </div>
                <div>
                    <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                        Password
                    </label>
                    <input
                        type="password"
                        name="password"
                        id="password"
                        autoComplete="current-password"
                        required
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    />
                </div>
                <div>
                    <button
                        type="submit"
                        className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                    >
                        Sign In
                    </button>
                </div>
            </Form>
        </div>
    );
}

export async function action({ request }: ActionFunctionArgs) {
    return await authenticator.authenticate("user-pass", request, {
        successRedirect: "/dashboard",
        failureRedirect: "/login",
    });
}

export async function loader({ request }: LoaderFunctionArgs) {
    return await authenticator.isAuthenticated(request, {
        successRedirect: "/dashboard",
    });
}