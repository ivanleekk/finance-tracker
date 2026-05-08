import React, { createContext, useContext, useEffect, useState } from "react";
import { useAuth } from "./AuthContext";

type ThemeMode = "light" | "dark" | "system";

interface ThemeContextType {
    themeMode: ThemeMode;
    primaryColor: string;
    secondaryColor: string;
    baseColor: string;
    setThemeMode: (mode: ThemeMode) => void;
    setPrimaryColor: (color: string) => void;
    setSecondaryColor: (color: string) => void;
    setBaseColor: (color: string) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const THEME_PALETTES = {
    primary: ["sky", "indigo", "rose", "emerald", "blue"],
    secondary: ["fuchsia", "orange", "yellow"],
    base: ["mauve", "slate"]
};

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user } = useAuth();
    const [themeMode, setThemeMode] = useState<ThemeMode>(user?.theme_mode || "system");
    const [primaryColor, setPrimaryColor] = useState(user?.primary_color || "sky");
    const [secondaryColor, setSecondaryColor] = useState(user?.secondary_color || "fuchsia");
    const [baseColor, setBaseColor] = useState(user?.base_color || "mauve");

    // Sync with user object when it changes (e.g. after login or profile update)
    useEffect(() => {
        if (user) {
            setThemeMode(user.theme_mode);
            setPrimaryColor(user.primary_color);
            setSecondaryColor(user.secondary_color);
            setBaseColor(user.base_color);
        }
    }, [user]);

    // Apply colors to CSS variables
    useEffect(() => {
        const applyPalette = (type: "primary" | "secondary" | "base", colorName: string) => {
            const shades = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
            shades.forEach(shade => {
                document.documentElement.style.setProperty(
                    `--${type}-${shade}`,
                    `var(--color-${colorName}-${shade})`
                );
            });
        };

        applyPalette("primary", primaryColor);
        applyPalette("secondary", secondaryColor);
        applyPalette("base", baseColor);
    }, [primaryColor, secondaryColor, baseColor]);

    // Apply Dark Mode
    useEffect(() => {
        const root = window.document.documentElement;
        root.classList.remove("light", "dark");

        if (themeMode === "system") {
            const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
            root.classList.add(systemTheme);
        } else {
            root.classList.add(themeMode);
        }
    }, [themeMode]);

    // Handle System Theme Changes
    useEffect(() => {
        if (themeMode !== "system") return;

        const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
        const handleChange = () => {
            const root = window.document.documentElement;
            root.classList.remove("light", "dark");
            root.classList.add(mediaQuery.matches ? "dark" : "light");
        };

        mediaQuery.addEventListener("change", handleChange);
        return () => mediaQuery.removeEventListener("change", handleChange);
    }, [themeMode]);

    return (
        <ThemeContext.Provider value={{
            themeMode,
            primaryColor,
            secondaryColor,
            baseColor,
            setThemeMode,
            setPrimaryColor,
            setSecondaryColor,
            setBaseColor
        }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => {
    const context = useContext(ThemeContext);
    if (context === undefined) {
        throw new Error("useTheme must be used within a ThemeProvider");
    }
    return context;
};
