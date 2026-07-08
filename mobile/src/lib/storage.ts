import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

// expo-secure-store has no web implementation (it's a native keychain/keystore API).
// On web we fall back to localStorage so the app is still usable there for dev/testing;
// on iOS/Android this is the real secure, encrypted store.
export const storage = {
    async getItem(key: string): Promise<string | null> {
        if (Platform.OS === "web") {
            return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
        }
        return SecureStore.getItemAsync(key);
    },
    async setItem(key: string, value: string): Promise<void> {
        if (Platform.OS === "web") {
            if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
            return;
        }
        return SecureStore.setItemAsync(key, value);
    },
    async removeItem(key: string): Promise<void> {
        if (Platform.OS === "web") {
            if (typeof localStorage !== "undefined") localStorage.removeItem(key);
            return;
        }
        return SecureStore.deleteItemAsync(key);
    },
};
