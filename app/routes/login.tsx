import { Form, Link, useActionData } from "@remix-run/react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { ActionFunctionArgs } from "@remix-run/node";
import { authenticator } from "~/utils/auth.server";
import { getUserSession } from "~/utils/session.server";
import { LoaderFunctionArgs, redirect } from "@vercel/remix";
import { Card, CardHeader, CardContent } from "~/components/ui/card";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const user = await getUserSession(request);

    if (user) {
        return redirect("/dashboard");
    }

    return null
}

export const action = async ({ request }: ActionFunctionArgs) => {
    return await authenticator.authenticate("email-password", request);
};

export default function Login() {

    return (
        <Card className="max-w-xl flex flex-col flex-grow basis-auto p-2">
            <CardHeader className="text-xl font-bold">Login</CardHeader>
            <CardContent className="flex flex-col gap-4">
                <Form method="post" className="flex flex-col gap-4">
                    <Label>
                        Email
                        <Input type="email" name="email" required />
                    </Label>
                    <Label>
                        Password
                        <Input type="password" name="password" required />
                    </Label>
                    <Button type="submit">Login</Button>
                </Form>
                <Form action="/login/google" method="post" className="flex flex-col gap-4">
                    <Button variant="secondary">Login with Google</Button>
                </Form>
                <Link to={"/signup"}>Don't have an account? <u>Sign up here</u></Link>
            </CardContent>
        </Card>
    );
}