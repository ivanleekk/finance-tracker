import { useRouteError, isRouteErrorResponse, useNavigate } from "react-router";
import { Button } from "./ui/Button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./ui/Card";
import { AlertTriangle, RefreshCcw, Home } from "lucide-react";

/**
 * What the reader is told. A thrown `Error` on the server is a failed fetch or a
 * loader that could not parse a response, and its message ("fetch failed") means
 * nothing to them — and React Router replaces it with "Unexpected Server Error" in
 * production anyway. What they can usefully know is that it is probably temporary.
 */
export function describeRouteError(error: unknown): { title: string; message: string } {
    if (isRouteErrorResponse(error) && error.status === 404) {
        return { title: "Page Not Found", message: "The page you are looking for does not exist." };
    }
    if (isRouteErrorResponse(error) && error.status < 500) {
        const detail = error.data?.message || error.statusText;
        return { title: "Something went wrong", message: detail || "The request could not be completed." };
    }
    return {
        title: "We couldn't load this page",
        message: "The server didn't respond in time. This is usually temporary — try again in a moment.",
    };
}

export function ErrorBoundary() {
    const error = useRouteError();
    const navigate = useNavigate();
    const { title, message } = describeRouteError(error);

    if (!isRouteErrorResponse(error)) console.error(error);

    return (
        <div className="flex min-h-[400px] w-full items-center justify-center p-6">
            <Card className="max-w-md w-full border-red-100 bg-red-50/30 dark:border-red-900/40 dark:bg-red-950/20">
                <CardHeader className="text-center">
                    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300">
                        <AlertTriangle size={24} />
                    </div>
                    <CardTitle className="text-2xl font-bold text-red-900 dark:text-red-100">
                        {title}
                    </CardTitle>
                    <CardDescription className="text-red-700 mt-2 font-medium dark:text-red-300">
                        {message}
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                    <Button
                        variant="primary"
                        className="w-full bg-red-600 hover:bg-red-700 text-white border-none"
                        onClick={() => window.location.reload()}
                    >
                        <RefreshCcw className="mr-2 h-4 w-4" />
                        Try Again
                    </Button>
                    <Button
                        variant="ghost"
                        className="w-full text-red-700 hover:bg-red-100 hover:text-red-800 dark:text-red-300 dark:hover:bg-red-900/30"
                        onClick={() => navigate("/")}
                    >
                        <Home className="mr-2 h-4 w-4" />
                        Go to Home
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}
