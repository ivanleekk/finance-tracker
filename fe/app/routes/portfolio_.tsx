import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";

export default function Portfolio() {
    return (
        <div>
            <h1>Portfolio</h1>
            <p>Welcome to your stock portfolio</p>
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
                    <TableRow>
                        <TableCell>APPL</TableCell>
                        <TableCell>10</TableCell>
                        <TableCell>$150</TableCell>
                        <TableCell>$1500</TableCell>
                        <TableCell>$1500</TableCell>
                        <TableCell>$1500</TableCell>
                        <TableCell>$1500</TableCell>
                        <TableCell>$1500</TableCell>
                    </TableRow>
                    <TableRow>
                        <TableCell>GOOGL</TableCell>
                        <TableCell>5</TableCell>
                        <TableCell>$2000</TableCell>
                        <TableCell>$10000</TableCell>
                        <TableCell>$1500</TableCell>
                        <TableCell>$1500</TableCell>
                        <TableCell>$1500</TableCell>
                        <TableCell>$1500</TableCell>
                    </TableRow>
                    <TableRow>
                        <TableCell>AMZN</TableCell>
                        <TableCell>2</TableCell>
                        <TableCell>$3500</TableCell>
                        <TableCell>$7000</TableCell>
                        <TableCell>$1500</TableCell>
                        <TableCell>$1500</TableCell>
                        <TableCell>$1500</TableCell>
                        <TableCell>$1500</TableCell>
                    </TableRow>
                </TableBody>
            </Table>
        </div>
    );
}