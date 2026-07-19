import { useState, useCallback, useMemo } from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import api from "../lib/api";
import { useHousehold } from "../lib/HouseholdContext";
import { colors, fonts } from "../theme/theme";
import { Card, StatTile, ScreenHeader } from "../components/ui";
import type { AssetResponse, DividendResponse } from "../types/types";

function fmtMoney(n: number, currency: string) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}

export default function Dividends() {
    const { activeHousehold } = useHousehold();
    const [dividends, setDividends] = useState<DividendResponse[]>([]);
    const [assets, setAssets] = useState<AssetResponse[]>([]);
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async () => {
        if (!activeHousehold) return;
        const [dvRes, asRes] = await Promise.all([
            api.get(`/portfolio/dividends/household/${activeHousehold.id}`),
            api.get(`/portfolio/assets`),
        ]);
        setDividends(dvRes.data);
        setAssets(asRes.data);
    }, [activeHousehold?.id]);

    useFocusEffect(useCallback(() => { load(); }, [load]));
    const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

    const assetById = useMemo(() => new Map(assets.map(a => [a.id, a])), [assets]);

    const { receivedThisYear, trailing12mo, upcoming } = useMemo(() => {
        const now = new Date();
        const yearStart = new Date(now.getFullYear(), 0, 1);
        const trailingStart = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        let receivedThisYear = 0, trailing12mo = 0;
        const byAsset = new Map<string, DividendResponse[]>();
        dividends.forEach(d => {
            const date = new Date(d.date);
            const amt = Number(d.amount_home_currency ?? d.amount);
            if (date >= yearStart) receivedThisYear += amt;
            if (date >= trailingStart) trailing12mo += amt;
            const list = byAsset.get(d.asset_id) || [];
            list.push(d);
            byAsset.set(d.asset_id, list);
        });
        const upcoming: { ticker: string; date: Date; amount: number }[] = [];
        byAsset.forEach((divs, assetId) => {
            const sorted = [...divs].sort((a, b) => (a.date < b.date ? 1 : -1));
            if (sorted.length === 0) return;
            const last = sorted[0];
            const cadence = sorted.length >= 2 ? (new Date(sorted[0].date).getTime() - new Date(sorted[1].date).getTime()) : 91 * 24 * 60 * 60 * 1000;
            const next = new Date(new Date(last.date).getTime() + cadence);
            if (next >= now) upcoming.push({ ticker: assetById.get(assetId)?.ticker || "—", date: next, amount: Number(last.amount_home_currency ?? last.amount) });
        });
        upcoming.sort((a, b) => a.date.getTime() - b.date.getTime());
        return { receivedThisYear, trailing12mo, upcoming };
    }, [dividends, assetById]);

    if (!activeHousehold) {
        return <View style={styles.center}><Text style={styles.emptyText}>Set up a household to get started.</Text></View>;
    }
    const currency = activeHousehold.base_currency;

    return (
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
            <ScreenHeader title="Dividends" />
            <ScrollView
                contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 100 }}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.fuchsiaLight} />}
            >
                <View style={styles.row}>
                    <StatTile label={`Received ${new Date().getFullYear()}`} value={fmtMoney(receivedThisYear, currency)} valueColor={colors.success} />
                    <StatTile label="Forward / yr" value={fmtMoney(trailing12mo, currency)} />
                </View>

                <Card>
                    <Text style={styles.sectionTitle}>Upcoming</Text>
                    {upcoming.slice(0, 2).map((u, i) => (
                        <View key={i} style={styles.upcomingRow}>
                            <Text style={styles.upcomingDate}>{u.date.toLocaleDateString("default", { month: "short", day: "numeric" })}</Text>
                            <Text style={styles.upcomingTicker}>{u.ticker}</Text>
                            <Text style={styles.upcomingAmount}>+{fmtMoney(u.amount, currency)}</Text>
                        </View>
                    ))}
                    {upcoming.length === 0 && <Text style={styles.emptyInline}>No upcoming payments detected yet.</Text>}
                </Card>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg, padding: 24 },
    emptyText: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 14, textAlign: "center" },
    emptyInline: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 13, fontStyle: "italic" },
    row: { flexDirection: "row", gap: 12 },
    sectionTitle: { color: colors.textPrimary, fontFamily: fonts.displaySemibold, fontSize: 14, marginBottom: 10 },
    upcomingRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
    upcomingDate: { color: colors.fuchsiaLight, fontFamily: fonts.monoBold, fontSize: 12, width: 56 },
    upcomingTicker: { flex: 1, color: colors.textPrimary, fontFamily: fonts.bodyMedium, fontSize: 13 },
    upcomingAmount: { color: colors.success, fontFamily: fonts.monoBold, fontSize: 13 },
});
