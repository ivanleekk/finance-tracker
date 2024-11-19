import { Card } from "~/components/ui/card";

export default function Statistics() {
    return (
        <div>
            <div className="space-y-2">
                <Card className="w-fit p-2">
                    <h2>Portfolio Beta</h2>
                    <p>0.67</p>
                </Card>
                <Card className="w-fit p-2">
                    <h2>Portfolio Standard Deviation</h2>
                    <p>0.25</p>
                </Card>
                <Card className="w-fit p-2">
                    <h2>Portfolio Sharpe Ratio</h2>
                    <p>0.75</p>
                </Card>
            </div>
        </div>
    );
}