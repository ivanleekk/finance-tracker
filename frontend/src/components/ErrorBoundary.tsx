import { useRouteError, isRouteErrorResponse, useNavigate } from "react-router";
import { Button } from "./ui/Button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./ui/Card";
import { AlertTriangle, RefreshCcw, Home } from "lucide-react";

export function ErrorBoundary() {
    const error = useRouteError();
    const navigate = useNavigate();

    let errorMessage = "An unexpected error occurred.";
    let errorStatus = "Error";

    if (isRouteErrorResponse(error)) {
        errorStatus = error.status.toString();
        errorMessage = error.data?.message || error.statusText || errorMessage;
    } else if (error instanceof Error) {
        errorMessage = error.message;
    } else if (typeof error === "string") {
        errorMessage = error;
    }

    return (
        <div className="flex min-h-[400px] w-full items-center justify-center p-6">
            <Card className="max-w-md w-full border-red-100 bg-red-50/30">
                <CardHeader className="text-center">
                    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
                        <AlertTriangle size={24} />
                    </div>
                    <CardTitle className="text-2xl font-bold text-red-900">
                        {errorStatus === "404" ? "Page Not Found" : "Something went wrong"}
                    </CardTitle>
                    <CardDescription className="text-red-700 mt-2 font-medium">
                        {errorMessage}
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
                        className="w-full text-red-700 hover:bg-red-100 hover:text-red-800"
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
