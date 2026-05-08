import { createContext, useState, useEffect, useContext, type ReactNode } from "react";
import api from '../lib/api';

import type { UserResponse } from "../types/types";

interface AuthContextType {
    isAuthenticated: boolean;
    user: UserResponse | null;
    isLoading: boolean;
    setIsAuthenticated: (val: boolean) => void;
    setUser: (user: UserResponse | null) => void;
}

const AuthContext = createContext<AuthContextType>({
    isAuthenticated: false,
    user: null,
    isLoading: true,
    setIsAuthenticated: () => { },
    setUser: () => { },
});

export const AuthProvider = ({
    children,
    initialIsAuthenticated = false,
    initialUser = null
}: {
    children: ReactNode;
    initialIsAuthenticated?: boolean;
    initialUser?: UserResponse | null;
}) => {
    const [isAuthenticated, setIsAuthenticated] = useState(initialIsAuthenticated);
    const [user, setUser] = useState<UserResponse | null>(initialUser);
    const [isLoading, setIsLoading] = useState(false);

    // Keep client state in sync with server state
    useEffect(() => {
        setIsAuthenticated(initialIsAuthenticated);
        setUser(initialUser);
    }, [initialIsAuthenticated, initialUser]);

    return (
        <AuthContext.Provider value={{ isAuthenticated, user, isLoading, setIsAuthenticated, setUser }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);