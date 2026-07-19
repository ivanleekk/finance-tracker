import { useState } from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import api from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { useHousehold } from "../lib/HouseholdContext";
import { colors, fonts } from "../theme/theme";
import { Card, Badge, Toggle, ScreenHeader } from "../components/ui";

export default function Settings() {
    const { user, refreshUser } = useAuth();
    const { activeHousehold } = useHousehold();
    const [hidePrivate, setHidePrivate] = useState(user?.hide_private_from_household ?? true);
    const [requireFaceId, setRequireFaceId] = useState(user?.require_face_id_for_vault ?? true);
    const [defaultPrivate, setDefaultPrivate] = useState(user?.default_new_items_private ?? true);

    const save = async (patch: Record<string, boolean>) => {
        try {
            await api.put("/users", patch);
            await refreshUser();
        } catch (e) {
            console.error("Failed to save setting", e);
        }
    };

    return (
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
            <ScreenHeader title="Settings" />
            <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 100 }}>
                <Card>
                    <Text style={styles.sectionTitle}>Profile</Text>
                    <View style={styles.row}><Text style={styles.label}>Name</Text><Text style={styles.value}>{user?.name}</Text></View>
                    <View style={styles.row}><Text style={styles.label}>Email</Text><Text style={styles.value}>{user?.email}</Text></View>
                    <View style={styles.row}><Text style={styles.label}>Base currency</Text><Badge label={activeHousehold?.base_currency || "—"} tone="private" /></View>
                </Card>

                <Card>
                    <Text style={styles.sectionTitle}>🔒 Private vault</Text>
                    <View style={styles.toggleRow}>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.label}>Hide private from household</Text>
                            <Text style={styles.sub}>Members never see these balances</Text>
                        </View>
                        <Toggle value={hidePrivate} onValueChange={(v) => { setHidePrivate(v); save({ hide_private_from_household: v }); }} />
                    </View>
                    <View style={styles.toggleRow}>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.label}>Require Face ID for vault</Text>
                            <Text style={styles.sub}>Extra unlock on private tab</Text>
                        </View>
                        <Toggle value={requireFaceId} onValueChange={(v) => { setRequireFaceId(v); save({ require_face_id_for_vault: v }); }} />
                    </View>
                    <View style={styles.toggleRow}>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.label}>Default new items to Private</Text>
                        </View>
                        <Toggle value={defaultPrivate} onValueChange={(v) => { setDefaultPrivate(v); save({ default_new_items_private: v }); }} />
                    </View>
                </Card>

                <Card>
                    <Text style={styles.sectionTitle}>Connections</Text>
                    <View style={styles.row}><Text style={styles.label}>DBS · SGFinDex</Text><Text style={styles.subValue}>● Not connected</Text></View>
                    <View style={styles.row}><Text style={styles.label}>IBKR · Flex API</Text><Text style={styles.subValue}>● Not connected</Text></View>
                </Card>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    sectionTitle: { color: colors.textPrimary, fontFamily: fonts.displaySemibold, fontSize: 14, marginBottom: 10 },
    row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 9, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
    toggleRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
    label: { color: colors.textPrimary, fontFamily: fonts.bodyMedium, fontSize: 13.5 },
    sub: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 11, marginTop: 2 },
    value: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 13 },
    subValue: { color: colors.textMuted, fontFamily: fonts.mono, fontSize: 11 },
});
