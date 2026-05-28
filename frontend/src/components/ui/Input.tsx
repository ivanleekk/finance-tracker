import * as React from "react"
import { cn } from "../../lib/utils"

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    error?: boolean
    label?: string
    helperText?: string
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
    ({ className, type, error, label, helperText, disabled, id, ...props }, ref) => {
        const generatedId = React.useId()
        const inputId = id || generatedId
        const helperId = helperText ? `${inputId}-helper` : undefined

        return (
            <div className="flex w-full flex-col gap-1.5">
                {label && (
                    <label
                        htmlFor={inputId}
                        className={cn("text-sm font-medium text-base-800 dark:text-base-200", {
                            "text-base-400 dark:text-base-600": disabled,
                            "text-red-500 dark:text-red-400": error && !disabled,
                        })}
                    >
                        {label}
                    </label>
                )}
                <input
                    type={type}
                    id={inputId}
                    disabled={disabled}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={helperId}
                    className={cn(
                        "flex h-10 w-full rounded-md border border-base-300 bg-white px-3 py-2 text-sm text-base-900 placeholder:text-base-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:bg-base-100 disabled:text-base-500 dark:border-base-800 dark:bg-base-950 dark:text-base-50 dark:placeholder:text-base-600 dark:disabled:bg-base-900 dark:disabled:text-base-600",
                        {
                            "border-red-500 focus-visible:ring-red-500 dark:border-red-400 dark:focus-visible:ring-red-400": error,
                        },
                        className
                    )}
                    ref={ref}
                    {...props}
                />
                {helperText && (
                    <p
                        id={helperId}
                        className={cn("text-sm text-base-500 dark:text-base-400", {
                            "text-red-500 dark:text-red-400": error && !disabled,
                            "text-base-400 dark:text-base-600": disabled,
                        })}
                    >
                        {helperText}
                    </p>
                )}
            </div>
        )
    }
)
Input.displayName = "Input"

export { Input }
