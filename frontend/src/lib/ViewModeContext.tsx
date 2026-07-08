import { createContext, useState, useEffect, useContext, type ReactNode } from "react";
import type { ViewMode } from "../types/types";
import { useHousehold } from "./HouseholdContext";
import api from "./api";

interface ViewModeContextType {
    viewMode: ViewMode;
    setViewMode: (mode: ViewMode) => void;
    // True once the active household actually has someone else in it (a member beyond the
    // owner, or a pending invite) - controls the 3-way switch vs the "+ Household" pill.
    // Every user technically has a household (their own), so household *count* alone isn't
    // the right signal - a real second person has to be involved or invited.
    hasHousehold: boolean;
    hasSeenHouseholdTooltip: boolean;
    dismissHouseholdTooltip: () => void;
}

const ViewModeContext = createContext<ViewModeContextType>({
    viewMode: "blended",
    setViewMode: () => { },
    hasHousehold: false,
    hasSeenHouseholdTooltip: true,
    dismissHouseholdTooltip: () => { },
});

const TOOLTIP_SEEN_KEY = "householdDiscoverabilityTooltipSeen";
const VIEW_MODE_COOKIE = "viewMode";

export const ViewModeProvider = ({ children }: { children: ReactNode }) => {
    const { activeHousehold } = useHousehold();

    // Blended is the default/illustrated-active tab per the design once a household exists.
    const [viewMode, setViewModeState] = useState<ViewMode>("blended");
    const [hasSeenHouseholdTooltip, setHasSeenHouseholdTooltip] = useState(true);
    const [hasSecondPerson, setHasSecondPerson] = useState(false);

    useEffect(() => {
        const match = document.cookie.match(new RegExp(`${VIEW_MODE_COOKIE}=([^;]+)`));
        if (match && (match[1] === "private" || match[1] === "household" || match[1] === "blended")) {
            setViewModeState(match[1] as ViewMode);
        }
        setHasSeenHouseholdTooltip(localStorage.getItem(TOOLTIP_SEEN_KEY) === "true");
    }, []);

    // A household only "counts" for the switch once someone besides the owner is a member or invited.
    useEffect(() => {
        if (!activeHousehold) {
            setHasSecondPerson(false);
            return;
        }
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

    const hasHousehold = hasSecondPerson;

    const setViewMode = (mode: ViewMode) => {
        setViewModeState(mode);
        document.cookie = `${VIEW_MODE_COOKIE}=${mode}; path=/; max-age=31536000`;
    };

    const dismissHouseholdTooltip = () => {
        setHasSeenHouseholdTooltip(true);
        localStorage.setItem(TOOLTIP_SEEN_KEY, "true");
    };

    // Solo users have no one to hide things from - "blended" semantics show everything that's
    // theirs regardless of whether it happened to be tagged shared (null) or private (owned).
    const effectiveViewMode: ViewMode = hasHousehold ? viewMode : "blended";

    return (
        <ViewModeContext.Provider value={{
            viewMode: effectiveViewMode,
            setViewMode,
            hasHousehold,
            hasSeenHouseholdTooltip,
            dismissHouseholdTooltip,
        }}>
            {children}
        </ViewModeContext.Provider>
    );
};

export const useViewMode = () => useContext(ViewModeContext);

/** Given an item's owner_user_id (null/undefined = shared) and the current viewMode, should it be shown? */
export function isVisibleInViewMode(ownerUserId: string | null | undefined, viewMode: ViewMode, currentUserId?: string): boolean {
    const isPrivate = !!ownerUserId;
    const isMine = ownerUserId === currentUserId;
    if (viewMode === "blended") return !isPrivate || isMine;
    if (viewMode === "household") return !isPrivate;
    // private tab: only the current user's own private items
    return isPrivate && isMine;
}
