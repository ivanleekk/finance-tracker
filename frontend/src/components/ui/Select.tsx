import * as React from "react"
import { Check, ChevronDown } from "lucide-react"
import { cn } from "../../lib/utils"

export interface SelectOption {
    value: string
    label: React.ReactNode
    disabled?: boolean
}

export interface SelectProps {
    value: string
    onChange: (value: string) => void
    options: SelectOption[]
    placeholder?: string
    label?: string
    name?: string
    required?: boolean
    disabled?: boolean
    error?: boolean
    helperText?: string
    className?: string
    wrapperClassName?: string
    size?: "sm" | "md"
    id?: string
}

function optionText(label: React.ReactNode): string {
    if (typeof label === "string") return label
    if (typeof label === "number") return String(label)
    return ""
}

const Select = React.forwardRef<HTMLButtonElement, SelectProps>(
    (
        {
            value,
            onChange,
            options,
            placeholder = "Select…",
            label,
            name,
            required,
            disabled,
            error,
            helperText,
            className,
            wrapperClassName,
            size = "md",
            id,
        },
        forwardedRef
    ) => {
        const generatedId = React.useId()
        const triggerId = id || generatedId
        const listboxId = `${triggerId}-listbox`

        const [open, setOpen] = React.useState(false)
        const [highlighted, setHighlighted] = React.useState<number>(-1)
        const [openUpward, setOpenUpward] = React.useState(false)

        const rootRef = React.useRef<HTMLDivElement>(null)
        const triggerRef = React.useRef<HTMLButtonElement>(null)
        const listRef = React.useRef<HTMLUListElement>(null)
        const typeahead = React.useRef({ query: "", last: 0 })

        React.useImperativeHandle(forwardedRef, () => triggerRef.current as HTMLButtonElement)

        const selectedIndex = options.findIndex(o => o.value === value)
        const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined

        const openList = React.useCallback(() => {
            if (disabled) return
            const rect = triggerRef.current?.getBoundingClientRect()
            if (rect) {
                const spaceBelow = window.innerHeight - rect.bottom
                setOpenUpward(spaceBelow < 272 && rect.top > spaceBelow)
            }
            setHighlighted(selectedIndex >= 0 ? selectedIndex : options.findIndex(o => !o.disabled))
            setOpen(true)
        }, [disabled, selectedIndex, options])

        const close = React.useCallback((focusTrigger = true) => {
            setOpen(false)
            if (focusTrigger) triggerRef.current?.focus()
        }, [])

        const commit = (index: number) => {
            const opt = options[index]
            if (!opt || opt.disabled) return
            onChange(opt.value)
            close()
        }

        // Close on outside pointer-down
        React.useEffect(() => {
            if (!open) return
            const onPointerDown = (e: PointerEvent) => {
                if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
                    close(false)
                }
            }
            document.addEventListener("pointerdown", onPointerDown)
            return () => document.removeEventListener("pointerdown", onPointerDown)
        }, [open, close])

        // Keep highlighted option in view
        React.useEffect(() => {
            if (!open || highlighted < 0) return
            listRef.current
                ?.querySelector<HTMLElement>(`[data-index="${highlighted}"]`)
                ?.scrollIntoView({ block: "nearest" })
        }, [open, highlighted])

        const moveHighlight = (from: number, delta: number) => {
            let i = from
            for (let step = 0; step < options.length; step++) {
                i += delta
                if (i < 0 || i >= options.length) return
                if (!options[i].disabled) {
                    setHighlighted(i)
                    return
                }
            }
        }

        const handleTypeahead = (key: string) => {
            const now = Date.now()
            const state = typeahead.current
            state.query = now - state.last > 700 ? key : state.query + key
            state.last = now
            const q = state.query.toLowerCase()
            const start = open && highlighted >= 0 ? highlighted : selectedIndex
            const ordered = [...options.keys()].slice(start + 1).concat([...options.keys()].slice(0, start + 1))
            const match = ordered.find(
                i => !options[i].disabled && optionText(options[i].label).toLowerCase().startsWith(q)
            )
            if (match !== undefined) {
                if (open) setHighlighted(match)
                else onChange(options[match].value)
            }
        }

        const onKeyDown = (e: React.KeyboardEvent) => {
            if (disabled) return
            switch (e.key) {
                case "Enter":
                case " ":
                    e.preventDefault()
                    if (open) commit(highlighted)
                    else openList()
                    break
                case "ArrowDown":
                    e.preventDefault()
                    if (!open) openList()
                    else moveHighlight(highlighted, 1)
                    break
                case "ArrowUp":
                    e.preventDefault()
                    if (!open) openList()
                    else moveHighlight(highlighted, -1)
                    break
                case "Home":
                    if (open) {
                        e.preventDefault()
                        moveHighlight(-1, 1)
                    }
                    break
                case "End":
                    if (open) {
                        e.preventDefault()
                        moveHighlight(options.length, -1)
                    }
                    break
                case "Escape":
                    if (open) {
                        e.preventDefault()
                        close()
                    }
                    break
                case "Tab":
                    if (open) close(false)
                    break
                default:
                    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
                        handleTypeahead(e.key)
                    }
            }
        }

        return (
            <div className={cn("flex w-full flex-col gap-1.5", wrapperClassName)}>
                {label && (
                    <label
                        htmlFor={triggerId}
                        className={cn("text-sm font-medium text-base-800 dark:text-base-200", {
                            "text-base-400 dark:text-base-600": disabled,
                            "text-red-500 dark:text-red-400": error && !disabled,
                        })}
                    >
                        {label}
                    </label>
                )}
                <div ref={rootRef} className="relative w-full">
                    <button
                        type="button"
                        ref={triggerRef}
                        id={triggerId}
                        disabled={disabled}
                        role="combobox"
                        aria-expanded={open}
                        aria-haspopup="listbox"
                        aria-controls={open ? listboxId : undefined}
                        onClick={() => (open ? close() : openList())}
                        onKeyDown={onKeyDown}
                        className={cn(
                            "flex w-full items-center justify-between gap-2 rounded-md border border-base-200 bg-white px-3 text-left text-sm text-base-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:bg-base-100 disabled:text-base-500 dark:border-base-800 dark:bg-base-950 dark:text-base-50 dark:disabled:bg-base-900 dark:disabled:text-base-600",
                            size === "md" ? "h-10" : "h-8",
                            {
                                "border-red-500 focus-visible:ring-red-500 dark:border-red-400 dark:focus-visible:ring-red-400": error,
                            },
                            className
                        )}
                    >
                        <span className={cn("truncate", !selected && "text-base-400 dark:text-base-600")}>
                            {selected ? selected.label : placeholder}
                        </span>
                        <ChevronDown
                            className={cn(
                                "h-4 w-4 shrink-0 text-base-400 transition-transform duration-150 dark:text-base-500",
                                open && "rotate-180"
                            )}
                        />
                    </button>

                    {open && (
                        <ul
                            ref={listRef}
                            id={listboxId}
                            role="listbox"
                            aria-labelledby={triggerId}
                            className={cn(
                                "absolute z-50 max-h-60 w-full min-w-fit max-w-[min(24rem,calc(100vw-2rem))] overflow-auto rounded-lg border border-base-200 bg-white p-1 shadow-lg animate-in fade-in zoom-in-95 duration-100 dark:border-base-800 dark:bg-base-900",
                                openUpward ? "bottom-full mb-1" : "top-full mt-1"
                            )}
                        >
                            {options.length === 0 && (
                                <li className="px-3 py-2 text-sm text-base-400 dark:text-base-600">No options</li>
                            )}
                            {options.map((opt, i) => (
                                <li
                                    key={opt.value === "" ? `__empty-${i}` : opt.value}
                                    data-index={i}
                                    role="option"
                                    aria-selected={opt.value === value}
                                    aria-disabled={opt.disabled || undefined}
                                    onPointerMove={() => !opt.disabled && setHighlighted(i)}
                                    onClick={() => commit(i)}
                                    className={cn(
                                        "flex cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-2 text-sm text-base-900 dark:text-base-50",
                                        highlighted === i && "bg-base-100 dark:bg-base-800",
                                        opt.disabled && "cursor-not-allowed text-base-300 dark:text-base-700"
                                    )}
                                >
                                    <span className="truncate">{opt.label}</span>
                                    {opt.value === value && (
                                        <Check className="h-4 w-4 shrink-0 text-primary-500" />
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}

                    {/* Mirror native select: keeps name-based form submission and `required` constraint validation working */}
                    {(name || required) && (
                        <select
                            aria-hidden="true"
                            tabIndex={-1}
                            name={name}
                            required={required}
                            disabled={disabled}
                            value={value}
                            onChange={e => onChange(e.target.value)}
                            className="absolute inset-0 -z-10 h-full w-full opacity-0"
                        >
                            <option value="" />
                            {options.map((opt, i) => (
                                <option key={opt.value === "" ? `__empty-${i}` : opt.value} value={opt.value}>
                                    {optionText(opt.label)}
                                </option>
                            ))}
                        </select>
                    )}
                </div>
                {helperText && (
                    <p
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
Select.displayName = "Select"

export { Select }
