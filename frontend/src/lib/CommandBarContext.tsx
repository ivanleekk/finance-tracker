import { createContext, useState, useEffect, useContext, useCallback, type ReactNode } from "react";

interface CommandBarContextType {
    isOpen: boolean;
    open: () => void;
    close: () => void;
    toggle: () => void;
}

const CommandBarContext = createContext<CommandBarContextType>({
    isOpen: false,
    open: () => { },
    close: () => { },
    toggle: () => { },
});

export const CommandBarProvider = ({ children }: { children: ReactNode }) => {
    const [isOpen, setIsOpen] = useState(false);

    const open = useCallback(() => setIsOpen(true), []);
    const close = useCallback(() => setIsOpen(false), []);
    const toggle = useCallback(() => setIsOpen(v => !v), []);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
                e.preventDefault();
                toggle();
            } else if (e.key === "Escape") {
                setIsOpen(false);
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [toggle]);

    return (
        <CommandBarContext.Provider value={{ isOpen, open, close, toggle }}>
            {children}
        </CommandBarContext.Provider>
    );
};

export const useCommandBar = () => useContext(CommandBarContext);
