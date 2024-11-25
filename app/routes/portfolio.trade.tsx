import { Form, useActionData, useRouteError } from "@remix-run/react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { json, LoaderFunctionArgs, redirect } from "@remix-run/node";
import { getUserSession } from "~/utils/session.server";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger, SelectValue
} from "~/components/ui/select";
import { addTrade } from "~/portfolio/portfolio";
import { dataWithError, dataWithSuccess } from "remix-toast";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const sessionUser = await getUserSession(request);
    if (!sessionUser) {
        return redirect("/login");
    }

    return null;
};

export const action = async ({ request }: LoaderFunctionArgs) => {
    const formData = await request.formData();

    const ticker = formData.get("Ticker");
    const quantity = formData.get("Number of Shares");
    const price = formData.get("Price");
    const tradeType = formData.get("Trade Type");
    // Add the trade to the database
    const result = await addTrade(request, String(ticker), Number(quantity), Number(price), String(tradeType));

    if (result && result.status === 400) {
        return dataWithError(json({ error: result.statusText }, { status: 400, statusText: result.statusText }), `Failed to add trade: ${result.statusText}`);
    }
    else {
        return dataWithSuccess(null, `Trade added successfully for ${ticker?.toString().toLocaleUpperCase()}`);
    }
}

export default function Trade() {
    const actionData = useActionData();

    return (
        <div className="space-y-2">
            <Form method="post" className="max-w-md space-y-4">
                {actionData?.error && (
                    <div className="text-red-500">
                        {actionData.error}
                    </div>
                )}
                {actionData?.success && (
                    <div className="text-green-500">
                        Trade added successfully
                    </div>
                )}
                <Label htmlFor="Ticker">
                    Ticker
                    <Input name="Ticker" type="text" required />
                </Label>
                <Label htmlFor="Number of Shares">
                    Number of Shares
                    <Input name="Number of Shares" type="number" required />
                </Label>
                <Label htmlFor="Price">
                    Price
                    <Input name="Price" type="number" step="0.01" required />
                </Label>
                <Label htmlFor="Trade Type">
                    Trade Type
                    <Select defaultValue="Buy" name="Trade Type" required>
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

export function ErrorBoundary() {
    const error = useRouteError();
    return (
        <div className="text-center text-9xl">
            {error.message}
        </div>
    );
}