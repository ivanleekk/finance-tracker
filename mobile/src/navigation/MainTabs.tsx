import { View, Pressable, StyleSheet } from "react-native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { LayoutDashboard, Landmark, PieChart, History, Menu, Plus } from "lucide-react-native";
import { LinearGradient } from "expo-linear-gradient";
import Dashboard from "../screens/Dashboard";
import Accounts from "../screens/Accounts";
import Portfolio from "../screens/Portfolio";
import Transactions from "../screens/Transactions";
import More from "../screens/More";
import { useQuickAdd } from "../lib/QuickAddContext";
import { colors } from "../theme/theme";
import type { MainTabParamList } from "./types";

const Tab = createBottomTabNavigator<MainTabParamList>();

function Fab() {
    const { open } = useQuickAdd();
    return (
        <Pressable onPress={open} style={styles.fab}>
            <LinearGradient colors={["#d946ef", "#a21caf"]} style={styles.fabInner}>
                <Plus color="#fff" size={26} />
            </LinearGradient>
        </Pressable>
    );
}

export default function MainTabs() {
    return (
        <View style={{ flex: 1 }}>
            <Tab.Navigator
                screenOptions={{
                    headerShown: false,
                    tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
                    tabBarActiveTintColor: colors.fuchsiaLight,
                    tabBarInactiveTintColor: colors.textMuted,
                }}
            >
                <Tab.Screen name="Dashboard" component={Dashboard} options={{ tabBarIcon: ({ color, size }) => <LayoutDashboard color={color} size={size} /> }} />
                <Tab.Screen name="Accounts" component={Accounts} options={{ tabBarIcon: ({ color, size }) => <Landmark color={color} size={size} /> }} />
                <Tab.Screen name="Portfolio" component={Portfolio} options={{ tabBarIcon: ({ color, size }) => <PieChart color={color} size={size} /> }} />
                <Tab.Screen name="Transactions" component={Transactions} options={{ tabBarIcon: ({ color, size }) => <History color={color} size={size} /> }} />
                <Tab.Screen name="MoreTab" component={More} options={{ title: "More", tabBarIcon: ({ color, size }) => <Menu color={color} size={size} /> }} />
            </Tab.Navigator>
            <Fab />
        </View>
    );
}

const styles = StyleSheet.create({
    fab: {
        position: "absolute",
        right: 20,
        bottom: 84,
        shadowColor: "#d946ef",
        shadowOpacity: 0.5,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
    },
    fabInner: {
        width: 56,
        height: 56,
        borderRadius: 18,
        alignItems: "center",
        justifyContent: "center",
    },
});
