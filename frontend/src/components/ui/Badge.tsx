import * as React from "react"
import { cn } from "../../lib/utils"

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
    variant?: "success" | "warning" | "error" | "info" | "neutral" | "secondary"
}


function Badge({ className, variant = "neutral", ...props }: BadgeProps) {
    return (
        <div
            className={cn(
                "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2",
                {
                    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400": variant === "success",
                    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400": variant === "warning",
                    "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400": variant === "error",
                    "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400": variant === "info",
                    "bg-secondary-100 text-secondary-800 dark:bg-secondary-900/30 dark:text-secondary-400": variant === "secondary",
                    "bg-base-100 text-base-800 dark:bg-base-800 dark:text-base-300": variant === "neutral",
                },
                className
            )}
            {...props}
        />
    )
}

export { Badge }
