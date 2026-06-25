import * as React from "react"
import { X } from "lucide-react"
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

interface DialogProps {
    isOpen: boolean
    onClose: () => void
    children: React.ReactNode
}

export function Dialog({ isOpen, onClose, children }: DialogProps) {
    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            {/* Backdrop */}
            <div
                aria-hidden="true"
                className="fixed inset-0 bg-base-900/40 backdrop-blur-sm transition-opacity animate-in fade-in duration-200"
                onClick={onClose}
            />

            {/* Modal */}
            <div
                role="dialog"
                aria-modal="true"
                className="relative w-full max-w-lg rounded-2xl bg-white dark:bg-base-900 p-6 shadow-2xl transition-all animate-in zoom-in-95 duration-200 border border-base-100 dark:border-base-800"
            >
                <button
                    aria-label="Close dialog"
                    onClick={onClose}
                    className="absolute right-4 top-4 rounded-full p-2 text-base-400 hover:bg-base-50 dark:hover:bg-base-800 hover:text-base-600 dark:hover:text-base-100 transition-colors"
                >
                    <X className="h-5 w-5" />
                </button>
                {children}
            </div>
        </div>
    )
}

export function DialogHeader({ children }: { children: React.ReactNode }) {
    return <div className="mb-6 space-y-1.5 text-left">{children}</div>
}

export function DialogTitle({ className, children }: { className?: string, children: React.ReactNode }) {
    return <h3 className={cn("text-xl font-semibold text-base-900 dark:text-base-50 leading-none tracking-tight", className)}>{children}</h3>
}

export function DialogFooter({ children }: { children: React.ReactNode }) {
    return <div className="mt-8 flex flex-col-reverse sm:flex-row sm:justify-end gap-3">{children}</div>
}
