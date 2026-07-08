import { View, Text, Pressable, StyleSheet, type ViewStyle, type StyleProp } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors, fonts, radii } from "../theme/theme";

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
    return <View style={[styles.card, style]}>{children}</View>;
}

export function HeroCard({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
    return (
        <LinearGradient colors={["#241528", "#141019"]} style={[styles.card, styles.hero, style]}>
            {children}
        </LinearGradient>
    );
}

export function Badge({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "shared" | "private" | "success" | "warning" | "danger" }) {
    const toneStyles: Record<string, { bg: string; text: string }> = {
        neutral: { bg: colors.chipNeutral, text: colors.textSecondary },
        shared: { bg: colors.sharedBg, text: colors.sharedText },
        private: { bg: colors.privateBg, text: colors.privateText },
        success: { bg: "rgba(74,222,128,0.12)", text: colors.success },
        warning: { bg: "rgba(251,191,36,0.12)", text: colors.warning },
        danger: { bg: "rgba(248,113,113,0.12)", text: colors.danger },
    };
    const t = toneStyles[tone];
    return (
        <View style={[styles.badge, { backgroundColor: t.bg }]}>
            <Text style={[styles.badgeText, { color: t.text }]}>{label}</Text>
        </View>
    );
}

export function StatTile({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
    return (
        <View style={[styles.card, styles.statTile]}>
            <Text style={styles.statLabel}>{label}</Text>
            <Text style={[styles.statValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
        </View>
    );
}

export function PrimaryButton({ label, onPress, disabled, style }: { label: string; onPress: () => void; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
    return (
        <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [{ opacity: pressed || disabled ? 0.7 : 1 }, style]}>
            <LinearGradient colors={["#d946ef", "#a21caf"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.ctaButton}>
                <Text style={styles.ctaButtonText}>{label}</Text>
            </LinearGradient>
        </Pressable>
    );
}

export function SecondaryButton({ label, onPress, style }: { label: string; onPress: () => void; style?: StyleProp<ViewStyle> }) {
    return (
        <Pressable onPress={onPress} style={[styles.secondaryButton, style]}>
            <Text style={styles.secondaryButtonText}>{label}</Text>
        </Pressable>
    );
}

export function ScreenHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
    return (
        <View style={styles.screenHeader}>
            <View style={{ flex: 1 }}>
                <Text style={styles.screenTitle}>{title}</Text>
                {subtitle ? <Text style={styles.screenSubtitle}>{subtitle}</Text> : null}
            </View>
            {right}
        </View>
    );
}

export function Toggle({ value, onValueChange }: { value: boolean; onValueChange: (v: boolean) => void }) {
    return (
        <Pressable
            onPress={() => onValueChange(!value)}
            style={[styles.toggleTrack, { backgroundColor: value ? colors.sky : colors.borderInput }]}
        >
            <View style={[styles.toggleThumb, { transform: [{ translateX: value ? 16 : 2 }] }]} />
        </Pressable>
    );
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: colors.card,
        borderRadius: radii.lg,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 16,
    },
    hero: {
        borderColor: "#2e2438",
    },
    badge: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: radii.pill,
        alignSelf: "flex-start",
    },
    badgeText: {
        fontSize: 10,
        fontFamily: fonts.mono,
        fontWeight: "700",
        textTransform: "uppercase",
        letterSpacing: 0.4,
    },
    statTile: {
        flex: 1,
        padding: 14,
        gap: 6,
    },
    statLabel: {
        color: colors.textMuted,
        fontFamily: fonts.mono,
        fontSize: 9.5,
        textTransform: "uppercase",
        letterSpacing: 0.5,
    },
    statValue: {
        color: colors.textPrimary,
        fontFamily: fonts.monoBold,
        fontSize: 19,
    },
    ctaButton: {
        borderRadius: radii.md,
        paddingVertical: 13,
        alignItems: "center",
        justifyContent: "center",
    },
    ctaButtonText: {
        color: "#fff",
        fontFamily: fonts.bodyBold,
        fontSize: 14,
    },
    secondaryButton: {
        borderRadius: radii.md,
        paddingVertical: 13,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        borderColor: colors.borderInput,
    },
    secondaryButtonText: {
        color: colors.textSecondary,
        fontFamily: fonts.bodySemibold,
        fontSize: 14,
    },
    screenHeader: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 20,
        paddingTop: 8,
        paddingBottom: 16,
        gap: 12,
    },
    screenTitle: {
        color: colors.textPrimary,
        fontFamily: fonts.display,
        fontSize: 22,
    },
    screenSubtitle: {
        color: colors.textSecondary,
        fontFamily: fonts.body,
        fontSize: 12.5,
        marginTop: 2,
    },
    toggleTrack: {
        width: 36,
        height: 20,
        borderRadius: 10,
        justifyContent: "center",
    },
    toggleThumb: {
        width: 16,
        height: 16,
        borderRadius: 8,
        backgroundColor: "#fff",
    },
});
