import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { storage } from "./storage";
import api from "./api";
import { useAuth } from "./AuthContext";
import type { HouseholdResponse } from "../types/types";

const ACTIVE_HOUSEHOLD_KEY = "activeHouseholdId";

interface HouseholdContextType {
    households: HouseholdResponse[];
    activeHousehold: HouseholdResponse | null;
    setActiveHousehold: (h: HouseholdResponse) => void;
    refreshHouseholds: () => Promise<HouseholdResponse[]>;
    isLoading: boolean;
}

const HouseholdContext = createContext<HouseholdContextType>({
    households: [],
    activeHousehold: null,
    setActiveHousehold: () => { },
    refreshHouseholds: async () => [],
    isLoading: true,
});

export const HouseholdProvider = ({ children }: { children: ReactNode }) => {
    const { isAuthenticated } = useAuth();
    const [households, setHouseholds] = useState<HouseholdResponse[]>([]);
    const [activeHousehold, setActiveHouseholdState] = useState<HouseholdResponse | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const setActiveHousehold = (h: HouseholdResponse) => {
        setActiveHouseholdState(h);
        storage.setItem(ACTIVE_HOUSEHOLD_KEY, h.id);
    };

    const refreshHouseholds = async () => {
        setIsLoading(true);
        try {
            const res = await api.get("/users/households");
            const data: HouseholdResponse[] = res.data;
            setHouseholds(data);
            const savedId = await storage.getItem(ACTIVE_HOUSEHOLD_KEY);
            const match = data.find(h => h.id === savedId);
            setActiveHouseholdState(match || data[0] || null);
            return data;
        } catch {
            setHouseholds([]);
            return [];
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (isAuthenticated) refreshHouseholds();
        else { setHouseholds([]); setActiveHouseholdState(null); setIsLoading(false); }
    }, [isAuthenticated]);

    return (
        <HouseholdContext.Provider value={{ households, activeHousehold, setActiveHousehold, refreshHouseholds, isLoading }}>
            {children}
        </HouseholdContext.Provider>
    );
};

export const useHousehold = () => useContext(HouseholdContext);
