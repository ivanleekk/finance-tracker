import { Card } from "./ui/card";

export default function StandardDeviationCard({ data }) {
    console.log(data)
    return (
        <Card className="w-fit p-2">
            <h2>Portfolio Standard Deviation</h2>
            <p>{data.toFixed(4)}</p>
        </Card>
    );
}