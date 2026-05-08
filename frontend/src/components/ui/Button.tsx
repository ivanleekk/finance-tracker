import * as React from "react"
import { cn } from "../../lib/utils"

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: "primary" | "secondary" | "ghost" | "danger"
    size?: "sm" | "md" | "lg"
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant = "primary", size = "md", ...props }, ref) => {
        return (
            <button
                ref={ref}
                className={cn(
                    "inline-flex items-center justify-center rounded-md font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:pointer-events-none disabled:opacity-50",
                    {
                        "bg-primary-500 text-white hover:bg-primary-600 active:bg-primary-700": variant === "primary",
                        "border border-primary-200 bg-primary-50 text-primary-700 hover:bg-primary-100 dark:bg-primary-950 dark:border-primary-800 dark:text-primary-400": variant === "secondary",
                        "text-base-700 hover:bg-base-100 dark:text-base-400 dark:hover:bg-base-800": variant === "ghost",
                        "bg-red-500 text-white hover:bg-red-600": variant === "danger",
                        "min-h-8 px-3 text-sm": size === "sm",
                        "min-h-10 px-4 py-2 text-base": size === "md",
                        "py-2 min-h-12 px-8 text-lg": size === "lg",
                    },
                    className
                )}
                {...props}
            />
        )
    }
)
Button.displayName = "Button"

export { Button }
