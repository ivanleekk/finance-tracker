import { useCallback } from "react";
import { View } from "react-native";
import { NavigationContainer, DarkTheme } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import {
    useFonts,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
} from "@expo-google-fonts/plus-jakarta-sans";
import {
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
} from "@expo-google-fonts/inter";
import {
    JetBrainsMono_500Medium,
    JetBrainsMono_700Bold,
} from "@expo-google-fonts/jetbrains-mono";

import { AuthProvider } from "./src/lib/AuthContext";
import { HouseholdProvider } from "./src/lib/HouseholdContext";
import { ViewModeProvider } from "./src/lib/ViewModeContext";
import { QuickAddProvider } from "./src/lib/QuickAddContext";
import { QuickAddSheet } from "./src/components/QuickAddSheet";
import RootNavigator from "./src/navigation/RootNavigator";
import { colors } from "./src/theme/theme";

SplashScreen.preventAutoHideAsync();

const navTheme = {
    ...DarkTheme,
    colors: {
        ...DarkTheme.colors,
        background: colors.bg,
        card: colors.card,
        border: colors.border,
        primary: colors.fuchsiaLight,
        text: colors.textPrimary,
    },
};

export default function App() {
    const [fontsLoaded] = useFonts({
        PlusJakartaSans_600SemiBold,
        PlusJakartaSans_700Bold,
        PlusJakartaSans_800ExtraBold,
        Inter_400Regular,
        Inter_500Medium,
        Inter_600SemiBold,
        Inter_700Bold,
        JetBrainsMono_500Medium,
        JetBrainsMono_700Bold,
    });

    const onLayout = useCallback(async () => {
        if (fontsLoaded) await SplashScreen.hideAsync();
    }, [fontsLoaded]);

    if (!fontsLoaded) return null;

    return (
        <View style={{ flex: 1, backgroundColor: colors.bg }} onLayout={onLayout}>
            <AuthProvider>
                <HouseholdProvider>
                    <ViewModeProvider>
                        <QuickAddProvider>
                            <NavigationContainer theme={navTheme}>
                                <StatusBar style="light" />
                                <RootNavigator />
                            </NavigationContainer>
                            <QuickAddSheet />
                        </QuickAddProvider>
                    </ViewModeProvider>
                </HouseholdProvider>
            </AuthProvider>
        </View>
    );
}
