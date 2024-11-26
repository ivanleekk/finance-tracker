import { LoaderFunctionArgs } from "@remix-run/node";
import React, { useRef, useState } from "react";
import { requireUserSession } from "~/utils/auth.server";
import { addBankInfo } from "~/bank/bank";
import { Form } from "@remix-run/react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    await requireUserSession(request);
    return null;
};

export const action = async ({ request }: LoaderFunctionArgs) => {
    return await addBankInfo(request);
};

export default function BankUpdate() {
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
        <div className="space-y-2">
            <Form method="post" className="max-w-md space-y-4">
                <Label>
                    Bank Name
                    <Input type="text" name="bankName" required />
                </Label>
                <Label>
                    Balance
                    <Input type="number" name="balance" step="0.01" required />
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

                <Button type="submit">Add Bank</Button>
            </Form>
        </div>
    );
}
