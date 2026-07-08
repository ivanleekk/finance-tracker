import { useState } from "react";
import { View, Text, TextInput, StyleSheet } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import api from "../lib/api";
import { useHousehold } from "../lib/HouseholdContext";
import { colors, fonts, radii } from "../theme/theme";
import { PrimaryButton, SecondaryButton } from "../components/ui";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "OnboardingStep2">;

export default function OnboardingStep2({ navigation, route }: Props) {
    const { householdId, suggestedName } = route.params || { householdId: "", suggestedName: "My finances" };
    const { refreshHouseholds } = useHousehold();
    const [name, setName] = useState(suggestedName);
    const [inviteEmail, setInviteEmail] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const finish = async (skip: boolean) => {
        setSubmitting(true);
        try {
            if (!skip) {
                if (name && name !== suggestedName) {
                    await api.put(`/users/households/${householdId}`, { name });
                }
                if (inviteEmail) {
                    await api.post(`/users/households/${householdId}/invites`, { email: inviteEmail, role: "editor" });
                }
            }
            await refreshHouseholds();
            navigation.reset({ index: 0, routes: [{ name: "Main" }] });
        } catch (e) {
            console.error("Household finish failed", e);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <View style={styles.container}>
            <View style={{ padding: 20, flex: 1 }}>
                <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: "100%" }]} />
                </View>
                <Text style={styles.step}>STEP 2 / 2</Text>
                <Text style={styles.title}>Share with a household?</Text>
                <Text style={styles.subtitle}>
                    Optional. Track shared money with a partner or family, kept separate from your private accounts. You can always do this later.
                </Text>

                <Text style={styles.label}>Household name</Text>
                <TextInput style={styles.input} value={name} onChangeText={setName} />

                <Text style={styles.label}>Invite by email (optional)</Text>
                <TextInput
                    style={styles.input}
                    placeholder="partner@example.com"
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    value={inviteEmail}
                    onChangeText={setInviteEmail}
                />
            </View>

            <View style={styles.footer}>
                <PrimaryButton label={submitting ? "Finishing…" : "Create & finish"} onPress={() => finish(false)} disabled={submitting} />
                <SecondaryButton label="Skip for now" onPress={() => finish(true)} style={{ borderWidth: 0 }} />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.card, overflow: "hidden", marginBottom: 12 },
    progressFill: { height: "100%", backgroundColor: colors.fuchsiaLight },
    step: { color: colors.textMuted, fontFamily: fonts.mono, fontSize: 10, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 },
    title: { color: colors.textPrimary, fontFamily: fonts.display, fontSize: 22, marginBottom: 4 },
    subtitle: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 13, marginBottom: 24, lineHeight: 19 },
    label: { color: colors.textPrimary, fontFamily: fonts.bodySemibold, fontSize: 13.5, marginBottom: 8, marginTop: 4 },
    input: {
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.borderInput,
        borderRadius: radii.md,
        paddingHorizontal: 14,
        paddingVertical: 12,
        color: colors.textPrimary,
        fontFamily: fonts.body,
        fontSize: 14,
        marginBottom: 18,
    },
    footer: { gap: 10, padding: 20, borderTopWidth: 1, borderTopColor: colors.border },
});
