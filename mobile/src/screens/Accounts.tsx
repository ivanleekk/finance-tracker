import { useState, useCallback } from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import api from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { useHousehold } from "../lib/HouseholdContext";
import { useViewMode, isVisibleInViewMode } from "../lib/ViewModeContext";
import { colors, fonts } from "../theme/theme";
import { HeroCard, Card, ScreenHeader, Badge } from "../components/ui";
import type { AccountResponse, BalanceResponse } from "../types/types";

function fmtMoney(n: number, currency: string) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}

const LIQUIDITY_GROUPS: { key: string; label: string; liquidities: string[] }[] = [
    { key: "cash", label: "Cash & liquid", liquidities: ["liquid"] },
    { key: "invest", label: "Investments", liquidities: ["market_liquid"] },
    { key: "retirement", label: "Retirement", liquidities: ["time_locked", "retirement"] },
    { key: "property", label: "Property & physical assets", liquidities: ["illiquid"] },
];

export default function Accounts() {
    const { user } = useAuth();
    const { activeHousehold } = useHousehold();
    const { viewMode, hasHousehold } = useViewMode();
    const [accounts, setAccounts] = useState<AccountResponse[]>([]);
    const [balances, setBalances] = useState<BalanceResponse[]>([]);
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async () => {
        if (!activeHousehold) return;
        const [accRes, balRes] = await Promise.all([
            api.get(`/accounts/household/${activeHousehold.id}`),
            api.get(`/accounts/balances/household/${activeHousehold.id}`),
        ]);
        setAccounts(accRes.data);
        setBalances(balRes.data);
    }, [activeHousehold?.id]);

    useFocusEffect(useCallback(() => { load(); }, [load]));

    const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

    if (!activeHousehold) {
        return <View style={styles.center}><Text style={styles.emptyText}>Set up a household to get started.</Text></View>;
    }

    const currency = activeHousehold.base_currency;
    const visibleAccounts = accounts.filter(a => isVisibleInViewMode(a.owner_user_id, viewMode, user?.id));
    const latestByAccount = new Map<string, BalanceResponse>();
    balances.forEach(b => {
        const existing = latestByAccount.get(b.account_id);
        if (!existing || b.date > existing.date) latestByAccount.set(b.account_id, b);
    });
    const balanceOf = (id: string) => Number(latestByAccount.get(id)?.balance_home_currency ?? latestByAccount.get(id)?.balance ?? 0);
    const total = visibleAccounts.reduce((sum, a) => sum + balanceOf(a.id), 0);

    return (
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
            <ScreenHeader title="Accounts" right={hasHousehold ? <Badge label={viewMode.toUpperCase()} tone="shared" /> : undefined} />
            <ScrollView
                contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 100 }}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.fuchsiaLight} />}
            >
                <HeroCard>
                    <Text style={styles.heroLabel}>Total assets</Text>
                    <Text style={styles.heroValue}>{fmtMoney(total, currency)}</Text>
                </HeroCard>

                {LIQUIDITY_GROUPS.map(group => {
                    const groupAccounts = visibleAccounts.filter(a => group.liquidities.includes(a.liquidity));
                    if (groupAccounts.length === 0) return null;
                    const groupTotal = groupAccounts.reduce((sum, a) => sum + balanceOf(a.id), 0);
                    return (
                        <Card key={group.key}>
                            <View style={styles.groupHeader}>
                                <Text style={styles.groupTitle}>{group.label}</Text>
                                <Text style={styles.groupTotal}>{fmtMoney(groupTotal, currency)}</Text>
                            </View>
                            {groupAccounts.map(a => (
                                <View key={a.id} style={styles.accountRow}>
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.accountName}>{a.owner_user_id ? "🔒 " : ""}{a.name}</Text>
                                        <Text style={styles.accountSub}>
                                            {hasHousehold && viewMode === "blended" ? (a.owner_user_id ? "Private" : "Shared") : a.liquidity.replace("_", " ")} · {a.currency}
                                        </Text>
                                    </View>
                                    <Text style={styles.accountBalance}>{fmtMoney(balanceOf(a.id), currency)}</Text>
                                </View>
                            ))}
                        </Card>
                    );
                })}
                {visibleAccounts.length === 0 && <Text style={styles.emptyInline}>No accounts yet — use the + button to add one.</Text>}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg, padding: 24 },
    emptyText: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 14, textAlign: "center" },
    emptyInline: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 13, fontStyle: "italic", textAlign: "center", marginTop: 20 },
    heroLabel: { color: colors.fuchsiaLight, fontFamily: fonts.mono, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 },
    heroValue: { color: colors.textPrimary, fontFamily: fonts.monoBold, fontSize: 28 },
    groupHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
    groupTitle: { color: colors.textPrimary, fontFamily: fonts.displaySemibold, fontSize: 13 },
    groupTotal: { color: colors.textMuted, fontFamily: fonts.mono, fontSize: 11 },
    accountRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
    accountName: { color: colors.textPrimary, fontFamily: fonts.bodyMedium, fontSize: 13.5 },
    accountSub: { color: colors.textMuted, fontFamily: fonts.mono, fontSize: 10, marginTop: 2, textTransform: "uppercase" },
    accountBalance: { color: colors.textPrimary, fontFamily: fonts.monoBold, fontSize: 13.5 },
});
