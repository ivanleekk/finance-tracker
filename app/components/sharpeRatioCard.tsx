import { Card } from "./ui/card";

export default function SharpeRatioCard({ data }) {
    return (
        <Card className="w-fit p-2">
            <h2>Portfolio Sharpe Ratio</h2>
            <p>{data.toFixed(4)}</p>
        </Card>
    );
}