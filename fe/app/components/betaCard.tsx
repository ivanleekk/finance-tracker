import { Card } from "./ui/card";

function calculateBeta(data) {
    let totalValue = 0;
    for (const stock of data) {
        totalValue += stock.totalCurrentValue;
    }
    let beta = 0;
    for (const stock of data) {
        beta += (stock.totalCurrentValue / totalValue) * stock.beta;
    }
    return beta;
}

export default function BetaCard({ data }) {
    const beta = calculateBeta(data);
    return (
        <Card className="w-fit p-2">
            <h2>Portfolio Beta</h2>
            <p>{beta.toFixed(4)}</p>
        </Card>
    );
}