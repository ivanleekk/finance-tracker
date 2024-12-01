import { Form, useRouteError } from "@remix-run/react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { LoaderFunctionArgs } from "@remix-run/node";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import { addTrade } from "~/portfolio/portfolio";
import { requireUserSession } from "~/utils/auth.server";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Switch } from "~/components/ui/switch";
import { useRef, useState } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    await requireUserSession(request);

    return null;
};

export const action = async ({ request }: LoaderFunctionArgs) => {
    // Add the trade to the database
    return await addTrade(request);
};

export default function Trade() {
    // State to track whether the switch is toggled
    const [showDateInput, setShowDateInput] = useState(false);
    const dateInputRef = useRef<HTMLInputElement>(null); // Ref for the date input

    const handleSwitchChange = (checked: boolean) => {
        setShowDateInput(checked);

        // Reset the date input value when toggling off
        if (!checked && dateInputRef.current) {
            dateInputRef.current.value = ""; // Clear the value
        }
    };

    return (
        <Card className="max-w-xl flex flex-col flex-grow basis-auto p-2">
            <CardHeader className="text-xl font-bold">Trade</CardHeader>
            <CardContent>
                <Form method="post" className="flex flex-col gap-4">
                    <Label htmlFor="ticker">
                        Ticker
                        <Input name="ticker" type="text" required />
                    </Label>
                    <Label htmlFor="number_of_shares">
                        Number of Shares
                        <Input name="number_of_shares" type="number" required />
                    </Label>
                    <Label htmlFor="price">
                        Price
                        <Input name="price" type="number" step="0.01" required />
                    </Label>
                    <Label htmlFor="trade_type">
                        Trade Type
                        <Select defaultValue="Buy" name="trade_type" required>
                            <SelectTrigger>
                                <SelectValue defaultValue="Buy" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="Buy">Buy</SelectItem>
                                <SelectItem value="Sell">Sell</SelectItem>
                            </SelectContent>
                        </Select>
                    </Label>
                    <div className="flex items-center space-x-2 h-6">
                        <Switch
                            checked={showDateInput}
                            onCheckedChange={handleSwitchChange}
                        />
                        <Label>Date for historical balance</Label>
                    </div>

                    {showDateInput && (
                        <Label>
                            <Input type="date" name="date" ref={dateInputRef} />
                        </Label>
                    )}
                    <Button type="submit">Trade</Button>
                </Form>
            </CardContent>
        </Card>
    );
}

export function ErrorBoundary() {
    const error = useRouteError();
    return <div className="text-center text-9xl">{error.message}</div>;
}
