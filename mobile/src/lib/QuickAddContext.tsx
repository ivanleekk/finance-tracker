import { createContext, useContext, useState, type ReactNode } from "react";

interface QuickAddContextType {
    isOpen: boolean;
    open: () => void;
    close: () => void;
}

const QuickAddContext = createContext<QuickAddContextType>({
    isOpen: false,
    open: () => { },
    close: () => { },
});

export const QuickAddProvider = ({ children }: { children: ReactNode }) => {
    const [isOpen, setIsOpen] = useState(false);
    return (
        <QuickAddContext.Provider value={{ isOpen, open: () => setIsOpen(true), close: () => setIsOpen(false) }}>
            {children}
        </QuickAddContext.Provider>
    );
};

export const useQuickAdd = () => useContext(QuickAddContext);
