import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { storage } from "./storage";
import api, { TOKEN_KEY, REFRESH_TOKEN_KEY } from "./api";
import type { UserResponse } from "../types/types";

interface AuthContextType {
    isAuthenticated: boolean;
    isLoading: boolean;
    user: UserResponse | null;
    login: (email: string, password: string) => Promise<void>;
    signup: (email: string, password: string, name: string) => Promise<void>;
    logout: () => Promise<void>;
    refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
    isAuthenticated: false,
    isLoading: true,
    user: null,
    login: async () => { },
    signup: async () => { },
    logout: async () => { },
    refreshUser: async () => { },
});

export const AuthProvider = ({ children }: { children: ReactNode }) => {
    const [user, setUser] = useState<UserResponse | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const refreshUser = async () => {
        try {
            const res = await api.get("/users");
            setUser(res.data);
        } catch {
            setUser(null);
        }
    };

    useEffect(() => {
        (async () => {
            const token = await storage.getItem(TOKEN_KEY);
            if (token) await refreshUser();
            setIsLoading(false);
        })();
    }, []);

    const login = async (email: string, password: string) => {
        const form = new URLSearchParams();
        form.append("username", email);
        form.append("password", password);
        const res = await api.post("/auth/token", form.toString(), {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });
        await storage.setItem(TOKEN_KEY, res.data.access_token);
        await storage.setItem(REFRESH_TOKEN_KEY, res.data.refresh_token);
        await refreshUser();
    };

    const signup = async (email: string, password: string, name: string) => {
        await api.post("/users", { email, password, name });
        await login(email, password);
    };

    const logout = async () => {
        await storage.removeItem(TOKEN_KEY);
        await storage.removeItem(REFRESH_TOKEN_KEY);
        setUser(null);
    };

    return (
        <AuthContext.Provider value={{ isAuthenticated: !!user, isLoading, user, login, signup, logout, refreshUser }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
