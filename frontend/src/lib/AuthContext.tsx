import { createContext, useState, useEffect, useContext, type ReactNode } from "react";
import api from '../lib/api';

interface AuthContextType {
    isAuthenticated: boolean;
    isLoading: boolean;
    setIsAuthenticated: (val: boolean) => void;
}

const AuthContext = createContext<AuthContextType>({
    isAuthenticated: false,
    isLoading: true,
    setIsAuthenticated: () => {},
});

export const AuthProvider = ({ 
    children, 
    initialIsAuthenticated = false 
}: { 
    children: ReactNode;
    initialIsAuthenticated?: boolean;
}) => {
    const [isAuthenticated, setIsAuthenticated] = useState(initialIsAuthenticated);
    const [isLoading, setIsLoading] = useState(false); // Can default to false now that SSR provides initial state

    // Keep client state in sync with server state (e.g. after logout action navigation)
    useEffect(() => {
        setIsAuthenticated(initialIsAuthenticated);
    }, [initialIsAuthenticated]);

    // We can optionally keep the client-side verifyAuth if needed for token refresh, 
    // but for SSR, initialIsAuthenticated handles the immediate render correctly.

    return (
        <AuthContext.Provider value={{ isAuthenticated, isLoading, setIsAuthenticated }}>
            {children}
        </AuthContext.Provider>
    );

}

export const useAuth = () => useContext(AuthContext);