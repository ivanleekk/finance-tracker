import {LoaderFunctionArgs} from "@remix-run/node";
import React from "react";
import {requireUserSession} from "~/utils/auth.server";
import {addBankInfo} from "~/bank/bank";
import {Form} from "@remix-run/react";
import {Button} from "~/components/ui/button";
import {Input} from "~/components/ui/input";
import {Label} from "~/components/ui/label";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    await requireUserSession(request);

    return null;
};

export const action = async ({request}: LoaderFunctionArgs) => {
    return await addBankInfo(request);
}

export default function BankUpdate() {
    return (
        <div className="space-y-2">
            <Form method="post" className="max-w-md space-y-4">
                <Label>
                    Bank Name
                    <Input type="text" name="bankName" required/>
                </Label>
                <Label>
                    Balance
                    <Input type="number" name="balance" step="0.01" required/>
                </Label>
                <Button type="submit">Add Bank</Button>
            </Form>
        </div>
    );
}
