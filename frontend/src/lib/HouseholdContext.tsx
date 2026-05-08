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
    setActiveHousehold: () => { },
    refreshHouseholds: async () => { },
    isLoading: true,
});

export const HouseholdProvider = ({
    children,
    initialHouseholds
}: {
    children: ReactNode;
    initialHouseholds?: HouseholdResponse[];
}) => {
    const [households, setHouseholds] = useState<HouseholdResponse[]>(initialHouseholds || []);
    
    // Initialize active household consistently between server and client to avoid hydration mismatch
    const [activeHousehold, setActiveHouseholdState] = useState<HouseholdResponse | null>(() => {
        if (initialHouseholds && initialHouseholds.length > 0) {
            return initialHouseholds[0];
        }
        return null;
    });

    // Check for cookie/localStorage selection ONLY on the client after mount
    useEffect(() => {
        if (initialHouseholds && initialHouseholds.length > 0) {
            const match = document.cookie.match(/activeHouseholdId=([^;]+)/);
            const cookieId = match ? match[1] : localStorage.getItem('activeHouseholdId');
            
            if (cookieId) {
                const found = initialHouseholds.find(h => h.id === cookieId);
                if (found) {
                    setActiveHouseholdState(found);
                }
            }
        }
    }, [initialHouseholds]);
    
    const [isLoading, setIsLoading] = useState(false);

    // Sync households when navigating between pages that re-run root loader
    useEffect(() => {
        if (initialHouseholds) {
            setHouseholds(initialHouseholds);
            if (initialHouseholds.length > 0 && !activeHousehold) {
                setActiveHouseholdState(initialHouseholds[0]);
            }
        }
    }, [initialHouseholds]);

    const refreshHouseholds = async () => {
        setIsLoading(true);
        try {
            const response = await api.get('/users/households');
            const data = response.data as HouseholdResponse[];
            setHouseholds(data);

            if (data.length > 0) {
                // Keep current active if it still exists, otherwise pick first
                const stillExists = data.find(h => h.id === activeHousehold?.id);
                if (!stillExists) {
                    setActiveHousehold(data[0]);
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
        if (typeof document !== 'undefined') {
            document.cookie = `activeHouseholdId=${household.id}; path=/; max-age=31536000`;
            localStorage.setItem('activeHouseholdId', household.id);
        }
    };

    return (
        <HouseholdContext.Provider value={{ households, activeHousehold, setActiveHousehold, refreshHouseholds, isLoading }}>
            {children}
        </HouseholdContext.Provider>
    );
};

export const useHousehold = () => useContext(HouseholdContext);
