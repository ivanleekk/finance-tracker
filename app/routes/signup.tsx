import { Form, Link } from "@remix-run/react";
import { Label } from "~/components/ui/label";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { ActionFunctionArgs } from "@remix-run/node";
import { authenticator } from "~/utils/auth.server";
import { LoaderFunctionArgs, redirect } from "@vercel/remix";
import { getUserSession } from "~/utils/session.server";

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
        <div>
            <Form method="post" className="space-y-4">
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
            <Link to={"/login"}>Already have an account? Login here</Link>
        </div>
    )
}