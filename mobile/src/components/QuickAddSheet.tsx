import { useEffect, useRef, useState } from "react";
import { Modal, View, Text, TextInput, Pressable, StyleSheet, ScrollView, Animated, Dimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useQuickAdd } from "../lib/QuickAddContext";
import { useHousehold } from "../lib/HouseholdContext";
import { useAuth } from "../lib/AuthContext";
import { useViewMode } from "../lib/ViewModeContext";
import api from "../lib/api";
import { parseCommand, FALLBACK_ASSETS, type ParsedCommand } from "../lib/commandParser";
import { colors, fonts, radii } from "../theme/theme";
import type { AccountResponse, CategoryResponse } from "../types/types";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");

function fmtA(n: number) {
    const dec = Number.isInteger(Number(n)) ? 0 : 2;
    return Number(n).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: 2 });
}
function fmt(n: number) {
    return Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function Chip({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "red" | "green" | "fuchsia" }) {
    const map = {
        neutral: { bg: colors.chipNeutral, text: colors.textSecondary },
        red: { bg: "rgba(248,113,113,0.12)", text: colors.danger },
        green: { bg: "rgba(74,222,128,0.12)", text: colors.success },
        fuchsia: { bg: colors.privateBg, text: colors.privateText },
    }[tone];
    return (
        <View style={[chipStyles.chip, { backgroundColor: map.bg }]}>
            <Text style={[chipStyles.chipText, { color: map.text }]}>{children}</Text>
        </View>
    );
}
const chipStyles = StyleSheet.create({
    chip: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 6, marginRight: 6, marginBottom: 6 },
    chipText: { fontFamily: fonts.monoBold, fontSize: 11 },
});

export function QuickAddSheet() {
    const { isOpen, close } = useQuickAdd();
    const { activeHousehold } = useHousehold();
    const { user } = useAuth();
    const { hasHousehold } = useViewMode();

    const [query, setQuery] = useState("");
    const [accounts, setAccounts] = useState<AccountResponse[]>([]);
    const [categories, setCategories] = useState<CategoryResponse[]>([]);
    const [ownership, setOwnership] = useState<"private" | "household">("household");
    const [submitting, setSubmitting] = useState(false);
    const [success, setSuccess] = useState<{ big: string; sub: string } | null>(null);
    const slide = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

    useEffect(() => {
        if (isOpen) {
            setQuery("");
            setSuccess(null);
            Animated.spring(slide, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
            if (activeHousehold) {
                api.get(`/accounts/household/${activeHousehold.id}`).then(r => setAccounts(r.data)).catch(() => { });
                api.get(`/cashflow/categories/household/${activeHousehold.id}`).then(r => setCategories(r.data)).catch(() => { });
            }
        } else {
            Animated.timing(slide, { toValue: SCREEN_HEIGHT, duration: 200, useNativeDriver: true }).start();
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const parsed: ParsedCommand = parseCommand(query, accounts);

    const routedAccount = (fallback: AccountResponse | null): AccountResponse | null => {
        if (!hasHousehold) return fallback;
        if (ownership === "private") return accounts.find(a => a.owner_user_id === user?.id) || fallback;
        return accounts.find(a => !a.owner_user_id) || fallback;
    };

    const resolveCategoryId = async (name: string, type: "income" | "expense"): Promise<string | null> => {
        if (!activeHousehold) return null;
        const existing = categories.find(c => c.name.toLowerCase() === name.toLowerCase());
        if (existing) return existing.id;
        try {
            const res = await api.post("/cashflow/categories", { household_id: activeHousehold.id, name, type });
            setCategories(prev => [...prev, res.data]);
            return res.data.id;
        } catch { return null; }
    };

    const submit = async () => {
        if (!activeHousehold || submitting) return;
        if (parsed.type === "empty" || parsed.type === "search") return;
        setSubmitting(true);
        try {
            if (parsed.type === "expense") {
                const account = routedAccount(parsed.account);
                if (!account) return;
                const categoryId = await resolveCategoryId(parsed.category.name, "expense");
                if (!categoryId) return;
                await api.post("/cashflow/transactions", {
                    account_id: account.id, category_id: categoryId, date: new Date().toISOString(),
                    amount: parsed.amount, transaction_type: "expense", description: parsed.merchant,
                });
                setSuccess({ big: `−$${fmtA(parsed.amount)}`, sub: `${parsed.category.name} · ${account.name}` });
            } else if (parsed.type === "balance") {
                await api.post("/accounts/balances", { account_id: parsed.account.id, date: new Date().toISOString().split("T")[0], balance: parsed.newBalance });
                setSuccess({ big: `$${fmt(parsed.newBalance)}`, sub: `${parsed.account.name} balance set` });
            } else if (parsed.type === "trade") {
                const spRes = await api.get(`/portfolio/subportfolios/household/${activeHousehold.id}`);
                const sp = spRes.data.find((s: any) => s.id === activeHousehold.default_sub_portfolio_id) || spRes.data[0];
                const fundingAccount = accounts.find(a => a.id === activeHousehold.default_funding_account_id) || accounts[0];
                if (!sp || !fundingAccount) return;
                const info = FALLBACK_ASSETS[parsed.ticker];
                const existing = await api.get(`/portfolio/assets?ticker=${parsed.ticker}`);
                let asset = existing.data[0];
                if (!asset) {
                    const created = await api.post("/portfolio/assets", { id: crypto.randomUUID(), ticker: parsed.ticker, name: info?.name || parsed.ticker, type: "equity", currency: info?.currency || "USD" });
                    asset = created.data;
                }
                const price = parsed.explicitPrice ?? info?.price ?? 100;
                await api.post("/portfolio/trades", {
                    household_id: activeHousehold.id, sub_portfolio_id: sp.id, asset_id: asset.id, account_id: fundingAccount.id,
                    type: parsed.side, date: new Date().toISOString(), quantity: parsed.qty, price, exchange_rate: 1,
                });
                setSuccess({ big: `${parsed.side === "buy" ? "Bought" : "Sold"} ${parsed.qty} ${parsed.ticker}`, sub: `@ $${fmtA(price)}` });
            } else if (parsed.type === "dividend") {
                const spRes = await api.get(`/portfolio/subportfolios/household/${activeHousehold.id}`);
                const sp = spRes.data.find((s: any) => s.id === activeHousehold.default_sub_portfolio_id) || spRes.data[0];
                const fundingAccount = accounts.find(a => a.id === activeHousehold.default_funding_account_id) || accounts[0];
                if (!sp || !fundingAccount) return;
                const info = FALLBACK_ASSETS[parsed.ticker];
                const existing = await api.get(`/portfolio/assets?ticker=${parsed.ticker}`);
                let asset = existing.data[0];
                if (!asset) {
                    const created = await api.post("/portfolio/assets", { id: crypto.randomUUID(), ticker: parsed.ticker, name: info?.name || parsed.ticker, type: "equity", currency: info?.currency || "USD" });
                    asset = created.data;
                }
                await api.post("/portfolio/dividends", {
                    household_id: activeHousehold.id, sub_portfolio_id: sp.id, asset_id: asset.id, account_id: fundingAccount.id,
                    date: new Date().toISOString(), amount: parsed.amount, exchange_rate: 1,
                });
                setSuccess({ big: `+$${fmtA(parsed.amount)}`, sub: `Dividend · ${parsed.ticker}` });
            } else if (parsed.type === "transfer") {
                const from = parsed.fromCandidates[0];
                const to = parsed.toCandidates[0];
                if (!from || !to) return;
                await api.post("/cashflow/transfers", { from_account_id: from.id, to_account_id: to.id, amount: parsed.amount, date: new Date().toISOString(), description: "Transfer via quick add" });
                setSuccess({ big: `$${fmt(parsed.amount)} moved`, sub: `${from.name} → ${to.name}` });
            }
            setTimeout(close, 1600);
        } catch (e) {
            console.error("Quick add submit failed", e);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal transparent visible={isOpen} animationType="fade" onRequestClose={close}>
            <Pressable style={styles.backdrop} onPress={close}>
                <Animated.View style={[styles.sheet, { transform: [{ translateY: slide }] }]}>
                    <Pressable onPress={(e) => e.stopPropagation()}>
                        <View style={styles.handle} />
                        {success ? (
                            <View style={styles.successBox}>
                                <View style={styles.successCircle}><Text style={{ color: colors.success, fontSize: 22 }}>✓</Text></View>
                                <Text style={styles.successBig}>Logged {success.big}</Text>
                                <Text style={styles.successSub}>{success.sub}</Text>
                            </View>
                        ) : (
                            <>
                                <TextInput
                                    style={styles.input}
                                    placeholder="Log or find…"
                                    placeholderTextColor={colors.textMuted}
                                    value={query}
                                    onChangeText={setQuery}
                                    autoFocus
                                    onSubmitEditing={submit}
                                />
                                <ScrollView style={{ maxHeight: 260 }}>
                                    {parsed.type === "expense" && (
                                        <View style={{ marginTop: 12 }}>
                                            <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                                                <Chip tone="red">Expense</Chip>
                                                <Chip tone="red">−${fmtA(parsed.amount)}</Chip>
                                                <Chip tone="fuchsia">{parsed.category.icon} {parsed.category.name}</Chip>
                                                <Chip>{parsed.account?.name || "No account"}</Chip>
                                            </View>
                                            {hasHousehold && (
                                                <View style={styles.ownershipRow}>
                                                    {(["private", "household"] as const).map(o => (
                                                        <Pressable key={o} onPress={() => setOwnership(o)} style={[styles.ownershipChip, ownership === o && styles.ownershipChipActive]}>
                                                            <Text style={[styles.ownershipText, ownership === o && styles.ownershipTextActive]}>{o === "private" ? "🔒 Private" : "Household"}</Text>
                                                        </Pressable>
                                                    ))}
                                                </View>
                                            )}
                                        </View>
                                    )}
                                    {parsed.type === "balance" && (
                                        <View style={{ marginTop: 12, flexDirection: "row", flexWrap: "wrap" }}>
                                            <Chip>{parsed.account.name}</Chip>
                                            <Chip tone="fuchsia">${fmt(parsed.newBalance)}</Chip>
                                        </View>
                                    )}
                                    {parsed.type === "trade" && (
                                        <View style={{ marginTop: 12, flexDirection: "row", flexWrap: "wrap" }}>
                                            <Chip tone="green">{parsed.side === "buy" ? "Buy" : "Sell"}</Chip>
                                            <Chip>{parsed.qty} {parsed.ticker}</Chip>
                                        </View>
                                    )}
                                    {parsed.type === "dividend" && (
                                        <View style={{ marginTop: 12, flexDirection: "row", flexWrap: "wrap" }}>
                                            <Chip tone="green">Dividend</Chip>
                                            <Chip tone="green">+${fmtA(parsed.amount)}</Chip>
                                            <Chip>{parsed.ticker}</Chip>
                                        </View>
                                    )}
                                    {parsed.type === "transfer" && (
                                        <View style={{ marginTop: 12, flexDirection: "row", flexWrap: "wrap" }}>
                                            <Chip tone="fuchsia">${fmt(parsed.amount)}</Chip>
                                            <Chip>{parsed.fromCandidates[0]?.name} → {parsed.toCandidates[0]?.name}</Chip>
                                        </View>
                                    )}
                                </ScrollView>
                                {parsed.type !== "empty" && parsed.type !== "search" && (
                                    <Pressable onPress={submit} disabled={submitting} style={{ marginTop: 14 }}>
                                        <LinearGradient colors={["#d946ef", "#a21caf"]} style={styles.logButton}>
                                            <Text style={styles.logButtonText}>{submitting ? "Logging…" : "Log"}</Text>
                                        </LinearGradient>
                                    </Pressable>
                                )}
                            </>
                        )}
                    </Pressable>
                </Animated.View>
            </Pressable>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: "rgba(6,5,9,0.6)", justifyContent: "flex-end" },
    sheet: { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36 },
    handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.borderInput, alignSelf: "center", marginBottom: 16 },
    input: {
        backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.borderInput, borderRadius: radii.md,
        paddingHorizontal: 14, paddingVertical: 12, color: colors.textPrimary, fontFamily: fonts.body, fontSize: 15,
    },
    ownershipRow: { flexDirection: "row", backgroundColor: colors.chipNeutral, borderRadius: radii.sm, padding: 3, marginTop: 8, alignSelf: "flex-start" },
    ownershipChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 6 },
    ownershipChipActive: { backgroundColor: colors.card },
    ownershipText: { color: colors.textMuted, fontFamily: fonts.bodySemibold, fontSize: 12 },
    ownershipTextActive: { color: colors.textPrimary },
    logButton: { borderRadius: radii.md, paddingVertical: 13, alignItems: "center" },
    logButtonText: { color: "#fff", fontFamily: fonts.bodyBold, fontSize: 14 },
    successBox: { alignItems: "center", paddingVertical: 20 },
    successCircle: { width: 48, height: 48, borderRadius: 24, backgroundColor: "rgba(74,222,128,0.15)", alignItems: "center", justifyContent: "center", marginBottom: 10 },
    successBig: { color: colors.textPrimary, fontFamily: fonts.displaySemibold, fontSize: 16 },
    successSub: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 12, marginTop: 4 },
});
