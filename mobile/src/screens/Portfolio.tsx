import { useState, useCallback } from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import api from "../lib/api";
import { useHousehold } from "../lib/HouseholdContext";
import { colors, fonts } from "../theme/theme";
import { HeroCard, Card, StatTile, ScreenHeader } from "../components/ui";
import type { AssetResponse, PortfolioMetricsResponse, PortfolioSnapshotResponse } from "../types/types";

function fmtMoney(n: number, currency: string) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}
function pct(n: number) { return `${(n * 100).toFixed(1)}%`; }

export default function Portfolio() {
    const { activeHousehold } = useHousehold();
    const [snapshots, setSnapshots] = useState<PortfolioSnapshotResponse[]>([]);
    const [assets, setAssets] = useState<AssetResponse[]>([]);
    const [metrics, setMetrics] = useState<PortfolioMetricsResponse | null>(null);
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async () => {
        if (!activeHousehold) return;
        const [snapRes, metricsRes] = await Promise.all([
            api.get(`/portfolio/snapshots/household/${activeHousehold.id}`),
            api.get(`/portfolio/household/${activeHousehold.id}/metrics`),
        ]);
        setSnapshots(snapRes.data);
        setMetrics(metricsRes.data);
        const assetRes = await api.get(`/portfolio/assets`).catch(() => ({ data: [] }));
        setAssets(assetRes.data);
    }, [activeHousehold?.id]);

    useFocusEffect(useCallback(() => { load(); }, [load]));
    const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

    if (!activeHousehold) {
        return <View style={styles.center}><Text style={styles.emptyText}>Set up a household to get started.</Text></View>;
    }

    const currency = activeHousehold.base_currency;
    const assetById = new Map(assets.map(a => [a.id, a]));
    const latestDate = snapshots.reduce((max, s) => (s.date > max ? s.date : max), "");
    const byAsset = new Map<string, { qty: number; value: number; cost: number }>();
    snapshots.filter(s => s.date === latestDate).forEach(s => {
        const existing = byAsset.get(s.asset_id) || { qty: 0, value: 0, cost: 0 };
        existing.qty += s.quantity;
        existing.value += Number(s.current_value_home_currency);
        existing.cost += Number(s.average_cost_basis_home_currency) * s.quantity;
        byAsset.set(s.asset_id, existing);
    });
    const total = Array.from(byAsset.values()).reduce((sum, v) => sum + v.value, 0);

    return (
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
            <ScreenHeader title="Portfolio" />
            <ScrollView
                contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 100 }}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.fuchsiaLight} />}
            >
                <HeroCard>
                    <Text style={styles.heroLabel}>Portfolio value</Text>
                    <Text style={styles.heroValue}>{fmtMoney(total, currency)}</Text>
                </HeroCard>

                <View style={styles.row}>
                    <StatTile label="TWR (ann.)" value={pct(metrics?.overall_metrics?.time_weighted_return || 0)} valueColor={colors.success} />
                    <StatTile label="Sharpe" value={(metrics?.overall_metrics?.sharpe_ratio ?? 0).toFixed(2)} />
                </View>

                <Card>
                    <Text style={styles.sectionTitle}>Holdings</Text>
                    {Array.from(byAsset.entries()).map(([assetId, h]) => {
                        const asset = assetById.get(assetId);
                        const plPct = h.cost > 0 ? ((h.value - h.cost) / h.cost) * 100 : 0;
                        return (
                            <View key={assetId} style={styles.holdingRow}>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.holdingTicker}>{asset?.ticker || "—"}</Text>
                                    <Text style={styles.holdingShares}>{h.qty} shares</Text>
                                </View>
                                <View style={{ alignItems: "flex-end" }}>
                                    <Text style={styles.holdingValue}>{fmtMoney(h.value, currency)}</Text>
                                    <Text style={[styles.holdingPl, { color: plPct >= 0 ? colors.success : colors.danger }]}>{plPct >= 0 ? "+" : ""}{plPct.toFixed(1)}%</Text>
                                </View>
                            </View>
                        );
                    })}
                    {byAsset.size === 0 && <Text style={styles.emptyInline}>No holdings yet.</Text>}
                </Card>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg, padding: 24 },
    emptyText: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 14, textAlign: "center" },
    emptyInline: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 13, fontStyle: "italic" },
    heroLabel: { color: colors.skyLight, fontFamily: fonts.mono, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 },
    heroValue: { color: colors.textPrimary, fontFamily: fonts.monoBold, fontSize: 28 },
    row: { flexDirection: "row", gap: 12 },
    sectionTitle: { color: colors.textPrimary, fontFamily: fonts.displaySemibold, fontSize: 14, marginBottom: 10 },
    holdingRow: { flexDirection: "row", paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
    holdingTicker: { color: colors.textPrimary, fontFamily: fonts.monoBold, fontSize: 13 },
    holdingShares: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 11, marginTop: 2 },
    holdingValue: { color: colors.textPrimary, fontFamily: fonts.monoBold, fontSize: 13 },
    holdingPl: { fontFamily: fonts.mono, fontSize: 11, marginTop: 2 },
});
