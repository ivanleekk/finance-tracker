import { Form } from "@remix-run/react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {LoaderFunctionArgs, redirect} from "@remix-run/node";
import {getUserSession} from "~/utils/session.server";
import {addPortfolioItem} from "~/portfolio";

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
    console.log(ticker, quantity, price);
    // Add the trade to the database
    await addPortfolioItem(request, String(ticker), Number(quantity), Number(price));
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
                <Button type="submit">Trade</Button>
            </Form>

        </div>
    );
}
