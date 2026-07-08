export type ScanResult = {
    amount: number;
    merchant: string;
    category: { name: string; icon: string };
    items: [string, string][];
};

// A real OCR/ML receipt-scan service is out of scope here - this reproduces the design
// prototype's simulated scan (fixed animation + a single canned result) faithfully.
export const SCAN_RESULT: ScanResult = {
    amount: 43.20,
    merchant: "NTUC FairPrice",
    category: { name: "Groceries", icon: "🛒" },
    items: [
        ["Fresh milk 2×", "5.80"],
        ["Eggs (10s)", "4.20"],
        ["Jasmine rice 5kg", "12.90"],
        ["Vegetables", "9.40"],
        ["Chicken", "10.90"],
    ],
};
