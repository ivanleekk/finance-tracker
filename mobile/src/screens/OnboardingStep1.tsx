import { useState } from "react";
import { View, Text, TextInput, StyleSheet, ScrollView, Pressable } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import api from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { useHousehold } from "../lib/HouseholdContext";
import { colors, fonts, radii } from "../theme/theme";
import { PrimaryButton, SecondaryButton, Toggle } from "../components/ui";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "OnboardingStep1">;

const CURRENCIES = ["USD", "SGD", "EUR", "GBP"];

export default function OnboardingStep1({ navigation }: Props) {
    const { user } = useAuth();
    const { refreshHouseholds } = useHousehold();
    const [currency, setCurrency] = useState("USD");
    const [cashSelected, setCashSelected] = useState(true);
    const [cashBalance, setCashBalance] = useState("");
    const [defaultPrivate, setDefaultPrivate] = useState(true);
    const [submitting, setSubmitting] = useState(false);

    const runSetup = async (skip: boolean) => {
        setSubmitting(true);
        try {
            const name = user?.name ? `${user.name}'s finances` : "My finances";
            const hh = await api.post("/users/households", { name, base_currency: currency, country_code: "US" });
            await api.put("/users", { default_new_items_private: defaultPrivate });
            if (!skip && cashSelected) {
                const acc = await api.post("/accounts", {
                    household_id: hh.data.id,
                    name: "Cash account",
                    liquidity: "liquid",
                    tax_status: "taxable",
                    currency,
                    owner_user_id: defaultPrivate ? user?.id : null,
                });
                await api.post("/accounts/balances", {
                    account_id: acc.data.id,
                    date: new Date().toISOString().split("T")[0],
                    balance: parseFloat(cashBalance) || 0,
                });
            }
            await refreshHouseholds();
            navigation.replace("OnboardingStep2", { householdId: hh.data.id, suggestedName: name });
        } catch (e) {
            console.error("Onboarding setup failed", e);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <View style={styles.container}>
            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 100 }}>
                <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: "50%" }]} />
                </View>
                <Text style={styles.step}>STEP 1 / 2</Text>
                <Text style={styles.title}>Set up in 30 seconds</Text>
                <Text style={styles.subtitle}>Everything here has a smart default — change only what you want.</Text>

                <Text style={styles.label}>Base currency</Text>
                <View style={styles.chipRow}>
                    {CURRENCIES.map(c => (
                        <Pressable key={c} onPress={() => setCurrency(c)} style={[styles.chip, currency === c && styles.chipActive]}>
                            <Text style={[styles.chipText, currency === c && styles.chipTextActive]}>{c}</Text>
                        </Pressable>
                    ))}
                </View>

                <Text style={styles.label}>Add your first account</Text>
                <Pressable onPress={() => setCashSelected(v => !v)} style={[styles.presetCard, cashSelected && styles.presetCardActive]}>
                    <Text style={styles.presetTitle}>💰 Cash account</Text>
                    {cashSelected && (
                        <TextInput
                            style={styles.presetInput}
                            placeholder="0.00"
                            placeholderTextColor={colors.textMuted}
                            keyboardType="decimal-pad"
                            value={cashBalance}
                            onChangeText={setCashBalance}
                        />
                    )}
                </Pressable>

                <View style={styles.toggleRow}>
                    <Text style={styles.toggleLabel}>New entries are private by default</Text>
                    <Toggle value={defaultPrivate} onValueChange={setDefaultPrivate} />
                </View>
            </ScrollView>

            <View style={styles.footer}>
                <SecondaryButton label="Skip" onPress={() => runSetup(true)} style={{ flex: 1 }} />
                <PrimaryButton label={submitting ? "Setting up…" : "Continue"} onPress={() => runSetup(false)} disabled={submitting} style={{ flex: 1 }} />
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
    subtitle: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 13, marginBottom: 20 },
    label: { color: colors.textPrimary, fontFamily: fonts.bodySemibold, fontSize: 13.5, marginBottom: 10 },
    chipRow: { flexDirection: "row", gap: 8, marginBottom: 24, flexWrap: "wrap" },
    chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.md, borderWidth: 1, borderColor: colors.borderInput },
    chipActive: { backgroundColor: colors.fuchsia, borderColor: colors.fuchsia },
    chipText: { color: colors.textSecondary, fontFamily: fonts.bodySemibold, fontSize: 13 },
    chipTextActive: { color: "#fff" },
    presetCard: { borderWidth: 1, borderStyle: "dashed", borderColor: colors.dashedBorder, borderRadius: radii.md, padding: 14, marginBottom: 20 },
    presetCardActive: { borderStyle: "solid", borderColor: colors.fuchsiaDark, backgroundColor: "rgba(217,70,239,0.06)" },
    presetTitle: { color: colors.textPrimary, fontFamily: fonts.bodyMedium, fontSize: 14 },
    presetInput: { marginTop: 10, color: colors.textPrimary, fontFamily: fonts.body, fontSize: 14, borderBottomWidth: 1, borderBottomColor: colors.fuchsiaDark, paddingVertical: 4 },
    toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: 14 },
    toggleLabel: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 13, flex: 1, marginRight: 12 },
    footer: { flexDirection: "row", gap: 10, padding: 20, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg },
});
