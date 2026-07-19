import { useState, useCallback } from "react";
import { View, Text, ScrollView, StyleSheet, TextInput, Pressable } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import api from "../lib/api";
import { useHousehold } from "../lib/HouseholdContext";
import { colors, fonts, radii } from "../theme/theme";
import { Card, HeroCard, Badge, PrimaryButton, ScreenHeader } from "../components/ui";
import type { HouseholdInviteResponse, HouseholdMemberUserResponse } from "../types/types";

export default function Household() {
    const { activeHousehold } = useHousehold();
    const [members, setMembers] = useState<HouseholdMemberUserResponse[]>([]);
    const [invites, setInvites] = useState<HouseholdInviteResponse[]>([]);
    const [inviteEmail, setInviteEmail] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const load = useCallback(async () => {
        if (!activeHousehold) return;
        const [memRes, invRes] = await Promise.all([
            api.get(`/users/householdmember/${activeHousehold.id}`),
            api.get(`/users/households/${activeHousehold.id}/invites`),
        ]);
        setMembers(memRes.data);
        setInvites(invRes.data);
    }, [activeHousehold?.id]);

    useFocusEffect(useCallback(() => { load(); }, [load]));

    const sendInvite = async () => {
        if (!activeHousehold || !inviteEmail) return;
        setSubmitting(true);
        try {
            await api.post(`/users/households/${activeHousehold.id}/invites`, { email: inviteEmail, role: "editor" });
            setInviteEmail("");
            await load();
        } catch (e) {
            console.error("Invite failed", e);
        } finally {
            setSubmitting(false);
        }
    };

    if (!activeHousehold) {
        return <View style={styles.center}><Text style={styles.emptyText}>Set up a household to get started.</Text></View>;
    }

    return (
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
            <ScreenHeader title="Household" />
            <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 100 }}>
                <HeroCard>
                    <Text style={styles.heroLabel}>{activeHousehold.name}</Text>
                    <Text style={styles.heroSub}>{members.length} member{members.length !== 1 ? "s" : ""}{invites.length > 0 ? ` · ${invites.length} invited` : ""}</Text>
                </HeroCard>

                <Card>
                    <Text style={styles.sectionTitle}>Members</Text>
                    {members.map(m => (
                        <View key={m.id} style={styles.memberRow}>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.memberName}>{m.name}</Text>
                                <Text style={styles.memberEmail}>{m.email}</Text>
                            </View>
                            <Badge label={m.role.toUpperCase()} tone={m.role === "owner" ? "private" : "shared"} />
                        </View>
                    ))}
                    {invites.map(inv => (
                        <View key={inv.id} style={styles.memberRow}>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.memberName}>{inv.email}</Text>
                                <Text style={styles.memberEmail}>Invited {new Date(inv.created_at).toLocaleDateString()}</Text>
                            </View>
                            <Badge label="PENDING" tone="warning" />
                        </View>
                    ))}
                </Card>

                <Card>
                    <Text style={styles.sectionTitle}>Invite member</Text>
                    <TextInput
                        style={styles.input}
                        placeholder="partner@example.com"
                        placeholderTextColor={colors.textMuted}
                        autoCapitalize="none"
                        keyboardType="email-address"
                        value={inviteEmail}
                        onChangeText={setInviteEmail}
                    />
                    <PrimaryButton label={submitting ? "Sending…" : "Send invite"} onPress={sendInvite} disabled={submitting || !inviteEmail} style={{ marginTop: 10 }} />
                </Card>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg, padding: 24 },
    emptyText: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 14, textAlign: "center" },
    heroLabel: { color: colors.textPrimary, fontFamily: fonts.display, fontSize: 18 },
    heroSub: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 12, marginTop: 4 },
    sectionTitle: { color: colors.textPrimary, fontFamily: fonts.displaySemibold, fontSize: 14, marginBottom: 10 },
    memberRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
    memberName: { color: colors.textPrimary, fontFamily: fonts.bodyMedium, fontSize: 13.5 },
    memberEmail: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 11, marginTop: 2 },
    input: {
        backgroundColor: colors.inputBg,
        borderWidth: 1,
        borderColor: colors.borderInput,
        borderRadius: radii.md,
        paddingHorizontal: 12,
        paddingVertical: 11,
        color: colors.textPrimary,
        fontFamily: fonts.body,
        fontSize: 13.5,
    },
});
