import { Form, useLoaderData } from "@remix-run/react";
import { redirectWithSuccess } from "remix-toast";
import { Button } from "~/components/ui/button";
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
    console.log(userData);
    return (
        <div className="space-y-4">
            <Form method="post" className="space-y-4">
                <Label>
                    Home Currency
                    <Input type="text" name="homeCurrency" />
                </Label>
                <Button type="submit">Save</Button>
            </Form>
        </div>
    );
}