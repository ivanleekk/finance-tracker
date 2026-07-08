import axios from "axios";
import { storage } from "./storage";

// Point this at your backend's LAN/tunnel URL when running on a physical device or simulator -
// localhost inside the Expo Go sandbox does not resolve to your dev machine.
const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:8000";

export const TOKEN_KEY = "access_token";
export const REFRESH_TOKEN_KEY = "refresh_token";

const api = axios.create({
    baseURL: API_URL,
    headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use(async (config) => {
    const token = await storage.getItem(TOKEN_KEY);
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
});

api.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;
        if (
            error.response?.status === 401 &&
            !originalRequest._retry &&
            !originalRequest.url?.includes("/auth/refresh") &&
            !originalRequest.url?.includes("/auth/token")
        ) {
            originalRequest._retry = true;
            try {
                const refreshToken = await storage.getItem(REFRESH_TOKEN_KEY);
                if (!refreshToken) throw error;
                const res = await axios.post(`${API_URL}/auth/refresh`, null, {
                    headers: { Authorization: `Bearer ${refreshToken}` },
                });
                await storage.setItem(TOKEN_KEY, res.data.access_token);
                originalRequest.headers.Authorization = `Bearer ${res.data.access_token}`;
                return api(originalRequest);
            } catch (refreshError) {
                await storage.removeItem(TOKEN_KEY);
                await storage.removeItem(REFRESH_TOKEN_KEY);
                return Promise.reject(refreshError);
            }
        }
        return Promise.reject(error);
    }
);

export default api;
