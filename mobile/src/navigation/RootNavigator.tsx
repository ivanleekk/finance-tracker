import { View, ActivityIndicator } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useAuth } from "../lib/AuthContext";
import { useHousehold } from "../lib/HouseholdContext";
import { colors } from "../theme/theme";
import Login from "../screens/Login";
import Signup from "../screens/Signup";
import OnboardingStep1 from "../screens/OnboardingStep1";
import OnboardingStep2 from "../screens/OnboardingStep2";
import MainTabs from "./MainTabs";
import GoalDetail from "../screens/GoalDetail";
import Dividends from "../screens/Dividends";
import Goals from "../screens/Goals";
import Household from "../screens/Household";
import Settings from "../screens/Settings";
import type { RootStackParamList } from "./types";

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
    const { isAuthenticated, isLoading: authLoading } = useAuth();
    const { households, isLoading: householdLoading } = useHousehold();

    if (authLoading || (isAuthenticated && householdLoading)) {
        return (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
                <ActivityIndicator color={colors.fuchsiaLight} />
            </View>
        );
    }

    const screenOptions = {
        headerStyle: { backgroundColor: colors.card },
        headerTintColor: colors.textPrimary,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bg },
    };

    if (!isAuthenticated) {
        return (
            <Stack.Navigator screenOptions={{ headerShown: false }}>
                <Stack.Screen name="Login" component={Login} />
                <Stack.Screen name="Signup" component={Signup} />
            </Stack.Navigator>
        );
    }

    if (households.length === 0) {
        return (
            <Stack.Navigator screenOptions={{ headerShown: false }}>
                <Stack.Screen name="OnboardingStep1" component={OnboardingStep1} />
                <Stack.Screen name="OnboardingStep2" component={OnboardingStep2} />
            </Stack.Navigator>
        );
    }

    return (
        <Stack.Navigator screenOptions={screenOptions}>
            <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
            <Stack.Screen name="GoalDetail" component={GoalDetail} options={{ headerShown: false }} />
            <Stack.Screen name="Dividends" component={Dividends} options={{ headerShown: false }} />
            <Stack.Screen name="Goals" component={Goals} options={{ headerShown: false }} />
            <Stack.Screen name="Household" component={Household} options={{ headerShown: false }} />
            <Stack.Screen name="Settings" component={Settings} options={{ headerShown: false }} />
        </Stack.Navigator>
    );
}
