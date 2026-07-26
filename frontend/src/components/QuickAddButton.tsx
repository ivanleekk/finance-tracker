import { useLocation } from "react-router";
import { Plus } from "lucide-react";
import { useAuth } from "../lib/AuthContext";
import { useCommandBar } from "../lib/CommandBarContext";

// Marketing and pre-auth screens have nothing to quick-add against.
const HIDDEN_ON = ["/", "/login", "/signup", "/onboarding"];

/**
 * Touch counterpart to the TopBar's ⌘K trigger, which is hidden below lg.
 * Opens the same command bar — this is an affordance, not a second code path.
 */
export function QuickAddButton() {
    const { isAuthenticated } = useAuth();
    const { isOpen, open } = useCommandBar();
    const { pathname } = useLocation();

    if (!isAuthenticated || isOpen || HIDDEN_ON.includes(pathname)) return null;

    return (
        <button
            type="button"
            onClick={open}
            aria-label="Quick add"
            className={
                "fixed right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full " +
                "bg-gradient-to-br from-secondary-500 to-secondary-700 text-white " +
                "shadow-lg shadow-secondary-500/30 transition-transform active:scale-95 " +
                // Clear of the iOS home indicator on devices that report one.
                "bottom-[calc(1.25rem+env(safe-area-inset-bottom))] lg:hidden print:hidden"
            }
        >
            <Plus className="h-6 w-6" />
        </button>
    );
}
