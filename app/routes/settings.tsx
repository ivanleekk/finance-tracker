import { Form, useLoaderData } from "@remix-run/react";
import { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { Button } from "~/components/ui/button";
import { Card, CardHeader, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { getUserByRequest, setUserByRequest } from "~/user/user";
import { requireUserSession } from "~/utils/auth.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    await requireUserSession(request);

    return await getUserByRequest(request);
}

export const action = async ({ request }: ActionFunctionArgs) => {
    await requireUserSession(request);

    return await setUserByRequest(request);
}
export default function Settings() {
    const userData = useLoaderData<typeof loader>();

    return (
        <Card className="max-w-xl flex flex-col flex-grow basis-auto p-2">
            <CardHeader className="text-xl font-bold">Settings</CardHeader>
            <CardContent>
                <Form method="post" className="space-y-4">
                    <Label>
                        Home Currency
                        <Input type="text" name="homeCurrency" />
                    </Label>
                    <Button type="submit">Save</Button>
                </Form>
            </CardContent>
        </Card>
    );
}