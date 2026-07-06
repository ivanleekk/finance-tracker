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

const ThemeContext = createContext<ThemeContextType>({
    themeMode: "system",
    primaryColor: "sky",
    secondaryColor: "fuchsia",
    baseColor: "mauve",
    setThemeMode: () => console.warn("setThemeMode called outside of ThemeProvider"),
    setPrimaryColor: () => console.warn("setPrimaryColor called outside of ThemeProvider"),
    setSecondaryColor: () => console.warn("setSecondaryColor called outside of ThemeProvider"),
    setBaseColor: () => console.warn("setBaseColor called outside of ThemeProvider"),
});

export const THEME_PALETTES = {
    primary: ["sky", "indigo", "rose", "emerald", "blue"],
    secondary: ["fuchsia", "orange", "yellow"],
    base: ["mauve", "slate"]
};

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const auth = useAuth();
    const user = auth?.user;

    const [themeMode] = useState<ThemeMode>("dark");
    const [primaryColor, setPrimaryColor] = useState(user?.primary_color || "sky");
    const [secondaryColor, setSecondaryColor] = useState(user?.secondary_color || "fuchsia");
    const [baseColor, setBaseColor] = useState(user?.base_color || "mauve");

    // Sync with user object when it changes (e.g. after login or profile update)
    useEffect(() => {
        if (user) {
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

    // Always ensure Dark Mode is applied
    useEffect(() => {
        const root = window.document.documentElement;
        root.classList.remove("light");
        root.classList.add("dark");
        root.style.colorScheme = "dark";
    }, []);

    return (
        <ThemeContext.Provider value={{
            themeMode: "dark",
            primaryColor,
            secondaryColor,
            baseColor,
            setThemeMode: () => { }, // No-op
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
    // Note: We provide a default context now, so this will only trigger if 
    // the hook is called in a way that truly bypasses the context.
    return context;
};
