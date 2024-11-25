import { Card } from "./ui/card";

export default function BetaCard({ data }) {
    return (
        <Card className="w-fit p-2">
            <h2>Portfolio Beta</h2>
            <p>{data.toFixed(4)}</p>
        </Card>
    );
}