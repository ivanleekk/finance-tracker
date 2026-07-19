import { useState, useCallback } from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import api from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { useHousehold } from "../lib/HouseholdContext";
import { useViewMode, isVisibleInViewMode } from "../lib/ViewModeContext";
import { colors, fonts } from "../theme/theme";
import { Card, ScreenHeader } from "../components/ui";
import type { RootStackParamList } from "../navigation/types";
import type { PortfolioSnapshotResponse, SubPortfolioResponse } from "../types/types";

type Props = NativeStackScreenProps<RootStackParamList, "Goals">;

function fmtMoney(n: number, currency: string) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}

export default function Goals({ navigation }: Props) {
    const { user } = useAuth();
    const { activeHousehold } = useHousehold();
    const { viewMode } = useViewMode();
    const [goals, setGoals] = useState<SubPortfolioResponse[]>([]);
    const [snapshots, setSnapshots] = useState<PortfolioSnapshotResponse[]>([]);
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async () => {
        if (!activeHousehold) return;
        const [goalRes, snapRes] = await Promise.all([
            api.get(`/portfolio/subportfolios/household/${activeHousehold.id}`),
            api.get(`/portfolio/snapshots/household/${activeHousehold.id}`),
        ]);
        setGoals(goalRes.data);
        setSnapshots(snapRes.data);
    }, [activeHousehold?.id]);

    useFocusEffect(useCallback(() => { load(); }, [load]));
    const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

    if (!activeHousehold) {
        return <View style={styles.center}><Text style={styles.emptyText}>Set up a household to get started.</Text></View>;
    }
    const currency = activeHousehold.base_currency;
    const visible = goals.filter(g => isVisibleInViewMode(g.owner_user_id, viewMode, user?.id));

    return (
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
            <ScreenHeader title="Goals" />
            <ScrollView
                contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 100 }}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.fuchsiaLight} />}
            >
                {visible.map(g => {
                    const spSnaps = snapshots.filter(s => s.sub_portfolio_id === g.id);
                    const latestDate = spSnaps.reduce((max, s) => (s.date > max ? s.date : max), "");
                    const current = spSnaps.filter(s => s.date === latestDate).reduce((sum, s) => sum + Number(s.current_value_home_currency), 0);
                    const pct = g.target_amount ? Math.min(100, Math.round((current / Number(g.target_amount)) * 100)) : 0;
                    return (
                        <Pressable key={g.id} onPress={() => navigation.navigate("GoalDetail", { id: g.id, name: g.name })}>
                            <Card>
                                <View style={styles.headerRow}>
                                    <Text style={styles.name}>{g.owner_user_id ? "🔒 " : ""}{g.name}</Text>
                                    <Text style={styles.pct}>{pct}%</Text>
                                </View>
                                <Text style={styles.amounts}>{fmtMoney(current, currency)} <Text style={styles.amountsMuted}>of {g.target_amount ? fmtMoney(Number(g.target_amount), currency) : "—"}</Text></Text>
                                <View style={styles.progressTrack}>
                                    <View style={[styles.progressFill, { width: `${pct}%` }]} />
                                </View>
                            </Card>
                        </Pressable>
                    );
                })}
                {visible.length === 0 && <Text style={styles.emptyInline}>No goals yet.</Text>}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg, padding: 24 },
    emptyText: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 14, textAlign: "center" },
    emptyInline: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 13, fontStyle: "italic", textAlign: "center", marginTop: 20 },
    headerRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
    name: { color: colors.textPrimary, fontFamily: fonts.displaySemibold, fontSize: 14 },
    pct: { color: colors.fuchsiaLight, fontFamily: fonts.mono, fontSize: 12, fontWeight: "700" },
    amounts: { color: colors.textPrimary, fontFamily: fonts.monoBold, fontSize: 15, marginBottom: 8 },
    amountsMuted: { color: colors.textMuted, fontFamily: fonts.mono, fontSize: 12, fontWeight: "400" },
    progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.chipNeutral, overflow: "hidden" },
    progressFill: { height: "100%", backgroundColor: colors.fuchsia },
});
