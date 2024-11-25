import {Form, Link} from "@remix-run/react";
import {Label} from "~/components/ui/label";
import {Input} from "~/components/ui/input";
import {Button} from "~/components/ui/button";
import {ActionFunctionArgs} from "@remix-run/node";
import {authenticator} from "~/utils/auth.server";

export const action = async ({request}: ActionFunctionArgs) => {
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