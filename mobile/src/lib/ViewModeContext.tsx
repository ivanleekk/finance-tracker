import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import api from "./api";
import { useHousehold } from "./HouseholdContext";
import type { ViewMode } from "../types/types";

interface ViewModeContextType {
    viewMode: ViewMode;
    setViewMode: (m: ViewMode) => void;
    hasHousehold: boolean; // true once a real second person (member or invite) exists
}

const ViewModeContext = createContext<ViewModeContextType>({
    viewMode: "blended",
    setViewMode: () => { },
    hasHousehold: false,
});

export const ViewModeProvider = ({ children }: { children: ReactNode }) => {
    const { activeHousehold } = useHousehold();
    const [viewMode, setViewMode] = useState<ViewMode>("blended");
    const [hasSecondPerson, setHasSecondPerson] = useState(false);

    useEffect(() => {
        if (!activeHousehold) { setHasSecondPerson(false); return; }
        let cancelled = false;
        Promise.all([
            api.get(`/users/householdmember/${activeHousehold.id}`),
            api.get(`/users/households/${activeHousehold.id}/invites`),
        ]).then(([membersRes, invitesRes]) => {
            if (cancelled) return;
            const memberCount = Array.isArray(membersRes.data) ? membersRes.data.length : 1;
            const pendingInvites = Array.isArray(invitesRes.data) ? invitesRes.data.length : 0;
            setHasSecondPerson(memberCount > 1 || pendingInvites > 0);
        }).catch(() => setHasSecondPerson(false));
        return () => { cancelled = true; };
    }, [activeHousehold?.id]);

    const effectiveViewMode: ViewMode = hasSecondPerson ? viewMode : "blended";

    return (
        <ViewModeContext.Provider value={{ viewMode: effectiveViewMode, setViewMode, hasHousehold: hasSecondPerson }}>
            {children}
        </ViewModeContext.Provider>
    );
};

export const useViewMode = () => useContext(ViewModeContext);

export function isVisibleInViewMode(ownerUserId: string | null | undefined, viewMode: ViewMode, currentUserId?: string): boolean {
    const isPrivate = !!ownerUserId;
    const isMine = ownerUserId === currentUserId;
    if (viewMode === "blended") return !isPrivate || isMine;
    if (viewMode === "household") return !isPrivate;
    return isPrivate && isMine;
}
