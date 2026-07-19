import { useState, useCallback, useMemo } from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ChevronLeft } from "lucide-react-native";
import api from "../lib/api";
import { useHousehold } from "../lib/HouseholdContext";
import { colors, fonts } from "../theme/theme";
import { Card, PrimaryButton } from "../components/ui";
import type { RootStackParamList } from "../navigation/types";
import type { PortfolioSnapshotResponse, SubPortfolioResponse } from "../types/types";

type Props = NativeStackScreenProps<RootStackParamList, "GoalDetail">;

function fmtMoney(n: number, currency: string) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}

export default function GoalDetail({ navigation, route }: Props) {
    const { id, name } = route.params;
    const { activeHousehold } = useHousehold();
    const [goal, setGoal] = useState<SubPortfolioResponse | null>(null);
    const [snapshots, setSnapshots] = useState<PortfolioSnapshotResponse[]>([]);
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async () => {
        if (!activeHousehold) return;
        const [goalRes, snapRes] = await Promise.all([
            api.get(`/portfolio/subportfolios/${id}`),
            api.get(`/portfolio/snapshots/household/${activeHousehold.id}`),
        ]);
        setGoal(goalRes.data);
        setSnapshots(snapRes.data);
    }, [activeHousehold?.id, id]);

    useFocusEffect(useCallback(() => { load(); }, [load]));
    const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

    const { current, pct, remaining } = useMemo(() => {
        const spSnaps = snapshots.filter(s => s.sub_portfolio_id === id);
        const latestDate = spSnaps.reduce((max, s) => (s.date > max ? s.date : max), "");
        const current = spSnaps.filter(s => s.date === latestDate).reduce((sum, s) => sum + Number(s.current_value_home_currency), 0);
        const target = goal?.target_amount ? Number(goal.target_amount) : 0;
        const pct = target ? Math.min(100, Math.round((current / target) * 100)) : 0;
        return { current, pct, remaining: Math.max(0, target - current) };
    }, [snapshots, goal, id]);

    if (!activeHousehold) return null;
    const currency = activeHousehold.base_currency;

    return (
        <ScrollView
            style={{ flex: 1, backgroundColor: colors.bg }}
            contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 120 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.fuchsiaLight} />}
        >
            <Pressable onPress={() => navigation.goBack()} style={styles.backRow}>
                <ChevronLeft size={18} color={colors.textSecondary} />
                <Text style={styles.backText}>Goals</Text>
            </Pressable>
            <Text style={styles.title}>{name}</Text>

            <Card>
                <Text style={styles.pctBig}>{pct}% funded</Text>
                <Text style={styles.amount}>{fmtMoney(current, currency)}</Text>
                <Text style={styles.amountMuted}>of {goal?.target_amount ? fmtMoney(Number(goal.target_amount), currency) : "—"}</Text>
                <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${pct}%` }]} />
                </View>
                <View style={styles.statRow}>
                    <View>
                        <Text style={styles.statLabel}>Remaining</Text>
                        <Text style={styles.statValue}>{fmtMoney(remaining, currency)}</Text>
                    </View>
                </View>
            </Card>

            <PrimaryButton label="+ Add funds" onPress={() => { }} />
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    backRow: { flexDirection: "row", alignItems: "center", gap: 2 },
    backText: { color: colors.textSecondary, fontFamily: fonts.bodyMedium, fontSize: 13 },
    title: { color: colors.textPrimary, fontFamily: fonts.display, fontSize: 20, marginTop: 2 },
    pctBig: { color: colors.fuchsiaLight, fontFamily: fonts.monoBold, fontSize: 24, textAlign: "center" },
    amount: { color: colors.textPrimary, fontFamily: fonts.monoBold, fontSize: 22, textAlign: "center", marginTop: 8 },
    amountMuted: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 12, textAlign: "center", marginBottom: 14 },
    progressTrack: { height: 8, borderRadius: 4, backgroundColor: colors.chipNeutral, overflow: "hidden", marginBottom: 16 },
    progressFill: { height: "100%", backgroundColor: colors.fuchsia },
    statRow: { flexDirection: "row", justifyContent: "center" },
    statLabel: { color: colors.textMuted, fontFamily: fonts.mono, fontSize: 10, textTransform: "uppercase", textAlign: "center" },
    statValue: { color: colors.textPrimary, fontFamily: fonts.bodySemibold, fontSize: 14, textAlign: "center", marginTop: 2 },
});
