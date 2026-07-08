import { useState } from "react";
import { View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Pressable } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { LinearGradient } from "expo-linear-gradient";
import { useAuth } from "../lib/AuthContext";
import { colors, fonts, radii } from "../theme/theme";
import { PrimaryButton } from "../components/ui";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "Signup">;

export default function Signup({ navigation }: Props) {
    const { signup } = useAuth();
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const submit = async () => {
        setError(null);
        setLoading(true);
        try {
            await signup(email, password, name);
        } catch (e: any) {
            setError(e.response?.data?.detail || "Could not create account");
        } finally {
            setLoading(false);
        }
    };

    return (
        <LinearGradient colors={["#1a0e1f", colors.bg]} style={{ flex: 1 }}>
            <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
                <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
                    <Text style={styles.title}>Create your account</Text>
                    <Text style={styles.subtitle}>30 seconds to set up, private by default.</Text>

                    <View style={styles.form}>
                        <TextInput style={styles.input} placeholder="Your name" placeholderTextColor={colors.textMuted} value={name} onChangeText={setName} />
                        <TextInput style={styles.input} placeholder="ivan@lee.sg" placeholderTextColor={colors.textMuted} autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
                        <TextInput style={styles.input} placeholder="••••••••••" placeholderTextColor={colors.textMuted} secureTextEntry value={password} onChangeText={setPassword} />
                        {error && <Text style={styles.error}>{error}</Text>}
                        <PrimaryButton label={loading ? "Creating…" : "Create account"} onPress={submit} disabled={loading} style={{ marginTop: 8 }} />
                    </View>

                    <Pressable onPress={() => navigation.navigate("Login")} style={{ marginTop: 20 }}>
                        <Text style={styles.footerText}>
                            Already have an account? <Text style={styles.footerLink}>Sign in</Text>
                        </Text>
                    </Pressable>
                </ScrollView>
            </KeyboardAvoidingView>
        </LinearGradient>
    );
}

const styles = StyleSheet.create({
    container: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 24 },
    title: { color: colors.textPrimary, fontFamily: fonts.display, fontSize: 26, marginBottom: 6 },
    subtitle: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 13.5, marginBottom: 28 },
    form: { width: "100%", maxWidth: 360, gap: 12 },
    input: {
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.borderInput,
        borderRadius: radii.md,
        paddingHorizontal: 14,
        paddingVertical: 13,
        color: colors.textPrimary,
        fontFamily: fonts.body,
        fontSize: 14,
    },
    error: { color: colors.danger, fontFamily: fonts.body, fontSize: 12.5 },
    footerText: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 13 },
    footerLink: { color: colors.fuchsiaLight, fontFamily: fonts.bodySemibold },
});
