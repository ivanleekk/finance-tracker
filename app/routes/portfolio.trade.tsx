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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireUserSession(request);

  return null;
};

export const action = async ({ request }: LoaderFunctionArgs) => {
  // Add the trade to the database
  return await addTrade(request);
};

export default function Trade() {
  return (
    <Card className="max-w-xl flex flex-col flex-grow basis-auto p-2">
      <CardHeader className="text-xl font-bold">Trade</CardHeader>
      <CardContent>
        <Form method="post" className="flex flex-col gap-4">
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
      </CardContent>
    </Card>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  return <div className="text-center text-9xl">{error.message}</div>;
}
