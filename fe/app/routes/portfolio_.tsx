import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import {getUserSession} from "~/utils/session.server";
import {LoaderFunctionArgs, redirect} from "@remix-run/node";
import {getPortfolio} from "~/portfolio";
import {useLoaderData} from "@remix-run/react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const sessionUser = await getUserSession(request);
    if (!sessionUser) {
        return redirect("/login");
    }
    return await getPortfolio(request)
};

export default function Portfolio() {
    const portfolioData = useLoaderData();


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
                            <TableCell>${item.totalInitialValue.toFixed(2)}</TableCell>
                            <TableCell>${item.currentPrice}</TableCell>
                            <TableCell>${item.totalCurrentValue.toFixed(2)}</TableCell>
                            <TableCell style={{ color: item.percentageGainLoss > 0 ? 'green' : 'red' }}>
                                {item.percentageGainLoss.toFixed(2)}%
                            </TableCell>
                            <TableCell style={{ color: item.totalGainLoss > 0 ? 'green' : 'red' }}>
                                ${item.totalGainLoss.toFixed(2)}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}