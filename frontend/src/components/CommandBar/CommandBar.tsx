import { useEffect, useRef, useState } from "react";
import { useCommandBar } from "../../lib/CommandBarContext";

// Full parsing engine + all 9 states land in Phase D. This shell just handles the
// open/close overlay + focus so the ⌘K trigger already works end-to-end.
export function CommandBar() {
    const { isOpen, close } = useCommandBar();
    const [query, setQuery] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen) {
            setQuery("");
            requestAnimationFrame(() => inputRef.current?.focus());
        }
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-[100] flex items-start justify-center pt-[14vh] bg-base-950/60 backdrop-blur-sm"
            onClick={close}
        >
            <div
                className="w-full max-w-[480px] mx-4 bg-white dark:bg-base-900 border border-base-200 dark:border-base-800 rounded-2xl shadow-2xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-base-100 dark:border-base-800">
                    <span className="text-secondary-500 font-mono text-sm">⌘</span>
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Log or find anything…"
                        className="flex-1 bg-transparent outline-none text-sm text-base-900 dark:text-base-50 placeholder:text-base-400"
                    />
                </div>
                <div className="p-4 text-xs text-base-500 dark:text-base-400">
                    Type an amount to log · text to search
                </div>
                <div className="flex items-center justify-between px-4 py-2.5 border-t border-base-100 dark:border-base-800 text-[10px] text-base-400 dark:text-base-600">
                    <span>Type an amount to log · text to search</span>
                    <span>esc to close</span>
                </div>
            </div>
        </div>
    );
}
