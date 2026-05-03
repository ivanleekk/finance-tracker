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
    const inactiveClasses = "text-base-600 hover:bg-base-100 hover:text-base-900";
    const activeClasses = "bg-primary-50 text-primary-700";

    // 1. If an onClick is provided, render a standard <button>
    if (onClick) {
        return (
            <button
                onClick={onClick}
                // Buttons aren't "active" routes, so they just get the inactive hover styling
                className={cn(baseClasses, inactiveClasses, "text-left")}
            >
                {IconContent}
                {text}
            </button>
        )
    }

    // 2. Fallback safety: If there's no onClick and no href, render nothing
    if (!href) return null;

    // 3. Otherwise, render your existing <NavLink>
    return (
        <NavLink
            to={href}
            className={({ isActive }) =>
                cn(
                    baseClasses,
                    isActive ? activeClasses : inactiveClasses
                )
            }
        >
            {IconContent}
            {text}
        </NavLink>
    )
}

export default SidebarButton