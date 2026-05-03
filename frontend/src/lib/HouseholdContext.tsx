import { createContext, useState, useEffect, useContext, type ReactNode } from "react";
import api from '../lib/api';
import type { HouseholdResponse } from "../types/types";

interface HouseholdContextType {
    households: HouseholdResponse[];
    activeHousehold: HouseholdResponse | null;
    setActiveHousehold: (household: HouseholdResponse) => void;
    refreshHouseholds: () => Promise<void>;
    isLoading: boolean;
}

const HouseholdContext = createContext<HouseholdContextType>({
    households: [],
    activeHousehold: null,
    setActiveHousehold: () => {},
    refreshHouseholds: async () => {},
    isLoading: true,
});

export const HouseholdProvider = ({ children }: { children: ReactNode }) => {
    const [households, setHouseholds] = useState<HouseholdResponse[]>([]);
    const [activeHousehold, setActiveHouseholdState] = useState<HouseholdResponse | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const refreshHouseholds = async () => {
        try {
            const response = await api.get('/users/households');
            const data = response.data as HouseholdResponse[];
            setHouseholds(data);
            
            if (data.length > 0) {
                const storedId = localStorage.getItem('activeHouseholdId');
                const found = data.find(h => h.id === storedId);
                if (found) {
                    setActiveHouseholdState(found);
                } else {
                    setActiveHouseholdState(data[0]);
                    localStorage.setItem('activeHouseholdId', data[0].id);
                }
            } else {
                setActiveHouseholdState(null);
            }
        } catch (error) {
            console.error("Failed to fetch households", error);
        } finally {
            setIsLoading(false);
        }
    };

    const setActiveHousehold = (household: HouseholdResponse) => {
        setActiveHouseholdState(household);
        localStorage.setItem('activeHouseholdId', household.id);
    };

    useEffect(() => {
        refreshHouseholds();
    }, []);

    return (
        <HouseholdContext.Provider value={{ households, activeHousehold, setActiveHousehold, refreshHouseholds, isLoading }}>
            {children}
        </HouseholdContext.Provider>
    );
};

export const useHousehold = () => useContext(HouseholdContext);
