// Mirrors the color system from the Claude Design mockups (sky primary / fuchsia accent / mauve-dark canvas).
export const colors = {
    bg: "#0b0a10",
    surface: "#0d0c12",
    card: "#131019",
    cardNested: "#141019",
    inputBg: "#0e0d13",
    border: "#221f2b",
    borderSubtle: "#1c1925",
    borderInput: "#2a2733",
    chipNeutral: "#242130",
    dashedBorder: "#3a3646",

    textPrimary: "#f6f5f8",
    textSecondary: "#948da3",
    textMuted: "#6f6980",

    fuchsia: "#d946ef",
    fuchsiaLight: "#e879f9",
    fuchsiaDark: "#a21caf",
    sky: "#38bdf8",
    skyLight: "#7dd3fc",
    skyDark: "#0284c7",

    success: "#4ade80",
    warning: "#fbbf24",
    danger: "#f87171",

    sharedBg: "rgba(56,189,248,0.12)",
    sharedText: "#38bdf8",
    privateBg: "rgba(217,70,239,0.12)",
    privateText: "#e879f9",
};

export const gradients = {
    fuchsia: ["#d946ef", "#a21caf"] as const,
    sky: ["#38bdf8", "#0284c7"] as const,
};

export const fonts = {
    display: "PlusJakartaSans_800ExtraBold",
    displaySemibold: "PlusJakartaSans_700Bold",
    body: "Inter_400Regular",
    bodyMedium: "Inter_500Medium",
    bodySemibold: "Inter_600SemiBold",
    bodyBold: "Inter_700Bold",
    mono: "JetBrainsMono_500Medium",
    monoBold: "JetBrainsMono_700Bold",
};

export const radii = {
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    pill: 999,
};

export const spacing = (n: number) => n * 4;
