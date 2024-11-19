import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import {LoaderFunctionArgs, redirect} from "@remix-run/node";
import {getUserSession} from "~/utils/session.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const sessionUser = await getUserSession(request);
    if (!sessionUser) {
        return redirect("/login");
    }

    return null;
};

export default function Transactions() {

    const transactionData = [
        {
            symbol: "AAPL",
            buySell: "Buy",
            quantity: 10,
            price: 150,
            totalValue: 1500,
            date: "2023-01-01"
        },
        {
            symbol: "GOOGL",
            buySell: "Sell",
            quantity: 5,
            price: 2800,
            totalValue: 14000,
            date: "2023-02-15"
        },
        {
            symbol: "TSLA",
            buySell: "Buy",
            quantity: 2,
            price: 700,
            totalValue: 1400,
            date: "2023-03-10"
        }
    ];

    return (
        <div>
            <Table>
                <TableCaption>
                    Your transaction history
                </TableCaption>
                <TableHeader>
                    <TableRow>
                        <TableHead>Symbol</TableHead>
                        <TableHead>Buy/Sell</TableHead>
                        <TableHead>Quantity</TableHead>
                        <TableHead>Price</TableHead>
                        <TableHead>Total Value</TableHead>
                        <TableHead>Date</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {transactionData.map((item, index) => (
                        <TableRow key={index}>
                            <TableCell>{item.symbol}</TableCell>
                            <TableCell>{item.buySell}</TableCell>
                            <TableCell>{item.quantity}</TableCell>
                            <TableCell>${item.price}</TableCell>
                            <TableCell>${item.totalValue}</TableCell>
                            <TableCell>${item.date}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}
