import { useState, useCallback } from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import api from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { useHousehold } from "../lib/HouseholdContext";
import { useViewMode, isVisibleInViewMode } from "../lib/ViewModeContext";
import { colors, fonts } from "../theme/theme";
import { Card, StatTile, ScreenHeader } from "../components/ui";
import type { AccountResponse, CategoryResponse, TransactionResponse } from "../types/types";

function fmtMoney(n: number, currency: string) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(Math.abs(n));
}

export default function Transactions() {
    const { user } = useAuth();
    const { activeHousehold } = useHousehold();
    const { viewMode } = useViewMode();
    const [transactions, setTransactions] = useState<TransactionResponse[]>([]);
    const [accounts, setAccounts] = useState<AccountResponse[]>([]);
    const [categories, setCategories] = useState<CategoryResponse[]>([]);
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async () => {
        if (!activeHousehold) return;
        const [txRes, accRes, catRes] = await Promise.all([
            api.get(`/cashflow/transactions/household/${activeHousehold.id}`),
            api.get(`/accounts/household/${activeHousehold.id}`),
            api.get(`/cashflow/categories/household/${activeHousehold.id}`),
        ]);
        setTransactions(txRes.data);
        setAccounts(accRes.data);
        setCategories(catRes.data);
    }, [activeHousehold?.id]);

    useFocusEffect(useCallback(() => { load(); }, [load]));
    const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

    if (!activeHousehold) {
        return <View style={styles.center}><Text style={styles.emptyText}>Set up a household to get started.</Text></View>;
    }

    const currency = activeHousehold.base_currency;
    const accountById = new Map(accounts.map(a => [a.id, a]));
    const categoryById = new Map(categories.map(c => [c.id, c]));

    const visible = transactions
        .filter(tx => isVisibleInViewMode(accountById.get(tx.account_id)?.owner_user_id, viewMode, user?.id))
        .sort((a, b) => (a.date < b.date ? 1 : -1));

    const income = visible.filter(t => t.transaction_type === "income").reduce((sum, t) => sum + Number(t.amount_home_currency ?? t.amount), 0);
    const expense = visible.filter(t => t.transaction_type === "expense").reduce((sum, t) => sum + Number(t.amount_home_currency ?? t.amount), 0);

    return (
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
            <ScreenHeader title="Transactions" />
            <ScrollView
                contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 100 }}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.fuchsiaLight} />}
            >
                <View style={styles.row}>
                    <StatTile label="In" value={`+${fmtMoney(income, currency)}`} valueColor={colors.success} />
                    <StatTile label="Out" value={`-${fmtMoney(expense, currency)}`} valueColor={colors.danger} />
                </View>

                <Card>
                    {visible.slice(0, 30).map(tx => {
                        const account = accountById.get(tx.account_id);
                        const category = categoryById.get(tx.category_id);
                        const isExpense = tx.transaction_type === "expense";
                        return (
                            <View key={tx.id} style={styles.row2}>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.txName}>{tx.description || category?.name || "Transaction"}</Text>
                                    <Text style={styles.txSub}>{category?.name || "—"} · {account?.name || "—"}{account?.owner_user_id ? " · 🔒" : ""}</Text>
                                </View>
                                <Text style={[styles.txAmount, { color: isExpense ? colors.textPrimary : colors.success }]}>
                                    {isExpense ? "-" : "+"}{fmtMoney(Number(tx.amount_home_currency ?? tx.amount), currency)}
                                </Text>
                            </View>
                        );
                    })}
                    {visible.length === 0 && <Text style={styles.emptyInline}>No transactions yet.</Text>}
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
    row2: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
    txName: { color: colors.textPrimary, fontFamily: fonts.bodyMedium, fontSize: 13.5 },
    txSub: { color: colors.textMuted, fontFamily: fonts.mono, fontSize: 9.5, marginTop: 2, textTransform: "uppercase" },
    txAmount: { fontFamily: fonts.monoBold, fontSize: 13.5 },
});
