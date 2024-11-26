import {Form, useActionData, useRouteError} from "@remix-run/react";
import {Button} from "~/components/ui/button";
import {Input} from "~/components/ui/input";
import {Label} from "~/components/ui/label";
import {LoaderFunctionArgs} from "@remix-run/node";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "~/components/ui/select";
import {addTrade} from "~/portfolio/portfolio";
import {requireUserSession} from "~/utils/auth.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    await requireUserSession(request);


    return null;
};

export const action = async ({ request }: LoaderFunctionArgs) => {
    // Add the trade to the database
    return await addTrade(request);
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