import * as React from "react"
import { NavLink } from "react-router"
import { cn } from "../lib/utils"

interface SidebarButtonProps {
    text: string
    href: string
    icon?: React.ReactNode
}

function SidebarButton({ text, href, icon }: SidebarButtonProps) {
    return (
        <NavLink
            to={href}
            className={({ isActive }) =>
                cn(
                    "group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                        ? "bg-primary-50 text-primary-700"
                        : "text-base-600 hover:bg-base-100 hover:text-base-900"
                )
            }
        >
            {icon && (
                <span className="flex h-5 w-5 items-center justify-center">
                    {icon}
                </span>
            )}
            {text}
        </NavLink>
    )
}

export default SidebarButton