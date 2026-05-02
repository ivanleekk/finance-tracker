import { useState, useEffect, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./components/ui/Card"
import { Input } from "./components/ui/Input"
import { Button } from "./components/ui/Button"

export default function Trade() {
    const [ticker, setTicker] = useState("")
    const [quantity, setQuantity] = useState("")
    const [date, setDate] = useState(new Date().toISOString().split('T')[0])
    const [price, setPrice] = useState("")

    // Deterministic mock price generator based on string hashing
    const getDeterministicPrice = (symbol: string, dateString: string) => {
        if (!symbol) return 0;
        const seedStr = symbol.toUpperCase() + dateString;
        let hash = 0;
        for (let i = 0; i < seedStr.length; i++) {
            hash = seedStr.charCodeAt(i) + ((hash << 5) - hash);
        }
        // Generate a pseudo-random price between $10 and $510
        const pseudoRandom = Math.abs(Math.sin(hash));
        const generatedPrice = 10 + (pseudoRandom * 500);
        return generatedPrice;
    }

    // Auto-prefill the price when ticker or date changes
    useEffect(() => {
        if (ticker.trim() !== "" && date) {
            // Simulate an API call delay
            const timer = setTimeout(() => {
                const fetchedPrice = getDeterministicPrice(ticker, date);
                setPrice(fetchedPrice.toFixed(2));
            }, 300);
            return () => clearTimeout(timer);
        } else {
            setPrice("");
        }
    }, [ticker, date]);

    const estimatedTotal = useMemo(() => {
        const q = parseFloat(quantity) || 0;
        const p = parseFloat(price) || 0;
        return q * p;
    }, [quantity, price]);

    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
    }

    const handleTrade = (type: "Buy" | "Sell") => {
        if (!ticker || !quantity || !price || !date) {
            alert("Please fill all fields before submitting.");
            return;
        }
        console.log(`Executing ${type} Limit Order: ${quantity} shares of ${ticker.toUpperCase()} at $${price} on ${date}`);
        // Reset form after submission
        setTicker("");
        setQuantity("");
        setPrice("");
        // Keep date as is for rapid entry of multiple trades on the same day
    }

    return (
        <div className="flex-1 space-y-6 p-8 flex justify-center items-start">
            <div className="w-full max-w-md mt-10">
                <Card>
                    <CardHeader>
                        <CardTitle>Trade Execution</CardTitle>
                        <CardDescription>Place a historical limit order.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <Input 
                            label="Ticker Symbol" 
                            placeholder="e.g. AAPL" 
                            className="uppercase"
                            value={ticker}
                            onChange={(e) => setTicker(e.target.value.toUpperCase())}
                        />
                        
                        <div className="grid grid-cols-2 gap-4">
                            <Input 
                                label="Order Type" 
                                value="Limit" 
                                disabled
                                helperText="Only Limit orders supported"
                            />
                            <Input 
                                label="Execution Date" 
                                type="date" 
                                value={date}
                                onChange={(e) => setDate(e.target.value)}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <Input 
                                label="Quantity" 
                                type="number" 
                                placeholder="0" 
                                min="1"
                                step="1"
                                value={quantity}
                                onChange={(e) => setQuantity(e.target.value)}
                            />
                            <Input 
                                label="Limit Price" 
                                type="number" 
                                placeholder="0.00" 
                                min="0.01"
                                step="0.01"
                                value={price}
                                onChange={(e) => setPrice(e.target.value)}
                                helperText={ticker ? "Auto-filled historical price" : ""}
                            />
                        </div>

                        <div className="pt-4 flex gap-3">
                            <Button className="w-full" variant="primary" onClick={() => handleTrade("Buy")}>
                                Buy
                            </Button>
                            <Button className="w-full" variant="danger" onClick={() => handleTrade("Sell")}>
                                Sell
                            </Button>
                        </div>
                        
                        <div className="pt-4 text-center">
                            <p className="text-sm text-base-500">
                                Estimated Total: <span className="font-semibold text-base-900">{formatCurrency(estimatedTotal)}</span>
                            </p>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}