import { Navigate, Outlet } from "react-router";
import { useAuth } from "./AuthContext";

const ProtectedRoute = () => {
    const { isAuthenticated, isLoading } = useAuth();

    if (isLoading) {
        return <div>Loading...</div>;
    }
    console.log("ProtectedRoute: isAuthenticated =", isAuthenticated);

    return isAuthenticated ? <Outlet /> : <Navigate to="/login" />;
};

export default ProtectedRoute;