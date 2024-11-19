import { Form } from "@remix-run/react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {LoaderFunctionArgs, redirect} from "@remix-run/node";
import {getUserSession} from "~/utils/session.server";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger, SelectValue
} from "~/components/ui/select";
import {addTrade} from "~/portfolio";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const sessionUser = await getUserSession(request);
    if (!sessionUser) {
        return redirect("/login");
    }

    return null;
};

export const action = async ({ request }: LoaderFunctionArgs) => {
    let formData = await request.formData();

    let ticker = formData.get("Ticker");
    let quantity = formData.get("Number of Shares");
    let price = formData.get("Price");
    let tradeType = formData.get("Trade Type");
    // Add the trade to the database
    await addTrade(request, String(ticker), Number(quantity), Number(price), String(tradeType));
    return redirect("/portfolio");
}

export default function Trade() {

    return (
        <div className="space-y-2">
            <Form method="post" className="max-w-md space-y-4">
                <Label htmlFor="Ticker">
                    Ticker
                    <Input name="Ticker" type="text" required/>
                </Label>
                <Label htmlFor="Number of Shares">
                    Number of Shares
                    <Input name="Number of Shares" type="number" required/>
                </Label>
                <Label htmlFor="Price">
                    Price
                    <Input name="Price" type="number" step="0.01" required/>
                </Label>
                <Label htmlFor="Trade Type">
                    Trade Type
                    <Select
                    defaultValue="Buy"
                        name="Trade Type" required>
                        <SelectTrigger>
                            <SelectValue defaultValue="Buy" />
                        </SelectTrigger>
                        <SelectContent>
                        <SelectItem value="Buy">Buy</SelectItem>
                        <SelectItem value="Sell">Sell</SelectItem>
                        </SelectContent>
                    </Select>
                </Label>
                <Button type="submit">Trade</Button>
            </Form>

        </div>
    );
}
