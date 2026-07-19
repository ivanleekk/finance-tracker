import { useEffect, useState, useCallback } from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import api from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { useHousehold } from "../lib/HouseholdContext";
import { useViewMode } from "../lib/ViewModeContext";
import { colors, fonts } from "../theme/theme";
import { HeroCard, StatTile, Card } from "../components/ui";
import type { AccountResponse, BalanceResponse, PortfolioSnapshotResponse, SubPortfolioResponse } from "../types/types";

function fmtMoney(n: number, currency: string) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}

export default function Dashboard() {
    const { user } = useAuth();
    const { activeHousehold } = useHousehold();
    const { hasHousehold } = useViewMode();
    const [accounts, setAccounts] = useState<AccountResponse[]>([]);
    const [balances, setBalances] = useState<BalanceResponse[]>([]);
    const [snapshots, setSnapshots] = useState<PortfolioSnapshotResponse[]>([]);
    const [goals, setGoals] = useState<SubPortfolioResponse[]>([]);
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async () => {
        if (!activeHousehold) return;
        const [accRes, balRes, snapRes, goalRes] = await Promise.all([
            api.get(`/accounts/household/${activeHousehold.id}`),
            api.get(`/accounts/balances/household/${activeHousehold.id}`),
            api.get(`/portfolio/snapshots/household/${activeHousehold.id}`),
            api.get(`/portfolio/subportfolios/household/${activeHousehold.id}`),
        ]);
        setAccounts(accRes.data);
        setBalances(balRes.data);
        setSnapshots(snapRes.data);
        setGoals(goalRes.data);
    }, [activeHousehold?.id]);

    useFocusEffect(useCallback(() => { load(); }, [load]));

    const onRefresh = async () => {
        setRefreshing(true);
        await load();
        setRefreshing(false);
    };

    if (!activeHousehold) {
        return (
            <View style={styles.center}>
                <Text style={styles.emptyText}>Set up a household to get started.</Text>
            </View>
        );
    }

    const currency = activeHousehold.base_currency;
    const latestByAccount = new Map<string, BalanceResponse>();
    balances.forEach(b => {
        const existing = latestByAccount.get(b.account_id);
        if (!existing || b.date > existing.date) latestByAccount.set(b.account_id, b);
    });
    const cashTotal = Array.from(latestByAccount.values()).reduce((sum, b) => sum + Number(b.balance_home_currency ?? b.balance), 0);

    const latestSnapDate = snapshots.reduce((max, s) => (s.date > max ? s.date : max), "");
    const portfolioTotal = snapshots.filter(s => s.date === latestSnapDate).reduce((sum, s) => sum + Number(s.current_value_home_currency), 0);
    const netWorth = cashTotal + portfolioTotal;

    return (
        <ScrollView
            style={styles.container}
            contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 100 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.fuchsiaLight} />}
        >
            <Text style={styles.greeting}>Hi {user?.name?.split(" ")[0] || "there"} 👋</Text>

            <HeroCard>
                <Text style={styles.heroLabel}>{hasHousehold ? "Net worth · Blended" : "Net worth"}</Text>
                <Text style={styles.heroValue}>{fmtMoney(netWorth, currency)}</Text>
                <Text style={styles.heroSub}>Liquid {fmtMoney(cashTotal, currency)} · Portfolio {fmtMoney(portfolioTotal, currency)}</Text>
            </HeroCard>

            <View style={styles.row}>
                <StatTile label="Accounts" value={String(accounts.length)} />
                <StatTile label="Goals" value={String(goals.length)} />
            </View>

            <Card>
                <Text style={styles.sectionTitle}>Goals</Text>
                {goals.length === 0 && <Text style={styles.emptyInline}>No goals set yet.</Text>}
                {goals.slice(0, 3).map(g => {
                    const spSnaps = snapshots.filter(s => s.sub_portfolio_id === g.id && s.date === latestSnapDate);
                    const current = spSnaps.reduce((sum, s) => sum + Number(s.current_value_home_currency), 0);
                    const pct = g.target_amount ? Math.min(100, Math.round((current / Number(g.target_amount)) * 100)) : 0;
                    return (
                        <View key={g.id} style={{ marginBottom: 12 }}>
                            <View style={styles.goalRow}>
                                <Text style={styles.goalName}>{g.name}</Text>
                                <Text style={styles.goalPct}>{pct}%</Text>
                            </View>
                            <View style={styles.progressTrack}>
                                <View style={[styles.progressFill, { width: `${pct}%` }]} />
                            </View>
                        </View>
                    );
                })}
            </Card>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg, padding: 24 },
    emptyText: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 14, textAlign: "center" },
    emptyInline: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 13, fontStyle: "italic" },
    greeting: { color: colors.textPrimary, fontFamily: fonts.display, fontSize: 20, marginTop: 4 },
    heroLabel: { color: colors.fuchsiaLight, fontFamily: fonts.mono, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 },
    heroValue: { color: colors.textPrimary, fontFamily: fonts.monoBold, fontSize: 30 },
    heroSub: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 12, marginTop: 6 },
    row: { flexDirection: "row", gap: 12 },
    sectionTitle: { color: colors.textPrimary, fontFamily: fonts.displaySemibold, fontSize: 14, marginBottom: 10 },
    goalRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
    goalName: { color: colors.textPrimary, fontFamily: fonts.bodyMedium, fontSize: 13 },
    goalPct: { color: colors.fuchsiaLight, fontFamily: fonts.mono, fontSize: 12, fontWeight: "700" },
    progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.chipNeutral, overflow: "hidden" },
    progressFill: { height: "100%", backgroundColor: colors.fuchsia },
});
