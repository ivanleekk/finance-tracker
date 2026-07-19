import { View, Text, StyleSheet, Pressable } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { CircleDollarSign, Target, Users, Settings as SettingsIcon, LogOut, ChevronRight } from "lucide-react-native";
import { useAuth } from "../lib/AuthContext";
import { colors, fonts } from "../theme/theme";
import type { RootStackParamList } from "../navigation/types";

export default function More() {
    const { logout, user } = useAuth();
    const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

    const items: { label: string; icon: React.ReactNode; onPress: () => void }[] = [
        { label: "Dividends", icon: <CircleDollarSign size={18} color={colors.textSecondary} />, onPress: () => navigation.navigate("Dividends") },
        { label: "Goals", icon: <Target size={18} color={colors.textSecondary} />, onPress: () => navigation.navigate("Goals") },
        { label: "Household", icon: <Users size={18} color={colors.textSecondary} />, onPress: () => navigation.navigate("Household") },
        { label: "Settings", icon: <SettingsIcon size={18} color={colors.textSecondary} />, onPress: () => navigation.navigate("Settings") },
    ];

    return (
        <View style={styles.container}>
            <View style={styles.profileRow}>
                <View style={styles.avatar}><Text style={styles.avatarText}>{user?.name?.[0]?.toUpperCase() || "?"}</Text></View>
                <View>
                    <Text style={styles.name}>{user?.name}</Text>
                    <Text style={styles.email}>{user?.email}</Text>
                </View>
            </View>

            {items.map(item => (
                <Pressable key={item.label} onPress={item.onPress} style={styles.row}>
                    {item.icon}
                    <Text style={styles.rowLabel}>{item.label}</Text>
                    <ChevronRight size={16} color={colors.textMuted} />
                </Pressable>
            ))}

            <Pressable onPress={logout} style={[styles.row, { marginTop: 20 }]}>
                <LogOut size={18} color={colors.danger} />
                <Text style={[styles.rowLabel, { color: colors.danger }]}>Log out</Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg, padding: 20 },
    profileRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 24 },
    avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.sky, alignItems: "center", justifyContent: "center" },
    avatarText: { color: "#fff", fontFamily: fonts.display, fontSize: 18 },
    name: { color: colors.textPrimary, fontFamily: fonts.bodySemibold, fontSize: 15 },
    email: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 12 },
    row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
    rowLabel: { flex: 1, color: colors.textPrimary, fontFamily: fonts.bodyMedium, fontSize: 14.5 },
});
