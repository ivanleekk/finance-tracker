import * as React from "react"
import { NavLink } from "react-router"
import { cn } from "../lib/utils"

interface SidebarButtonProps {
    text: string
    href?: string // Made optional so buttons don't require it
    onClick?: () => void
    icon?: React.ReactNode
}

function SidebarButton({ text, href, icon, onClick }: SidebarButtonProps) {
    // Extract the shared icon markup to avoid repeating it
    const IconContent = icon && (
        <span className="flex h-5 w-5 items-center justify-center">
            {icon}
        </span>
    );

    // Shared base classes for both the NavLink and the Button
    const baseClasses = "group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors";
    const inactiveClasses = "text-base-600 hover:bg-base-100 hover:text-base-900 dark:text-base-400 dark:hover:bg-base-900 dark:hover:text-base-100";
    const activeClasses = "bg-primary-50 text-primary-700 dark:bg-primary-950/50 dark:text-primary-400";

    // Fallback safety: If there's no href (and we want to render it as a standard button)
    if (!href) {
        return (
            <button
                onClick={onClick}
                // Buttons aren't "active" routes, so they just get the inactive hover styling
                className={cn(baseClasses, inactiveClasses, "text-left min-h-[44px]")}
            >
                {IconContent}
                {text}
            </button>
        )
    }

    // Render as a NavLink for navigation
    return (
        <NavLink
            to={href}
            onClick={onClick} // Close the sidebar when clicked
            className={({ isActive }) =>
                cn(
                    baseClasses,
                    "min-h-[44px]", // Minimum touch target size
                    isActive ? activeClasses : inactiveClasses
                )
            }
        >
            {({ isActive }) => (
                <div className="flex w-full items-center justify-between">
                    <div className="flex items-center gap-3">
                        {IconContent}
                        {text}
                    </div>
                    {isActive && (
                        <div className="h-1.5 w-1.5 rounded-full bg-secondary-500 shadow-[0_0_8px_var(--color-secondary-400)]" />
                    )}
                </div>
            )}
        </NavLink>
    )
}

export default SidebarButton