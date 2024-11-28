import { Form, Link, useActionData } from "@remix-run/react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { ActionFunctionArgs } from "@remix-run/node";
import { authenticator } from "~/utils/auth.server";
import { getUserSession } from "~/utils/session.server";
import { LoaderFunctionArgs, redirect } from "@vercel/remix";

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
    const actionData = useActionData();

    return (
        <div className="flex flex-col space-y-4">
            <Form method="post" className="space-y-4">
                {actionData?.error && (
                    <div className="text-red-500">{actionData.error}</div>
                )}
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
            <Form action="/login/google" method="post">
                <Button>Login with Google</Button>
            </Form>
            <Link to={"/signup"}>Don't have an account? Sign up here</Link>
        </div>
    );
}