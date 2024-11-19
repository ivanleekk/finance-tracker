import { Form } from "@remix-run/react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";

export default function Trade() {

    return (
        <div className="space-y-2">
            <Form className="max-w-md">
                <Label htmlFor="Ticker">Ticker</Label>
                <Input name="Ticker" type="text" />
                <Label htmlFor="Number of Shares">Number of Shares</Label>
                <Input name="Number of Shares" type="number" />
                <Label htmlFor="Price">Price</Label>
                <Input name="Price" type="number" />
            </Form>
            <Button>Trade</Button>

        </div>
    );
}
