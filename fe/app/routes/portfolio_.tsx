import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import {getUserSession} from "~/utils/session.server";
import {redirect} from "@remix-run/node";

export const loader = async ({ request }) => {
    const sessionUser = await getUserSession(request);
    if (!sessionUser) {
        return redirect("/login");
    }

    return null;
};
export default function Portfolio() {

    const portfolioData = [
        {
            symbol: "AAPL",
            quantity: 10,
            averagePrice: 150,
            totalInitialValue: 1500,
            currentPrice: 151,
            totalCurrentValue: 1510,
            percentageGainLoss: 0.67,
            totalGainLoss: 10
        },
        {
            symbol: "GOOGL",
            quantity: 5,
            averagePrice: 2000,
            totalInitialValue: 10000,
            currentPrice: 1500,
            totalCurrentValue: 7500,
            percentageGainLoss: -25,
            totalGainLoss: -2500
        },
        {
            symbol: "AMZN",
            quantity: 2,
            averagePrice: 3500,
            totalInitialValue: 7000,
            currentPrice: 3000,
            totalCurrentValue: 6000,
            percentageGainLoss: -14.29,
            totalGainLoss: -1000
        }
    ];


    return (
        <div>
            <Table>
                <TableCaption>
                    Your current holdings
                </TableCaption>
                <TableHeader>
                    <TableRow>
                        <TableHead>Symbol</TableHead>
                        <TableHead>Quantity</TableHead>
                        <TableHead>Average Price</TableHead>
                        <TableHead>Total Initial Value</TableHead>
                        <TableHead>Current Price</TableHead>
                        <TableHead>Total Current Value</TableHead>
                        <TableHead>Percentage Gain/Loss</TableHead>
                        <TableHead>Total Gain/Loss</TableHead>
                    </TableRow>
                </TableHeader>

                <TableBody>
                    {portfolioData.map((item, index) => (
                        <TableRow key={index}>
                            <TableCell>{item.symbol}</TableCell>
                            <TableCell>{item.quantity}</TableCell>
                            <TableCell>${item.averagePrice}</TableCell>
                            <TableCell>${item.totalInitialValue}</TableCell>
                            <TableCell>${item.currentPrice}</TableCell>
                            <TableCell>${item.totalCurrentValue}</TableCell>
                            <TableCell style={{ color: item.percentageGainLoss > 0 ? 'green' : 'red' }}>
                                {item.percentageGainLoss}%
                            </TableCell>
                            <TableCell style={{ color: item.totalGainLoss > 0 ? 'green' : 'red' }}>
                                ${item.totalGainLoss}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}