import { Form, Link } from "@remix-run/react";
import { Label } from "~/components/ui/label";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { ActionFunctionArgs } from "@remix-run/node";
import { authenticator } from "~/utils/auth.server";
import { LoaderFunctionArgs, redirect } from "@vercel/remix";
import { getUserSession } from "~/utils/session.server";
import { Card, CardHeader, CardContent } from "~/components/ui/card";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const user = await getUserSession(request);

    if (user) {
        return redirect("/dashboard");
    }

    return null
}

export const action = async ({ request }: ActionFunctionArgs) => {
    return authenticator.authenticate("signup-email-password", request);
}

export default function SignUp() {
    return (
        <Card className="max-w-xl flex flex-col flex-grow basis-auto p-2">
            <CardHeader className="text-xl font-bold">Sign Up</CardHeader>
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
                    <Button type="submit">Sign Up</Button>
                </Form>
                <Form action="/login/google" method="post" className="flex flex-col gap-4">
                    <Button variant="secondary">Sign Up with Google</Button>
                </Form>
                <Link to={"/login"}>Already have an account? <u>Login here</u></Link>
            </CardContent>
        </Card>
    )
}