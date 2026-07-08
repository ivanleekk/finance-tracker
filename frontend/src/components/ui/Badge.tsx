import * as React from "react"
import { cn } from "../../lib/utils"

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
    variant?: "success" | "warning" | "error" | "info" | "neutral" | "secondary" | "outline" | "private" | "shared"
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
                    "border border-base-300 text-base-700 dark:border-base-700 dark:text-base-300 bg-transparent": variant === "outline",
                    // Ownership tags: private = fuchsia (secondary), shared = sky (primary) — matches the design's ownership color language.
                    "bg-secondary-100 text-secondary-700 dark:bg-secondary-900/30 dark:text-secondary-400": variant === "private",
                    "bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400": variant === "shared",
                },
                className
            )}
            {...props}
        />
    )
}

export { Badge }
